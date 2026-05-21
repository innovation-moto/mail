import { app, BrowserWindow } from 'electron';
import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { listAccounts } from '../db/queries/accounts';
import { getEncryptedPassword } from '../db/queries/accounts';

function writeLog(msg: string): void {
  try {
    const logPath = path.join(app.getPath('userData'), 'sync.log');
    const line = `${new Date().toISOString()} ${msg}\n`;
    fs.appendFileSync(logPath, line);
  } catch {}
}
import { getUnreadCount, listEmails, getTotalUnreadCount, getDistinctFolders, getAllFolderUnreadCounts, getThreadUnreadCounts } from '../db/queries/emails';
import { syncAllFolders, fetchFolders } from './imap';
import { getAllSettings } from '../db/queries/settings';
import { showNewMailNotification } from './notification';
import { pushFolderStateToImap, cleanupConfigMessages, pullFilterRulesFromImap } from './filterSync';
import { startIdleWatcher, stopAllIdleWatchers } from './imapIdle';

function updateBadge(): void {
  try {
    const count = getTotalUnreadCount();
    app.setBadgeCount(count);
  } catch { /* badgeCount非対応環境では無視 */ }
}

let syncTimer: NodeJS.Timeout | null = null;
let isSyncing = false;
let cleanupDone = false;

// フォルダリストのメモリキャッシュ（アカウントID → フォルダパス[]）
const folderCache: Record<string, { folders: string[]; fetchedAt: number }> = {};
const FOLDER_CACHE_TTL = 10 * 60 * 1000; // 10分

const SKIP_FOLDERS = /Trash|ゴミ箱|Deleted|Spam|Junk|迷惑|Draft|下書き|Sent|送信済み|Sent Items|Outbox|IM-Mail-Config/i;

async function getFoldersToSync(account: any, password: string): Promise<string[]> {
  const now = Date.now();
  const cached = folderCache[account.id];

  // キャッシュが有効な場合はそのまま返す
  if (cached && now - cached.fetchedAt < FOLDER_CACHE_TTL) {
    return cached.folders;
  }

  // DBにある既存フォルダ（フォルダを開いたことがある）
  const knownFolders = getDistinctFolders(account.id).filter((f) => !SKIP_FOLDERS.test(f));
  const result = Array.from(new Set(['INBOX', ...knownFolders]));

  // サーバーからフォルダ一覧を取得してキャッシュ
  try {
    const serverFolders = await fetchFolders(account, password);
    for (const sf of serverFolders) {
      if (!SKIP_FOLDERS.test(sf.path) && !result.includes(sf.path)) {
        result.push(sf.path);
      }
    }
    console.log(`[sync] folder cache updated for ${account.email}: ${result.join(', ')}`);
  } catch (e) {
    console.error(`[sync] fetchFolders failed, using known folders:`, (e as Error).message);
  }

  folderCache[account.id] = { folders: result, fetchedAt: now };
  return result;
}

export async function syncAllAccounts(win?: BrowserWindow): Promise<void> {
  writeLog(`syncAllAccounts called, isSyncing=${isSyncing}`);
  if (isSyncing) return;
  isSyncing = true;

  try {
    const accounts = listAccounts();
    writeLog(`accounts count=${accounts.length}`);
    const settings = getAllSettings();

    for (const account of accounts) {
      const encPwd = getEncryptedPassword(account.id);
      if (!encPwd) continue;

      let password: string;
      try {
        password = safeStorage.decryptString(encPwd);
      } catch {
        continue;
      }

      // 初回のみ IM-Mail-Config メールをIMAPから一括削除
      if (!cleanupDone) {
        cleanupDone = true;
        cleanupConfigMessages(account, password).catch((e) =>
          console.warn('[sync] cleanupConfigMessages failed:', (e as Error).message),
        );
      }

      // OAuthアカウントはトークンリフレッシュ
      const a = account as any;
      if (a.oauthRefreshToken && (!a.oauthExpiresAt || a.oauthExpiresAt < Date.now() + 60000)) {
        try {
          const { refreshMicrosoftToken } = await import('./microsoftAuth');
          const { updateAccount } = await import('../db/queries/accounts');
          const tokens = await refreshMicrosoftToken(a.oauthRefreshToken);
          updateAccount(account.id, {
            oauthAccessToken: tokens.accessToken,
            oauthRefreshToken: tokens.refreshToken,
            oauthExpiresAt: tokens.expiresAt,
          } as any);
          a.oauthAccessToken = tokens.accessToken;
          a.oauthExpiresAt = tokens.expiresAt;
        } catch (e) {
          console.error('[sync] token refresh failed:', e);
        }
      }

      try {
        const foldersToSync = await getFoldersToSync(account, password);

        let totalAdded = 0;
        const beforeInboxCount = getUnreadCount(account.id, 'INBOX');

        // 1接続で全フォルダを順番に同期（Gmail接続過多によるタイムアウト解消）
        const { totalAdded: added } = await syncAllFolders(
          account,
          password,
          foldersToSync,
          50,
          (folder, folderAdded) => {
            // フォルダごとに完了したら即座にrendererへ通知
            if (folderAdded > 0) {
              const unreadCounts = getAllFolderUnreadCounts(account.id);
              updateBadge();
              win?.webContents.send('mail:synced', {
                accountId: account.id,
                added: folderAdded,
                unreadCounts,
              });
            }
          },
        );
        totalAdded = added;

        // INBOX の新着通知
        const afterInboxCount = getUnreadCount(account.id, 'INBOX');
        const newCount = afterInboxCount - beforeInboxCount;
        if (newCount > 0 && settings.notificationsEnabled) {
          const latest = listEmails(account.id, 'INBOX', 1, 0)[0];
          showNewMailNotification(account.email, newCount, latest
            ? { from: latest.from.name || latest.from.address, subject: latest.subject, bodyText: latest.bodyText }
            : undefined,
          );
        }

        // 全フォルダ完了後に最終の未読数・バッジを更新
        updateBadge();
        const unreadCounts = getAllFolderUnreadCounts(account.id);
        win?.webContents.send('mail:synced', {
          accountId: account.id,
          added: totalAdded,
          unreadCounts,
        });
        console.log(`[sync] ${account.email}: folders=${foldersToSync.length} added=${totalAdded}`);
        writeLog(`OK account=${account.email} folders=${foldersToSync.length} added=${totalAdded}`);

        // スマホで作成されたフィルタールールをIMAPから取得してローカルDBに反映
        pullFilterRulesFromImap(account, password, account.id).catch((e) =>
          console.warn('[sync] pullFilterRulesFromImap failed:', (e as Error).message),
        );
      } catch (err) {
        const errMsg = (err as Error).message;
        console.error(`[sync] Failed for ${account.email}:`, errMsg);
        writeLog(`FATAL account=${account.email}: ${errMsg}`);
      }
    }
  } finally {
    isSyncing = false;
  }
}

export function startSync(win: BrowserWindow): void {
  const settings = getAllSettings();
  const intervalMs = (settings.syncIntervalSec ?? 30) * 1000;

  // 初回即時同期
  syncAllAccounts(win).catch(console.error);

  syncTimer = setInterval(() => {
    syncAllAccounts(win).catch(console.error);
  }, intervalMs);

  // IMAP IDLE で各アカウントの INBOX をリアルタイム監視
  const accounts = listAccounts();
  for (const account of accounts) {
    const encPwd = getEncryptedPassword(account.id);
    if (!encPwd) continue;
    try {
      const password = safeStorage.decryptString(encPwd);
      startIdleWatcher(account, password, win);
    } catch {}
  }
}

export function stopSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  stopAllIdleWatchers();
}

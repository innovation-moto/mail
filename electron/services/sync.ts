import { app, BrowserWindow } from 'electron';
import { safeStorage } from 'electron';
import { listAccounts } from '../db/queries/accounts';
import { appendLog } from './logFile';
import { getEncryptedPassword } from '../db/queries/accounts';

function writeLog(msg: string): void {
  appendLog('sync.log', `${new Date().toISOString()} ${msg}`);
}
import { getTotalUnreadCount, getDistinctFolders, getThreadUnreadCounts } from '../db/queries/emails';
import { syncAllFolders, fetchFolders } from './imap';
import { getAllSettings } from '../db/queries/settings';
import { notifyNewMail } from './notification';
import { pushFolderStateToImap, cleanupConfigMessages, pullFilterRulesFromImap } from './filterSync';
import { startIdleWatcher, stopAllIdleWatchers } from './imapIdle';

function updateBadge(): void {
  try {
    const count = getTotalUnreadCount();
    app.setBadgeCount(count);
  } catch { /* badgeCount非対応環境では無視 */ }
}

let syncTimer: NodeJS.Timeout | null = null;
let inboxCheckTimer: NodeJS.Timeout | null = null;
let isSyncing = false;
let cleanupDone = false;
const isInboxChecking: Record<string, boolean> = {};
const pendingInboxCheck: Record<string, boolean> = {}; // チェック中に次のチェックが必要になった場合のフラグ

// フォルダリストのメモリキャッシュ（アカウントID → フォルダパス[]）
const folderCache: Record<string, { folders: string[]; fetchedAt: number }> = {};
const FOLDER_CACHE_TTL = 2 * 60 * 1000; // 2分

const SKIP_FOLDERS = /Trash|ゴミ箱|Deleted|Outbox|IM-Mail-Config/i;

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

    // 全アカウントを並列同期（直列だと遅いアカウントが後続をブロックするため）
    await Promise.all(accounts.map(async (account) => {
      const encPwd = getEncryptedPassword(account.id);
      if (!encPwd) return;

      let password: string;
      try {
        password = safeStorage.decryptString(encPwd);
      } catch {
        return;
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

        // 1接続で全フォルダを順番に同期（最大3分でタイムアウト）
        const syncController = new AbortController();
        const syncPromise = syncAllFolders(
          account,
          password,
          foldersToSync,
          50,
          (folder, folderAdded, newMail) => {
            // 通知対象の新着（未読・自分以外・通知対象フォルダ）があれば通知
            if (newMail.length > 0 && settings.notificationsEnabled) {
              writeLog(`[notif-check] account=${account.email} folder=${folder} notify=${newMail.length}`);
              notifyNewMail(account.email, newMail);
            }
            // フォルダごとに完了したら即座にrendererへ通知
            if (folderAdded > 0) {
              const unreadCounts = getThreadUnreadCounts(account.id);
              updateBadge();
              win?.webContents.send('mail:synced', {
                accountId: account.id,
                added: folderAdded,
                unreadCounts,
              });
            }
          },
          syncController.signal,
        );
        let timeoutHandle: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<{ totalAdded: number }>(
          (_, reject) => {
            timeoutHandle = setTimeout(() => {
              syncController.abort();
              reject(new Error('sync timeout'));
            }, 3 * 60 * 1000);
          },
        );
        let added: number;
        try {
          ({ totalAdded: added } = await Promise.race([syncPromise, timeoutPromise]));
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
        totalAdded = added;

        // 全フォルダ完了後に最終の未読数・バッジを更新
        updateBadge();
        const unreadCounts = getThreadUnreadCounts(account.id);
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
    }));
  } finally {
    isSyncing = false;
  }
}

async function quickInboxCheck(account: any, win: BrowserWindow): Promise<void> {
  if (isInboxChecking[account.id]) {
    // 前のチェック中に次のチェックが必要になった場合はフラグを立てる
    pendingInboxCheck[account.id] = true;
    return;
  }
  isInboxChecking[account.id] = true;
  pendingInboxCheck[account.id] = false;
  try {
    const encPwd = getEncryptedPassword(account.id);
    if (!encPwd) return;
    let password: string;
    try { password = safeStorage.decryptString(encPwd); } catch { return; }

    const settings = getAllSettings();
    const { totalAdded, newMail } = await syncAllFolders(account, password, ['INBOX'], 20);
    if (totalAdded > 0) {
      writeLog(`[inbox-check] account=${account.email} totalAdded=${totalAdded} notify=${newMail.length}`);
      if (settings.notificationsEnabled) notifyNewMail(account.email, newMail);
      updateBadge();
      const unreadCounts = getThreadUnreadCounts(account.id);
      win.webContents.send('mail:synced', { accountId: account.id, added: totalAdded, unreadCounts });
    }
  } catch (e) {
    writeLog(`[inbox-check] error account=${account.email}: ${(e as Error).message}`);
  } finally {
    isInboxChecking[account.id] = false;
    // チェック中に次のチェックが必要になっていた場合は再チェック
    if (pendingInboxCheck[account.id]) {
      pendingInboxCheck[account.id] = false;
      quickInboxCheck(account, win).catch(() => {});
    }
  }
}

async function quickInboxCheckAll(win: BrowserWindow): Promise<void> {
  const accounts = listAccounts();
  await Promise.all(accounts.map((account) => quickInboxCheck(account, win)));
}

export function startSync(win: BrowserWindow): void {
  const settings = getAllSettings();
  // フルsync（全フォルダ）は5分間隔
  const fullSyncIntervalMs = Math.max((settings.syncIntervalSec ?? 30) * 1000, 5 * 60 * 1000);

  // 初回即時フルsync
  syncAllAccounts(win).catch(console.error);

  syncTimer = setInterval(() => {
    syncAllAccounts(win).catch(console.error);
  }, fullSyncIntervalMs);

  // INBOXのみ30秒ごとに高速チェック（通知・新着検知用）
  inboxCheckTimer = setInterval(() => {
    quickInboxCheckAll(win).catch(console.error);
  }, 30 * 1000);

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
  if (inboxCheckTimer) {
    clearInterval(inboxCheckTimer);
    inboxCheckTimer = null;
  }
  stopAllIdleWatchers();
}

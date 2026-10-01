import { ImapFlow } from 'imapflow';
import type { Account } from '../../shared/types';
import { BrowserWindow, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { syncAllFolders } from './imap';
import { getAllFolderUnreadCounts, getTotalUnreadCount, getUnreadCount, listEmails } from '../db/queries/emails';
import { showNewMailNotification } from './notification';
import { getAllSettings } from '../db/queries/settings';

function writeIdleLog(msg: string): void {
  try {
    const logPath = path.join(app.getPath('userData'), 'idle.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

interface IdleState {
  running: boolean;
  client: ImapFlow | null;
  syncing: boolean;
  pendingSync: boolean; // 同期中に新着通知が来た場合、完了後に再チェック
}

const idleStates = new Map<string, IdleState>();

function createIdleClient(account: Account, password: string): ImapFlow {
  const a = account as Account & { oauthAccessToken?: string };
  const auth = a.oauthAccessToken
    ? { user: account.email, accessToken: a.oauthAccessToken }
    : { user: account.email, pass: password };
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth,
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000,
    socketTimeout: 1800000,
    greetingTimeout: 15000,
    disableAutoIdle: true,
  });
}

async function safeClose(client: ImapFlow): Promise<void> {
  try { await client.logout(); } catch { try { client.close(); } catch {} }
}

async function triggerInboxSync(
  account: Account,
  password: string,
  state: IdleState,
  win?: BrowserWindow,
): Promise<void> {
  if (state.syncing) {
    // 同期中に新着が来た場合、完了後に再チェックするフラグを立てる
    state.pendingSync = true;
    return;
  }
  state.syncing = true;
  state.pendingSync = false;
  try {
    const beforeUnread = getUnreadCount(account.id, 'INBOX');
    const { totalAdded } = await syncAllFolders(account, password, ['INBOX'], 50);
    if (totalAdded > 0) {
      const unreadCounts = getAllFolderUnreadCounts(account.id);
      win?.webContents.send('mail:synced', { accountId: account.id, added: totalAdded, unreadCounts });
      try { app.setBadgeCount(getTotalUnreadCount()); } catch {}
      console.log(`[idle] ${account.email}: synced ${totalAdded} new emails from INBOX`);

      // 通知
      const settings = getAllSettings();
      if (settings.notificationsEnabled) {
        const newUnread = getUnreadCount(account.id, 'INBOX') - beforeUnread;
        if (newUnread > 0) {
          const latest = listEmails(account.id, 'INBOX', 1, 0)[0];
          showNewMailNotification(account.email, newUnread, latest
            ? { from: latest.from.name || latest.from.address, subject: latest.subject, bodyText: latest.bodyText }
            : undefined,
            latest?.id,
          );
        }
      }
    }
  } catch (err) {
    console.warn(`[idle] ${account.email} sync error:`, (err as Error).message);
  } finally {
    state.syncing = false;
    // 同期中に新着通知が来ていた場合は再チェック
    if (state.pendingSync) {
      state.pendingSync = false;
      triggerInboxSync(account, password, state, win).catch(() => {});
    }
  }
}

export function startIdleWatcher(
  account: Account,
  password: string,
  win?: BrowserWindow,
): void {
  stopIdleWatcher(account.id);

  const state: IdleState = { running: true, client: null, syncing: false, pendingSync: false };
  idleStates.set(account.id, state);

  const runLoop = async () => {
    while (state.running) {
      // OAuthトークンを必要に応じてリフレッシュ（Outlookなど）
      const a = account as Account & { oauthRefreshToken?: string; oauthExpiresAt?: number; oauthAccessToken?: string };
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
          a.oauthRefreshToken = tokens.refreshToken;
          a.oauthExpiresAt = tokens.expiresAt;
          console.log(`[idle] ${account.email}: token refreshed`);
        } catch (e) {
          console.warn(`[idle] ${account.email}: token refresh failed:`, (e as Error).message);
        }
      }

      const client = createIdleClient(account, password);
      state.client = client;

      try {
        writeIdleLog(`${account.email}: connecting...`);
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');

        try {
          writeIdleLog(`${account.email}: IDLE started`);
          console.log(`[idle] ${account.email}: IDLE started`);
          while (state.running) {
            // IDLEモード（サーバーから通知が来るまでブロック、最大29分）
            await client.idle();

            if (!state.running) break;

            writeIdleLog(`${account.email}: activity detected → triggering sync`);
            console.log(`[idle] ${account.email}: activity detected`);
            // 非同期でINBOX同期（IDLEループをブロックしない）
            triggerInboxSync(account, password, state, win).catch(() => {});
          }
        } finally {
          lock.release();
        }
      } catch (err) {
        if (state.running) {
          writeIdleLog(`${account.email}: error - ${(err as Error).message}`);
          console.warn(`[idle] ${account.email} error:`, (err as Error).message);
        }
      } finally {
        await safeClose(client);
        state.client = null;
      }

      if (state.running) {
        writeIdleLog(`${account.email}: reconnecting in 15s...`);
        // 再接続まで15秒待機
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }
    console.log(`[idle] ${account.email}: stopped`);
  };

  runLoop().catch(err => console.error(`[idle] fatal ${account.email}:`, err));
}

export function stopIdleWatcher(accountId: string): void {
  const state = idleStates.get(accountId);
  if (state) {
    state.running = false;
    try { state.client?.close(); } catch {}
    idleStates.delete(accountId);
  }
}

export function stopAllIdleWatchers(): void {
  for (const accountId of [...idleStates.keys()]) {
    stopIdleWatcher(accountId);
  }
}

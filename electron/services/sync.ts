import { BrowserWindow } from 'electron';
import { safeStorage } from 'electron';
import { listAccounts } from '../db/queries/accounts';
import { getEncryptedPassword } from '../db/queries/accounts';
import { getUnreadCount, listEmails } from '../db/queries/emails';
import { syncFolder, syncFlags } from './imap';
import { getAllSettings } from '../db/queries/settings';
import { showNewMailNotification } from './notification';

let syncTimer: NodeJS.Timeout | null = null;
let isSyncing = false;

export async function syncAllAccounts(win?: BrowserWindow): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const accounts = listAccounts();
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
        const beforeCount = getUnreadCount(account.id, 'INBOX');
        const result = await syncFolder(account, password, 'INBOX', 50);

        // フラグ同期（既読・スター状態をGmailと合わせる）
        const flagsUpdated = await syncFlags(account, password, 'INBOX').catch(() => 0);

        const afterCount = getUnreadCount(account.id, 'INBOX');
        const newCount = afterCount - beforeCount;
        if (newCount > 0 && settings.notificationsEnabled) {
          const latest = listEmails(account.id, 'INBOX', 1, 0)[0];
          showNewMailNotification(account.email, newCount, latest
            ? { from: latest.from.name || latest.from.address, subject: latest.subject, bodyText: latest.bodyText }
            : undefined,
          );
        }

        // Always notify renderer to refresh
        win?.webContents.send('mail:synced', { accountId: account.id, added: result.added });
        console.log(`[sync] ${account.email}: added=${result.added} blocked=${result.blocked} flags=${flagsUpdated}`);
      } catch (err) {
        console.error(`[sync] Failed for ${account.email}:`, (err as Error).message);
      }
    }
  } finally {
    isSyncing = false;
  }
}

export function startSync(win: BrowserWindow): void {
  const settings = getAllSettings();
  const intervalMs = (settings.syncIntervalSec ?? 30) * 1000;

  syncTimer = setInterval(() => {
    syncAllAccounts(win).catch(console.error);
  }, intervalMs);
}

export function stopSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

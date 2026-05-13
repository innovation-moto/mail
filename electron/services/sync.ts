import { BrowserWindow } from 'electron';
import { safeStorage } from 'electron';
import { listAccounts } from '../db/queries/accounts';
import { getEncryptedPassword } from '../db/queries/accounts';
import { getUnreadCount } from '../db/queries/emails';
import { syncFolder } from './imap';
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

      try {
        const beforeCount = getUnreadCount(account.id, 'INBOX');
        const result = await syncFolder(account, password, 'INBOX', 50);
        const afterCount = getUnreadCount(account.id, 'INBOX');

        const newCount = afterCount - beforeCount;
        if (newCount > 0 && settings.notificationsEnabled) {
          showNewMailNotification(account.email, newCount);
        }

        win?.webContents.send('mail:synced', { accountId: account.id, added: result.added });
      } catch (err) {
        console.error(`Sync failed for ${account.email}:`, err);
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

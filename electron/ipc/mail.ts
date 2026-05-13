import { ipcMain, safeStorage } from 'electron';
import { ComposeData } from '../../shared/types';
import { getAccount, getEncryptedPassword } from '../db/queries/accounts';
import {
  listEmails,
  getEmail,
  markRead,
  markStar,
  markDeleted,
  moveEmail,
  searchEmails,
} from '../db/queries/emails';
import { syncFolder, fetchFolders, imapMarkRead, imapDeleteEmail, imapMoveEmail } from '../services/imap';
import { sendEmail } from '../services/smtp';

function getPassword(accountId: string): string {
  const enc = getEncryptedPassword(accountId);
  if (!enc) throw new Error('パスワードが見つかりません');
  return safeStorage.decryptString(enc);
}

export function registerMailHandlers(): void {
  ipcMain.handle('mail:fetchFolders', async (_e, accountId: string) => {
    const account = getAccount(accountId);
    if (!account) throw new Error('アカウントが見つかりません');
    const password = getPassword(accountId);
    return fetchFolders(account, password);
  });

  ipcMain.handle('mail:fetchEmails', (_e, accountId: string, folder: string, limit = 50, offset = 0) => {
    return listEmails(accountId, folder, limit, offset);
  });

  ipcMain.handle('mail:fetchEmail', (_e, emailId: string) => {
    return getEmail(emailId);
  });

  ipcMain.handle('mail:sync', async (_e, accountId: string, folder = 'INBOX') => {
    const account = getAccount(accountId);
    if (!account) throw new Error('アカウントが見つかりません');
    const password = getPassword(accountId);
    return syncFolder(account, password, folder);
  });

  ipcMain.handle('mail:send', async (_e, data: ComposeData) => {
    const account = getAccount(data.accountId);
    if (!account) throw new Error('アカウントが見つかりません');
    const password = getPassword(data.accountId);
    await sendEmail(account, password, data);
  });

  ipcMain.handle('mail:markRead', async (_e, emailId: string, isRead: boolean) => {
    const email = getEmail(emailId);
    if (!email) return;
    markRead(emailId, isRead);
    try {
      const account = getAccount(email.accountId);
      if (!account) return;
      const password = getPassword(email.accountId);
      await imapMarkRead(account, password, email.folder, email.uid, isRead);
    } catch {}
  });

  ipcMain.handle('mail:star', (_e, emailId: string, isStarred: boolean) => {
    markStar(emailId, isStarred);
  });

  ipcMain.handle('mail:delete', async (_e, emailId: string) => {
    const email = getEmail(emailId);
    if (!email) return;
    markDeleted(emailId);
    try {
      const account = getAccount(email.accountId);
      if (!account) return;
      const password = getPassword(email.accountId);
      await imapDeleteEmail(account, password, email.folder, email.uid);
    } catch {}
  });

  ipcMain.handle('mail:move', async (_e, emailId: string, toFolder: string) => {
    const email = getEmail(emailId);
    if (!email) return;
    moveEmail(emailId, toFolder);
    try {
      const account = getAccount(email.accountId);
      if (!account) return;
      const password = getPassword(email.accountId);
      await imapMoveEmail(account, password, email.folder, email.uid, toFolder);
    } catch {}
  });

  ipcMain.handle('mail:search', (_e, accountId: string, query: string) => {
    return searchEmails(accountId, query);
  });
}

import { ipcMain, safeStorage, dialog, shell } from 'electron';
import fs from 'fs';
import { ComposeData } from '../../shared/types';
import { getAccount, getEncryptedPassword } from '../db/queries/accounts';
import {
  listEmails,
  listPinnedEmails,
  getEmail,
  markRead,
  markAllReadInFolder,
  markStar,
  pinEmail,
  markDeleted,
  moveEmail,
  searchEmails,
  getAllFolderUnreadCounts,
  getAttachmentContent,
  saveAttachments,
} from '../db/queries/emails';
import { syncFolder, fetchFolders, imapMarkRead, imapMarkAllRead, imapPinEmail, imapDeleteEmail, imapMoveEmail, fetchAttachmentsForEmail } from '../services/imap';
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
    if (folder === 'Pinned') return listPinnedEmails(accountId);
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

  ipcMain.handle('mail:markAllRead', async (_e, accountId: string, folder: string) => {
    markAllReadInFolder(accountId, folder);
    try {
      const account = getAccount(accountId);
      if (!account) return;
      const password = getPassword(accountId);
      await imapMarkAllRead(account, password, folder);
    } catch (err) {
      console.error('[markAllRead] IMAP error:', (err as Error).message);
    }
  });

  ipcMain.handle('mail:star', (_e, emailId: string, isStarred: boolean) => {
    markStar(emailId, isStarred);
  });

  ipcMain.handle('mail:pin', async (_e, emailId: string, isPinned: boolean) => {
    pinEmail(emailId, isPinned);
    try {
      const email = getEmail(emailId);
      if (!email) return;
      const account = getAccount(email.accountId);
      if (!account) return;
      const password = getPassword(email.accountId);
      await imapPinEmail(account, password, email.folder, email.uid, email.messageId ?? '', isPinned);
    } catch (err) {
      console.error('[pin] IMAP error:', (err as Error).message);
    }
  });

  ipcMain.handle('mail:delete', async (_e, emailId: string) => {
    const email = getEmail(emailId);
    if (!email) return;
    // Gmailと同様、ゴミ箱移動時に既読にする
    if (!email.isRead) markRead(emailId, true);
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

  ipcMain.handle('mail:getUnreadCounts', (_e, accountId: string) => {
    return getAllFolderUnreadCounts(accountId);
  });

  ipcMain.handle('mail:markSpam', async (_e, emailId: string) => {
    const email = getEmail(emailId);
    if (!email) throw new Error('メールが見つかりません');
    const account = getAccount(email.accountId);
    if (!account) throw new Error('アカウントが見つかりません');
    const password = getPassword(email.accountId);

    // スパムフォルダを探す（Gmail: [Gmail]/迷惑メール or [Gmail]/Spam）
    const { fetchFolders: fetchFols } = await import('../services/imap');
    const folders = await fetchFols(account, password);
    const spamFolder = folders.find((f) =>
      f.specialUse === '\\Junk' ||
      f.path.toLowerCase().includes('spam') ||
      f.path.includes('迷惑') ||
      f.path.toLowerCase().includes('junk'),
    );

    const targetFolder = spamFolder?.path ?? '[Gmail]/Spam';

    // IMAPでスパムフォルダに移動
    try {
      await imapMoveEmail(account, password, email.folder, email.uid, targetFolder);
    } catch {}

    // DBでも移動・既読にする
    moveEmail(emailId, targetFolder);
    markRead(emailId, true);

    return targetFolder;
  });

  ipcMain.handle('mail:fetchAttachments', async (_e, emailId: string) => {
    const email = getEmail(emailId);
    if (!email) throw new Error('メールが見つかりません');
    const account = getAccount(email.accountId);
    if (!account) throw new Error('アカウントが見つかりません');
    const password = getPassword(email.accountId);
    const attachments = await fetchAttachmentsForEmail(account, password, email.folder, email.uid);
    if (attachments.length > 0) {
      saveAttachments(emailId, attachments);
    }
    // 保存後の最新データを返す
    return getEmail(emailId);
  });

  ipcMain.handle('mail:downloadAttachment', async (_e, attachmentId: string) => {
    const att = getAttachmentContent(attachmentId);
    if (!att) throw new Error('添付ファイルが見つかりません');

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: att.filename,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (!filePath) return null; // キャンセル

    fs.writeFileSync(filePath, att.content);
    shell.showItemInFolder(filePath);
    return filePath;
  });
}

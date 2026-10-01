import { app, ipcMain, safeStorage, dialog, shell } from 'electron';
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
  getTotalUnreadCount,
  listThreads,
  getThreadEmails,
  getThreadUnreadCounts,
  getDistinctFolders,
  getContactSuggestions,
} from '../db/queries/emails';

function refreshBadge(): void {
  try { app.setBadgeCount(getTotalUnreadCount()); } catch { /* 無視 */ }
}
import { syncFolder, fetchFolders, imapMarkRead, imapMarkAllRead, imapPinEmail, imapDeleteEmail, imapMoveEmail, fetchAttachmentsForEmail, syncFolderOlderEmails } from '../services/imap';
import { sendEmail } from '../services/smtp';
import { listBlocklist } from '../db/queries/blocklist';
import { getDb } from '../db/index';

/**
 * メールID（'accountId-uid-sourceFolder' 形式）から実際の IMAP フォルダを取得する。
 * フィルタ移動メールは email.folder が表示フォルダに変わっているが、
 * UID は元フォルダ（ID末尾）のものなので、そちらを使わないとフラグ更新が失敗する。
 */
function extractSourceFolder(emailId: string, accountId: string, fallbackFolder: string): string {
  const prefix = `${accountId}-`;
  if (!emailId.startsWith(prefix)) return fallbackFolder;
  const rest = emailId.slice(prefix.length); // 'uid-sourceFolder'
  const dashIdx = rest.indexOf('-');
  if (dashIdx === -1) return fallbackFolder;
  const sourceFolder = rest.slice(dashIdx + 1);
  return sourceFolder || fallbackFolder;
}

function applyBlocklistToExistingEmails(accountId: string): void {
  const entries = listBlocklist(accountId);
  if (entries.length === 0) return;
  const db = getDb();
  for (const entry of entries) {
    const pattern = entry.pattern.toLowerCase();
    if (entry.type === 'address') {
      db.prepare(`UPDATE emails SET folder = 'Trash', is_read = 1 WHERE account_id = ? AND lower(from_address) = ? AND folder != 'Trash'`).run(accountId, pattern);
    } else {
      db.prepare(`UPDATE emails SET folder = 'Trash', is_read = 1 WHERE account_id = ? AND lower(from_address) LIKE ? AND folder != 'Trash'`).run(accountId, `%@${pattern}`);
    }
  }
}

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
    applyBlocklistToExistingEmails(accountId);

    // 仮想フォルダ名を実際のIMAPフォルダパスに解決
    let imapFolder = folder;
    const VIRTUAL_FOLDERS: Record<string, RegExp> = {
      Sent:   /Sent|送信済み/i,
      Drafts: /Draft|下書き/i,
      Trash:  /Trash|ゴミ箱|Deleted Items/i,
      Starred: /スター|Starred|Flagged/i,
      Spam:   /Spam|Junk|迷惑/i,
    };
    if (folder in VIRTUAL_FOLDERS) {
      const known = getDistinctFolders(accountId);
      const re = VIRTUAL_FOLDERS[folder];
      const fromDb = known.find((f) => re.test(f) && f !== folder);
      if (fromDb) {
        imapFolder = fromDb;
      } else if (folder === 'Starred') {
        imapFolder = 'INBOX';
      } else if (folder === 'Spam') {
        // まだ一度も同期されていない場合、DBに実パスが無いのでIMAPから直接探す
        try {
          const serverFolders = await fetchFolders(account, password);
          const spamFolder = serverFolders.find((f) =>
            f.specialUse === '\\Junk' ||
            f.path.toLowerCase().includes('spam') ||
            f.path.toLowerCase().includes('junk') ||
            f.path.includes('迷惑'),
          );
          imapFolder = spamFolder?.path ?? folder;
        } catch {
          imapFolder = folder;
        }
      } else {
        imapFolder = folder;
      }
    }

    return syncFolder(account, password, imapFolder);
  });

  ipcMain.handle('mail:backfillOlderEmails', async (_e, accountId: string, folder: string, limit = 50) => {
    const account = getAccount(accountId);
    if (!account) throw new Error('アカウントが見つかりません');
    // 仮想フォルダはバックフィル対象外
    const VIRTUAL = new Set(['Starred', 'Sent', 'Drafts', 'Trash', 'Spam']);
    if (VIRTUAL.has(folder)) return 0;
    const password = getPassword(accountId);
    return syncFolderOlderEmails(account, password, folder, limit);
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
    refreshBadge();
    try {
      const account = getAccount(email.accountId);
      if (!account) return;
      const password = getPassword(email.accountId);
      // IDは 'accountId-uid-sourceFolder' 形式なので、実際にUIDが存在するフォルダを使う
      // フィルタ移動メールは folder が表示フォルダに変わっているが UID は元フォルダのもの
      const sourceFolder = extractSourceFolder(emailId, email.accountId, email.folder);
      await imapMarkRead(account, password, sourceFolder, email.uid, isRead);
    } catch {}
  });

  ipcMain.handle('mail:markAllRead', async (_e, accountId: string, folder: string) => {
    markAllReadInFolder(accountId, folder);
    refreshBadge();
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
    refreshBadge();
    try {
      const account = getAccount(email.accountId);
      if (!account) return;
      const password = getPassword(email.accountId);
      const sourceFolder = extractSourceFolder(emailId, email.accountId, email.folder);
      await imapDeleteEmail(account, password, sourceFolder, email.uid);
    } catch {}
  });

  ipcMain.handle('mail:move', async (_e, emailId: string, toFolder: string) => {
    const email = getEmail(emailId);
    if (!email) return;
    moveEmail(emailId, toFolder);
    refreshBadge();
    try {
      const account = getAccount(email.accountId);
      if (!account) return;
      const password = getPassword(email.accountId);
      const sourceFolder = extractSourceFolder(emailId, email.accountId, email.folder);
      await imapMoveEmail(account, password, sourceFolder, email.uid, toFolder);
    } catch {}
  });

  ipcMain.handle('mail:search', (_e, accountId: string, query: string) => {
    return searchEmails(accountId, query);
  });

  ipcMain.handle('mail:contactSuggestions', (_e, accountId: string, query: string, limit = 8) => {
    return getContactSuggestions(accountId, query, limit);
  });

  ipcMain.handle('mail:getUnreadCounts', (_e, accountId: string) => {
    return getAllFolderUnreadCounts(accountId);
  });

  ipcMain.handle('mail:getThreadUnreadCounts', (_e, accountId: string) => {
    return getThreadUnreadCounts(accountId);
  });

  ipcMain.handle('mail:fetchThreads', (_e, accountId: string, folder: string, limit = 50, offset = 0) => {
    return listThreads(accountId, folder, limit, offset);
  });

  ipcMain.handle('mail:fetchThreadEmails', (_e, accountId: string, threadId: string | null, folder: string) => {
    return getThreadEmails(accountId, threadId, folder);
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
    refreshBadge();

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

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    // http(s) のみ許可
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });
}

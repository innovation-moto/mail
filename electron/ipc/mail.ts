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
} from '../db/queries/emails';

function refreshBadge(): void {
  try { app.setBadgeCount(getTotalUnreadCount()); } catch { /* 無視 */ }
}
import { BrowserWindow } from 'electron';
import { fetchFolders, imapMarkRead, imapMarkAllRead, imapPinEmail, imapDeleteEmail, imapMoveEmail, fetchAttachmentsForEmail } from '../services/imap';
import { syncAllAccounts } from '../services/sync';
import { sendEmail } from '../services/smtp';

function getPassword(accountId: string): string {
  const enc = getEncryptedPassword(accountId);
  if (!enc) throw new Error('パスワードが見つかりません');
  return safeStorage.decryptString(enc);
}

export function registerMailHandlers(win: BrowserWindow): void {
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

  ipcMain.handle('mail:sync', async (_e, _accountId: string, _folder = 'INBOX') => {
    // 全アカウントの背景同期をトリガー（winを渡してUIへ通知）
    syncAllAccounts(win).catch(console.error);
    return { added: 0 };
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
      await imapMarkRead(account, password, email.folder, email.uid, isRead);
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

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    // httpまたはhttpsのURLのみ外部ブラウザで開く
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // ファビコン取得（メインプロセス経由でCSP制限を回避）
  const faviconCache = new Map<string, string | null>();

  /** サブドメインを除いたルートドメインを返す（例: mail.foo.co.jp → foo.co.jp） */
  function getRootDomain(domain: string): string {
    const parts = domain.split('.');
    // co.jp / ne.jp / or.jp などの 2段階TLDを考慮
    if (parts.length > 2 && parts[parts.length - 2].length <= 3) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  async function fetchFavicon(domain: string): Promise<string | null> {
    const sources = [
      // Clearbit: 企業ロゴ専用、高品質（404を返すので安全）
      `https://logo.clearbit.com/${domain}`,
      // Google gstatic Favicon API v2: アイコンなし → 404（globe問題なし）
      `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`,
      // DuckDuckGo
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
      // 直接取得
      `https://${domain}/favicon.ico`,
    ];

    for (const url of sources) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        const contentType = res.headers.get('content-type') || '';
        // HTMLエラーページを除外
        if (contentType.startsWith('text/')) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 50) continue;
        const mimeType = contentType.split(';')[0] || 'image/x-icon';
        return `data:${mimeType};base64,${buf.toString('base64')}`;
      } catch {
        // 次のソースを試す
      }
    }
    return null;
  }

  /**
   * 送信者名からドメイン候補を生成する
   * 例: "Luxury Card" → ["luxurycard.co.jp", "luxurycard.com", "luxury-card.co.jp"]
   */
  function guessDomainsFromName(name: string): string[] {
    const base = name.toLowerCase().replace(/[^a-z0-9぀-鿿]+/g, '');
    if (!base || base.length < 2) return [];
    const baseHyphen = name.toLowerCase().replace(/[^a-z0-9぀-鿿]+/g, '-').replace(/^-|-$/g, '');
    const tlds = ['.co.jp', '.com', '.jp', '.net'];
    const candidates: string[] = [];
    for (const tld of tlds) {
      candidates.push(`${base}${tld}`);
      if (baseHyphen !== base) candidates.push(`${baseHyphen}${tld}`);
    }
    return candidates;
  }

  ipcMain.handle('favicon:get', async (_e, domain: string, senderName?: string) => {
    if (!domain) return null;
    const cacheKey = `${domain}:${senderName ?? ''}`;
    if (faviconCache.has(cacheKey)) return faviconCache.get(cacheKey) ?? null;

    // まず元のドメインで試す
    let result = await fetchFavicon(domain);

    // 失敗した場合、ルートドメインで再試行（サブドメイン対策）
    if (!result) {
      const root = getRootDomain(domain);
      if (root !== domain) {
        result = await fetchFavicon(root);
      }
    }

    // まだ失敗している場合、送信者名からドメインを推測して試す
    if (!result && senderName) {
      for (const guessed of guessDomainsFromName(senderName)) {
        if (guessed === domain || guessed === getRootDomain(domain)) continue;
        result = await fetchFavicon(guessed);
        if (result) break;
      }
    }

    faviconCache.set(cacheKey, result);
    return result;
  });
}

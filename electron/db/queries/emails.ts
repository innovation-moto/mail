import { getDb } from '../index';
import { Email, EmailAddress, Attachment } from '../../../shared/types';

interface EmailRow {
  id: string;
  account_id: string;
  uid: number;
  message_id: string;
  folder: string;
  from_address: string;
  from_name: string;
  to_addresses: string;
  cc_addresses: string;
  subject: string;
  body_text: string;
  body_html: string;
  date: number;
  is_read: number;
  is_starred: number;
  is_pinned: number;
  is_deleted: number;
  has_attachments: number;
  ai_category: string | null;
  ai_priority: string | null;
  ai_summary: string | null;
  ai_actions: string | null;
  thread_id: string | null;
  synced_at: number;
}

interface AttachmentRow {
  id: string;
  email_id: string;
  filename: string;
  content_type: string;
  size: number;
}

function rowToEmail(row: EmailRow, attachments: Attachment[] = []): Email {
  return {
    id: row.id,
    accountId: row.account_id,
    uid: row.uid,
    messageId: row.message_id,
    folder: row.folder,
    from: { name: row.from_name, address: row.from_address },
    to: JSON.parse(row.to_addresses) as EmailAddress[],
    cc: JSON.parse(row.cc_addresses) as EmailAddress[],
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    date: row.date,
    isRead: row.is_read === 1,
    isStarred: row.is_starred === 1,
    isPinned: row.is_pinned === 1,
    isDeleted: row.is_deleted === 1,
    hasAttachments: row.has_attachments === 1,
    aiCategory: row.ai_category,
    aiPriority: row.ai_priority as Email['aiPriority'],
    aiSummary: row.ai_summary,
    aiActions: row.ai_actions ? JSON.parse(row.ai_actions) : null,
    threadId: row.thread_id,
    attachments,
  };
}

// 仮想フォルダ名 → 実際のDBフォルダパターン（IMAP実装差異を吸収）
const VIRTUAL_FOLDER_PATTERNS: Record<string, RegExp> = {
  Sent:   /^(Sent|INBOX\.Sent|INBOX\.Sent Messages|Sent Items|送信済み|\[Gmail\]\/送信済みメール)$/i,
  Drafts: /^(Drafts|INBOX\.Drafts|下書き|\[Gmail\]\/下書き)$/i,
  Trash:  /^(Trash|INBOX\.Trash|ゴミ箱|Deleted|\[Gmail\]\/ゴミ箱)$/i,
};

export function listEmails(
  accountId: string,
  folder: string,
  limit = 50,
  offset = 0,
): Email[] {
  const db = getDb();
  const pattern = VIRTUAL_FOLDER_PATTERNS[folder];
  if (pattern) {
    // 仮想フォルダ: 対象パターンに合致するDBフォルダをすべて検索
    const allRows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND is_deleted = 0
      ORDER BY date DESC
    `).all(accountId) as EmailRow[];
    const rows = allRows
      .filter((r) => pattern.test(r.folder))
      .slice(offset, offset + limit);
    return rows.map((r) => rowToEmail(r));
  }
  const rows = db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND folder = ? AND is_deleted = 0
    ORDER BY date DESC
    LIMIT ? OFFSET ?
  `).all(accountId, folder, limit, offset) as EmailRow[];
  return rows.map((r) => rowToEmail(r));
}

export function getEmail(id: string): Email | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(id) as EmailRow | undefined;
  if (!row) return null;
  const attachmentRows = db.prepare('SELECT id, email_id, filename, content_type, size FROM attachments WHERE email_id = ?')
    .all(id) as AttachmentRow[];
  const attachments: Attachment[] = attachmentRows.map((a) => ({
    id: a.id,
    emailId: a.email_id,
    filename: a.filename,
    contentType: a.content_type,
    size: a.size,
  }));
  return rowToEmail(row, attachments);
}

export interface UpsertEmailData {
  id: string;
  accountId: string;
  uid: number;
  messageId: string;
  folder: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  date: number;
  isRead: boolean;
  isStarred?: boolean;
  hasAttachments: boolean;
  threadId?: string;
}

export function upsertEmail(data: UpsertEmailData): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO emails (
      id, account_id, uid, message_id, folder, from_address, from_name,
      to_addresses, cc_addresses, subject, body_text, body_html,
      date, is_read, is_starred, has_attachments, thread_id, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      is_read = excluded.is_read,
      is_starred = excluded.is_starred,
      synced_at = excluded.synced_at
  `).run(
    data.id,
    data.accountId,
    data.uid,
    data.messageId,
    data.folder,
    data.from.address,
    data.from.name,
    JSON.stringify(data.to),
    JSON.stringify(data.cc),
    data.subject,
    data.bodyText,
    data.bodyHtml,
    data.date,
    data.isRead ? 1 : 0,
    data.isStarred ? 1 : 0,
    data.hasAttachments ? 1 : 0,
    data.threadId ?? null,
    Date.now(),
  );
}

export function markRead(emailId: string, isRead: boolean): void {
  getDb().prepare('UPDATE emails SET is_read = ? WHERE id = ?').run(isRead ? 1 : 0, emailId);
}

export function markAllReadInFolder(accountId: string, folder: string): string[] {
  const rows = getDb()
    .prepare("SELECT id FROM emails WHERE account_id = ? AND folder = ? AND is_read = 0 AND is_deleted = 0")
    .all(accountId, folder) as { id: string }[];
  if (rows.length > 0) {
    getDb()
      .prepare("UPDATE emails SET is_read = 1 WHERE account_id = ? AND folder = ? AND is_read = 0 AND is_deleted = 0")
      .run(accountId, folder);
  }
  return rows.map((r) => r.id);
}

export function markStar(emailId: string, isStarred: boolean): void {
  getDb().prepare('UPDATE emails SET is_starred = ? WHERE id = ?').run(isStarred ? 1 : 0, emailId);
}

export function pinEmail(emailId: string, isPinned: boolean): void {
  getDb().prepare('UPDATE emails SET is_pinned = ? WHERE id = ?').run(isPinned ? 1 : 0, emailId);
}

export function listPinnedEmails(accountId: string): Email[] {
  const rows = getDb().prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND is_pinned = 1 AND is_deleted = 0
    ORDER BY date DESC
  `).all(accountId) as EmailRow[];
  return rows.map((r) => rowToEmail(r));
}

export function markDeleted(emailId: string): void {
  getDb().prepare("UPDATE emails SET is_deleted = 1, folder = 'Trash' WHERE id = ?").run(emailId);
}

export function moveEmail(emailId: string, folder: string): void {
  getDb().prepare('UPDATE emails SET folder = ? WHERE id = ?').run(folder, emailId);
}

export function searchEmails(accountId: string, query: string): Email[] {
  const db = getDb();
  const q = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND is_deleted = 0
      AND (subject LIKE ? OR from_address LIKE ? OR from_name LIKE ? OR body_text LIKE ?)
    ORDER BY date DESC
    LIMIT 100
  `).all(accountId, q, q, q, q) as EmailRow[];
  return rows.map((r) => rowToEmail(r));
}

export function updateAiFields(
  emailId: string,
  fields: { category?: string; priority?: string; summary?: string; actions?: string[] },
): void {
  const db = getDb();
  const updates: string[] = [];
  const values: unknown[] = [];
  if (fields.category !== undefined) { updates.push('ai_category = ?'); values.push(fields.category); }
  if (fields.priority !== undefined) { updates.push('ai_priority = ?'); values.push(fields.priority); }
  if (fields.summary !== undefined) { updates.push('ai_summary = ?'); values.push(fields.summary); }
  if (fields.actions !== undefined) { updates.push('ai_actions = ?'); values.push(JSON.stringify(fields.actions)); }
  if (updates.length === 0) return;
  values.push(emailId);
  db.prepare(`UPDATE emails SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

export function getUnreadCount(accountId: string, folder: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM emails
    WHERE account_id = ? AND folder = ? AND is_read = 0 AND is_deleted = 0
  `).get(accountId, folder) as { count: number };
  return row.count;
}

export function getAllFolderUnreadCounts(accountId: string): Record<string, number> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT folder, COUNT(*) as count FROM emails
    WHERE account_id = ? AND is_read = 0 AND is_deleted = 0
      AND folder NOT LIKE '%Trash%'
      AND folder NOT LIKE '%ゴミ箱%'
      AND folder NOT LIKE '%Deleted%'
      AND folder NOT LIKE '%迷惑%'
      AND folder NOT LIKE '%Spam%'
      AND folder NOT LIKE '%Junk%'
    GROUP BY folder
  `).all(accountId) as { folder: string; count: number }[];
  return Object.fromEntries(rows.map((r) => [r.folder, r.count]));
}

export function getTotalUnreadCount(): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM emails
    WHERE is_read = 0 AND is_deleted = 0
      AND folder NOT LIKE '%Trash%'
      AND folder NOT LIKE '%ゴミ箱%'
      AND folder NOT LIKE '%Deleted%'
      AND folder NOT LIKE '%迷惑%'
      AND folder NOT LIKE '%Spam%'
      AND folder NOT LIKE '%Junk%'
      AND folder NOT LIKE '%Sent%'
      AND folder NOT LIKE '%送信%'
      AND folder NOT LIKE '%Draft%'
      AND folder NOT LIKE '%下書き%'
  `).get() as { count: number };
  return row.count;
}

export function getDistinctFolders(accountId: string): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT folder FROM emails WHERE account_id = ? AND is_deleted = 0
  `).all(accountId) as { folder: string }[];
  return rows.map((r) => r.folder);
}

export function getMaxUid(accountId: string, folder: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT MAX(uid) as max_uid FROM emails
    WHERE account_id = ? AND folder = ? AND is_deleted = 0
  `).get(accountId, folder) as { max_uid: number | null };
  const result = row.max_uid ?? 0;
  console.log(`[db] getMaxUid(${folder}) = ${result}`);
  return result;
}

export function getEmailUidsForFolder(
  accountId: string,
  folder: string,
  limit = 200,
): { id: string; uid: number; isRead: boolean; isStarred: boolean }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, uid, is_read, is_starred FROM emails
    WHERE account_id = ? AND folder = ? AND is_deleted = 0
    ORDER BY uid DESC LIMIT ?
  `).all(accountId, folder, limit) as { id: string; uid: number; is_read: number; is_starred: number }[];
  return rows.map((r) => ({
    id: r.id,
    uid: r.uid,
    isRead: r.is_read === 1,
    isStarred: r.is_starred === 1,
  }));
}

export function updateEmailFlags(id: string, isRead: boolean, isStarred: boolean): void {
  getDb().prepare(
    'UPDATE emails SET is_read = ?, is_starred = ? WHERE id = ?',
  ).run(isRead ? 1 : 0, isStarred ? 1 : 0, id);
}

export function saveAttachments(
  emailId: string,
  attachments: Array<{ filename: string; contentType: string; size: number; content: ArrayBuffer }>,
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO attachments (id, email_id, filename, content_type, size, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  attachments.forEach((a, i) => {
    const id = `${emailId}-att-${i}`;
    stmt.run(id, emailId, a.filename, a.contentType, a.size, Buffer.from(a.content));
  });
}

export function getAttachmentContent(attachmentId: string): { filename: string; contentType: string; content: Buffer } | null {
  const db = getDb();
  const row = db.prepare('SELECT filename, content_type, content FROM attachments WHERE id = ?').get(attachmentId) as
    | { filename: string; content_type: string; content: Buffer }
    | undefined;
  if (!row) return null;
  return { filename: row.filename, contentType: row.content_type, content: row.content };
}

export function getRecentEmailsForSearch(accountId: string, limit = 200): Email[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM emails WHERE account_id = ? AND is_deleted = 0
    ORDER BY date DESC LIMIT ?
  `).all(accountId, limit) as EmailRow[];
  return rows.map((r) => rowToEmail(r));
}

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
  reply_to_address: string | null;
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
    replyToAddress: row.reply_to_address ?? undefined,
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

export function listEmails(
  accountId: string,
  folder: string,
  limit = 50,
  offset = 0,
): Email[] {
  const db = getDb();
  let rows: EmailRow[];
  if (folder === 'Sent') {
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND is_deleted = 0
        AND (folder LIKE '%Sent%' OR folder LIKE '%送信済み%')
      ORDER BY date DESC LIMIT ? OFFSET ?
    `).all(accountId, limit, offset) as EmailRow[];
  } else if (folder === 'Drafts') {
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND is_deleted = 0
        AND (folder LIKE '%Draft%' OR folder LIKE '%下書き%')
      ORDER BY date DESC LIMIT ? OFFSET ?
    `).all(accountId, limit, offset) as EmailRow[];
  } else if (folder === 'Trash') {
    // markDeleted は削除時に is_deleted=1 と folder='Trash' を同時にセットするため、
    // ゴミ箱表示では is_deleted を条件にしない（絞ると削除したメールが消えてしまう）
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ?
        AND (folder LIKE '%Trash%' OR folder LIKE '%ゴミ箱%' OR folder LIKE '%Deleted%')
      ORDER BY date DESC LIMIT ? OFFSET ?
    `).all(accountId, limit, offset) as EmailRow[];
  } else {
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND folder = ? AND is_deleted = 0
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `).all(accountId, folder, limit, offset) as EmailRow[];
  }
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
  replyToAddress?: string;
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
      to_addresses, cc_addresses, reply_to_address, subject, body_text, body_html,
      date, is_read, is_starred, has_attachments, thread_id, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      is_read = MAX(emails.is_read, excluded.is_read),
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
    data.replyToAddress ?? null,
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

  // 同一 message_id の重複を排除し、既読状態を引き継ぐ
  if (data.messageId) {
    // 【全フォルダ対象】既読版が他フォルダにあれば既読を引き継ぐ
    // Gmail では同じメールが INBOX・カスタムラベル・[Gmail]/重要 等に別UID で存在するため
    const dup = db.prepare(`
      SELECT MAX(is_read) as max_read FROM emails
      WHERE account_id = ? AND message_id = ? AND id != ?
    `).get(data.accountId, data.messageId, data.id) as { max_read: number | null };
    if (dup?.max_read === 1) {
      db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(data.id);
    }
    // 【同一フォルダ内のみ】重複レコードを削除（別フォルダの同メールは保持）
    db.prepare(`
      DELETE FROM emails
      WHERE account_id = ? AND message_id = ? AND folder = ? AND id != ?
        AND is_deleted = 0
    `).run(data.accountId, data.messageId, data.folder, data.id);
  }
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
  // message_id で重複排除（Gmail は同じメールが複数フォルダに存在するため）
  // 優先順位: カスタムフォルダ > INBOX > [Gmail]/重要 > その他
  const rows = db.prepare(`
    WITH matched AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(message_id, ''), id)
          ORDER BY
            CASE
              WHEN folder NOT LIKE '%Gmail%' AND folder NOT LIKE '%[Gmail]%'
                AND folder != 'INBOX' THEN 1
              WHEN folder = 'INBOX' THEN 2
              WHEN folder LIKE '%重要%' OR folder LIKE '%Important%' THEN 3
              ELSE 4
            END,
            uid DESC
        ) as rn
      FROM emails
      WHERE account_id = ? AND is_deleted = 0
        AND (subject LIKE ? OR from_address LIKE ? OR from_name LIKE ? OR body_text LIKE ?)
    )
    SELECT * FROM matched WHERE rn = 1
    ORDER BY date DESC
    LIMIT 100
  `).all(accountId, q, q, q, q) as (EmailRow & { rn: number })[];
  return rows.map((r) => rowToEmail(r));
}

/**
 * 過去の送受信履歴からメールアドレス候補を集計する。
 * - from（受信相手）と to/cc（送信先）の両方を対象
 * - 利用頻度の高い相手を上位に、前方一致を部分一致より優先
 */
export function getContactSuggestions(accountId: string, query: string, limit = 8): EmailAddress[] {
  const db = getDb();
  const q = query.trim().toLowerCase();

  // アドレス（小文字）-> { 表示名, 出現回数, 最終利用日時 }
  const map = new Map<string, { name: string; count: number; last: number }>();
  const add = (address: string | null | undefined, name: string | null | undefined, dateMs: number) => {
    if (!address) return;
    const addr = address.trim().toLowerCase();
    if (!addr || !addr.includes('@')) return;
    const nm = (name ?? '').trim();
    const existing = map.get(addr);
    if (existing) {
      existing.count += 1;
      if (dateMs > existing.last) existing.last = dateMs;
      if (!existing.name && nm) existing.name = nm;
    } else {
      map.set(addr, { name: nm, count: 1, last: dateMs });
    }
  };

  // 新しい順に最大3000件スキャン（連絡先の網羅より頻出・直近を優先）
  const rows = db.prepare(`
    SELECT from_address, from_name, to_addresses, cc_addresses, date
    FROM emails
    WHERE account_id = ?
    ORDER BY date DESC
    LIMIT 3000
  `).all(accountId) as Pick<EmailRow, 'from_address' | 'from_name' | 'to_addresses' | 'cc_addresses' | 'date'>[];

  for (const r of rows) {
    add(r.from_address, r.from_name, r.date);
    try {
      for (const a of JSON.parse(r.to_addresses) as EmailAddress[]) add(a.address, a.name, r.date);
      for (const a of JSON.parse(r.cc_addresses) as EmailAddress[]) add(a.address, a.name, r.date);
    } catch { /* JSON崩れは無視 */ }
  }

  let entries = Array.from(map.entries()).map(([address, v]) => ({ address, name: v.name, count: v.count, last: v.last }));

  if (q) {
    entries = entries.filter((e) => e.address.includes(q) || e.name.toLowerCase().includes(q));
    entries.sort((a, b) => {
      const aPre = a.address.startsWith(q) || a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bPre = b.address.startsWith(q) || b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aPre !== bPre) return aPre - bPre;
      if (b.count !== a.count) return b.count - a.count;
      return b.last - a.last;
    });
  } else {
    entries.sort((a, b) => (b.count !== a.count ? b.count - a.count : b.last - a.last));
  }

  return entries.slice(0, limit).map((e) => ({ name: e.name, address: e.address }));
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
      AND folder NOT LIKE '%IM-Mail-Config%'
      AND folder NOT LIKE '%すべてのメール%'
      AND folder NOT LIKE '%All Mail%'
      AND folder NOT LIKE '%重要%'
      AND folder NOT LIKE '%Important%'
    GROUP BY folder
  `).all(accountId) as { folder: string; count: number }[];
  return Object.fromEntries(rows.map((r) => [r.folder, r.count]));
}

export function getTotalUnreadCount(): number {
  const db = getDb();
  // message_id で重複排除（Gmail は同じメールが複数フォルダに存在するため二重カウントを防ぐ）
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT COALESCE(NULLIF(message_id, ''), id) as msg_key
      FROM emails
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
        AND folder NOT LIKE '%IM-Mail-Config%'
        AND folder NOT LIKE '%すべてのメール%'
        AND folder NOT LIKE '%All Mail%'
        AND folder NOT LIKE '%重要%'
        AND folder NOT LIKE '%Important%'
      GROUP BY msg_key
    )
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

export function getMinUidForFolder(accountId: string, folder: string): number {
  const db = getDb();
  // id 形式 'accountId-uid-sourceFolder' でそのフォルダから取得されたメールの最小UIDを返す
  const row = db.prepare(`
    SELECT MIN(uid) as min_uid FROM emails
    WHERE account_id = ? AND id LIKE ? AND is_deleted = 0
  `).get(accountId, `${accountId}-%-${folder}`) as { min_uid: number | null };
  return row?.min_uid ?? 0;
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

/**
 * フォルダごとに「そのIMAPフォルダから実際に取得した」最終UIDを取得する。
 * getMaxUid() はINBOXから移動されたメールのUIDで汚染されるため使わない。
 */
export function getFolderLastUid(accountId: string, folder: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT last_uid FROM folder_sync_state WHERE account_id = ? AND folder = ?',
  ).get(accountId, folder) as { last_uid: number } | undefined;
  return row?.last_uid ?? 0;
}

export function setFolderLastUid(accountId: string, folder: string, uid: number): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO folder_sync_state (account_id, folder, last_uid) VALUES (?, ?, ?) ON CONFLICT(account_id, folder) DO UPDATE SET last_uid = MAX(last_uid, excluded.last_uid)',
  ).run(accountId, folder, uid);
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

// DBではカスタムフォルダにあるが、IMAPサーバー上はまだINBOXにある可能性があるメール
export function getCustomFolderEmailUids(accountId: string): Map<number, string> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT uid, folder FROM emails
    WHERE account_id = ?
      AND folder != 'INBOX'
      AND folder NOT LIKE '%Gmail%'
      AND folder NOT LIKE '%重要%'
      AND folder NOT LIKE '%Important%'
      AND folder NOT LIKE '%Sent%'
      AND folder NOT LIKE '%送信%'
      AND folder NOT LIKE '%Draft%'
      AND folder NOT LIKE '%下書き%'
      AND folder NOT LIKE '%Trash%'
      AND folder NOT LIKE '%ゴミ箱%'
      AND folder NOT LIKE '%Spam%'
      AND folder NOT LIKE '%Junk%'
      AND folder NOT LIKE '%迷惑%'
      AND is_deleted = 0
  `).all(accountId) as { uid: number; folder: string }[];
  // uid → 移動先フォルダ のマップ
  return new Map(rows.map((r) => [r.uid, r.folder]));
}

export function getAllEmailUidsWithFlagsForFolder(
  accountId: string,
  folder: string,
): { id: string; uid: number; isRead: boolean; isStarred: boolean }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, uid, is_read, is_starred FROM emails
    WHERE account_id = ? AND folder = ? AND is_deleted = 0
    ORDER BY uid DESC
  `).all(accountId, folder) as { id: string; uid: number; is_read: number; is_starred: number }[];
  return rows.map((r) => ({
    id: r.id,
    uid: r.uid,
    isRead: r.is_read === 1,
    isStarred: r.is_starred === 1,
  }));
}

export function getAllEmailUidsForFolder(accountId: string, folder: string): Set<number> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT uid FROM emails
    WHERE account_id = ? AND folder = ? AND is_deleted = 0
  `).all(accountId, folder) as { uid: number }[];
  return new Set(rows.map((r) => r.uid));
}

/**
 * SQLite上では別フォルダに移動済みだが、IMAPサーバー上はまだ元フォルダにある可能性があるメールを返す。
 * IDが `${accountId}-${uid}-${originalFolder}` 形式なので、IDに元フォルダ名が含まれ
 * かつ現在のfolderフィールドが元フォルダと異なるものを検索する。
 */
export function getEmailsMovedFromFolder(
  accountId: string,
  originalFolder: string,
): { uid: number; folder: string }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT uid, folder FROM emails
    WHERE account_id = ?
      AND id LIKE ('%' || '-' || ?)
      AND folder != ?
      AND is_deleted = 0
  `).all(accountId, originalFolder, originalFolder) as { uid: number; folder: string }[];
  return rows;
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

export interface ThreadSummary {
  threadId: string;
  subject: string;
  latestFrom: { name: string; address: string };
  latestDate: number;
  emailCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  latestEmailId: string;
  aiPriority: string | null;
  folder: string;
}

export function listThreads(
  accountId: string,
  folder: string,
  limit = 50,
  offset = 0,
): ThreadSummary[] {
  const db = getDb();

  // 仮想フォルダの処理
  let folderCondition: string;
  let queryParams: unknown[];
  if (folder === 'Starred') {
    folderCondition = 'e.account_id = ? AND e.is_starred = 1 AND e.is_deleted = 0';
    queryParams = [accountId, limit, offset];
  } else if (folder === 'Sent') {
    folderCondition = `e.account_id = ? AND e.is_deleted = 0
      AND (e.folder LIKE '%Sent%' OR e.folder LIKE '%送信済み%')`;
    queryParams = [accountId, limit, offset];
  } else if (folder === 'Drafts') {
    folderCondition = `e.account_id = ? AND e.is_deleted = 0
      AND (e.folder LIKE '%Draft%' OR e.folder LIKE '%下書き%')`;
    queryParams = [accountId, limit, offset];
  } else if (folder === 'Trash') {
    // markDeleted は削除時に is_deleted=1 と folder='Trash' を同時にセットするため、
    // ゴミ箱表示では is_deleted を条件にしない（絞ると削除したメールが消えてしまう）
    folderCondition = `e.account_id = ?
      AND (e.folder LIKE '%Trash%' OR e.folder LIKE '%ゴミ箱%' OR e.folder LIKE '%Deleted%')`;
    queryParams = [accountId, limit, offset];
  } else {
    folderCondition = 'e.account_id = ? AND e.folder = ? AND e.is_deleted = 0';
    queryParams = [accountId, folder, limit, offset];
  }

  // ゴミ箱では is_deleted=1 の行も latest_email_id の対象にする（上記と同じ理由）
  const latestIdDeletedCondition = folder === 'Trash' ? '' : 'AND e2.is_deleted = 0';

  const rows = db.prepare(`
    SELECT
      e.thread_id,
      e.subject,
      e.from_name,
      e.from_address,
      MAX(e.date) as latest_date,
      COUNT(*) as email_count,
      SUM(CASE WHEN e.is_read = 0 THEN 1 ELSE 0 END) as unread_count,
      MAX(e.has_attachments) as has_attachments,
      e.ai_priority,
      e.folder,
      (SELECT id FROM emails e2
       WHERE e2.thread_id = e.thread_id
         AND e2.account_id = e.account_id
         AND e2.folder = e.folder
         ${latestIdDeletedCondition}
       ORDER BY date DESC LIMIT 1) as latest_email_id
    FROM emails e
    WHERE ${folderCondition}
      AND e.thread_id IS NOT NULL
    GROUP BY e.thread_id
    ORDER BY MAX(e.date) DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams) as any[];
  return rows.map((r) => ({
    threadId: r.thread_id,
    subject: r.subject,
    latestFrom: { name: r.from_name ?? '', address: r.from_address ?? '' },
    latestDate: r.latest_date,
    emailCount: r.email_count,
    unreadCount: r.unread_count,
    hasAttachments: r.has_attachments === 1,
    latestEmailId: r.latest_email_id,
    aiPriority: r.ai_priority,
    folder: r.folder,
  }));
}

export function getThreadEmails(accountId: string, threadId: string | null, folder: string): Email[] {
  if (!threadId) return [];
  const db = getDb();
  let rows: EmailRow[];
  if (folder === 'Starred') {
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND thread_id = ? AND is_starred = 1 AND is_deleted = 0
      ORDER BY date DESC LIMIT 200
    `).all(accountId, threadId) as EmailRow[];
  } else if (folder === 'Sent') {
    // 送信済み・下書き・ゴミ箱は個別メール表示のため threadId にメールIDが渡される。
    // 実 thread_id（バックフィル時）とメールID（一覧クリック時）の両方に対応する。
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND (thread_id = ? OR id = ?) AND is_deleted = 0
        AND (folder LIKE '%Sent%' OR folder LIKE '%送信済み%')
      ORDER BY date DESC LIMIT 200
    `).all(accountId, threadId, threadId) as EmailRow[];
  } else if (folder === 'Drafts') {
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND (thread_id = ? OR id = ?) AND is_deleted = 0
        AND (folder LIKE '%Draft%' OR folder LIKE '%下書き%')
      ORDER BY date DESC LIMIT 200
    `).all(accountId, threadId, threadId) as EmailRow[];
  } else if (folder === 'Trash') {
    // markDeleted は削除時に is_deleted=1 と folder='Trash' を同時にセットするため、
    // ゴミ箱表示では is_deleted を条件にしない（絞ると削除したメールが消えてしまう）
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND (thread_id = ? OR id = ?)
        AND (folder LIKE '%Trash%' OR folder LIKE '%ゴミ箱%' OR folder LIKE '%Deleted%')
      ORDER BY date DESC LIMIT 200
    `).all(accountId, threadId, threadId) as EmailRow[];
  } else {
    // 送信済み等は一覧で個別メール表示のため、実フォルダ名＋メールID（threadId）で
    // クリックされる。thread_id（グループ）とメールID（個別）の両方に対応する。
    rows = db.prepare(`
      SELECT * FROM emails
      WHERE account_id = ? AND (thread_id = ? OR id = ?) AND folder = ? AND is_deleted = 0
      ORDER BY date DESC LIMIT 200
    `).all(accountId, threadId, threadId, folder) as EmailRow[];
  }
  return rows.map((r) => rowToEmail(r));
}

export function getThreadUnreadCounts(accountId: string): Record<string, number> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT folder, COUNT(DISTINCT thread_id) as count FROM emails
    WHERE account_id = ? AND is_read = 0 AND is_deleted = 0
      AND folder NOT LIKE '%Trash%' AND folder NOT LIKE '%ゴミ箱%'
      AND folder NOT LIKE '%Spam%' AND folder NOT LIKE '%Junk%'
      AND folder NOT LIKE '%迷惑%' AND folder NOT LIKE '%Sent%'
      AND folder NOT LIKE '%送信%' AND folder NOT LIKE '%Draft%'
      AND folder NOT LIKE '%下書き%' AND folder NOT LIKE '%IM-Mail-Config%'
      AND folder NOT LIKE '%すべてのメール%' AND folder NOT LIKE '%All Mail%'
      AND folder NOT LIKE '%重要%' AND folder NOT LIKE '%Important%'
    GROUP BY folder
  `).all(accountId) as { folder: string; count: number }[];
  return Object.fromEntries(rows.map((r) => [r.folder, r.count]));
}

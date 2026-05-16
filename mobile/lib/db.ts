import * as SQLite from 'expo-sqlite';
import type { Email, EmailAddress, FilterRule, FilterCondition, Signature } from '@/shared/types';

let db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('immail.db');
  }
  return db;
}

export async function initDb(): Promise<void> {
  const database = getDb();

  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'custom',
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
      imap_secure INTEGER NOT NULL DEFAULT 1,
      smtp_host TEXT NOT NULL,
      smtp_port INTEGER NOT NULL,
      smtp_secure INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      uid INTEGER,
      message_id TEXT,
      folder TEXT NOT NULL DEFAULT 'INBOX',
      from_address TEXT NOT NULL,
      from_name TEXT NOT NULL DEFAULT '',
      to_addresses TEXT NOT NULL DEFAULT '[]',
      cc_addresses TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      date INTEGER NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      is_starred INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      ai_category TEXT,
      ai_priority TEXT,
      ai_summary TEXT,
      ai_actions TEXT,
      thread_id TEXT,
      synced_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_emails_account_folder ON emails(account_id, folder);
    CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
    CREATE INDEX IF NOT EXISTS idx_emails_read ON emails(is_read);

    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      name TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS block_list (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(account_id, email)
    );

    CREATE TABLE IF NOT EXISTS filter_rules (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      conditions TEXT NOT NULL DEFAULT '[]',
      condition_type TEXT NOT NULL DEFAULT 'any',
      action_folder TEXT,
      action_mark_read INTEGER NOT NULL DEFAULT 0,
      action_starred INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);
}

function rowToEmail(row: Record<string, unknown>): Email {
  let from: EmailAddress = { name: '', address: '' };
  try {
    from = {
      name: (row.from_name as string) ?? '',
      address: (row.from_address as string) ?? '',
    };
  } catch {}

  let to: EmailAddress[] = [];
  let cc: EmailAddress[] = [];
  try { to = JSON.parse((row.to_addresses as string) ?? '[]'); } catch {}
  try { cc = JSON.parse((row.cc_addresses as string) ?? '[]'); } catch {}

  let aiActions: string[] | null = null;
  try {
    aiActions = row.ai_actions ? JSON.parse(row.ai_actions as string) : null;
  } catch {}

  return {
    id: row.id as string,
    accountId: row.account_id as string,
    uid: (row.uid as number) ?? 0,
    messageId: (row.message_id as string) ?? '',
    folder: (row.folder as string) ?? 'INBOX',
    from,
    to,
    cc,
    subject: (row.subject as string) ?? '',
    bodyText: (row.body_text as string) ?? '',
    bodyHtml: (row.body_html as string) ?? '',
    date: (row.date as number) ?? 0,
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred),
    isPinned: Boolean(row.is_pinned),
    isDeleted: Boolean(row.is_deleted),
    hasAttachments: Boolean(row.has_attachments),
    aiCategory: (row.ai_category as string | null) ?? null,
    aiPriority: (row.ai_priority as 'high' | 'medium' | 'low' | null) ?? null,
    aiSummary: (row.ai_summary as string | null) ?? null,
    aiActions,
    threadId: (row.thread_id as string | null) ?? null,
    attachments: [],
  };
}

export async function upsertEmail(email: Email): Promise<void> {
  const database = getDb();
  await database.runAsync(
    `INSERT INTO emails (
      id, account_id, uid, message_id, folder,
      from_address, from_name, to_addresses, cc_addresses,
      subject, body_text, body_html, date,
      is_read, is_starred, is_pinned, is_deleted, has_attachments,
      ai_category, ai_priority, ai_summary, ai_actions, thread_id, synced_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      is_read = excluded.is_read,
      is_starred = excluded.is_starred,
      is_deleted = excluded.is_deleted,
      body_text = CASE WHEN excluded.body_text != '' THEN excluded.body_text ELSE body_text END,
      body_html = CASE WHEN excluded.body_html != '' THEN excluded.body_html ELSE body_html END,
      synced_at = excluded.synced_at`,
    [
      email.id,
      email.accountId,
      email.uid,
      email.messageId,
      email.folder,
      email.from.address,
      email.from.name,
      JSON.stringify(email.to),
      JSON.stringify(email.cc),
      email.subject,
      email.bodyText,
      email.bodyHtml,
      email.date,
      email.isRead ? 1 : 0,
      email.isStarred ? 1 : 0,
      email.isPinned ? 1 : 0,
      email.isDeleted ? 1 : 0,
      email.hasAttachments ? 1 : 0,
      email.aiCategory ?? null,
      email.aiPriority ?? null,
      email.aiSummary ?? null,
      email.aiActions ? JSON.stringify(email.aiActions) : null,
      email.threadId ?? null,
      Date.now(),
    ],
  );
}

export async function listEmails(
  accountId: string,
  folder: string,
  limit = 100,
  offset = 0,
): Promise<Email[]> {
  const database = getDb();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM emails
     WHERE account_id = ? AND folder = ? AND is_deleted = 0
     ORDER BY date DESC
     LIMIT ? OFFSET ?`,
    [accountId, folder, limit, offset],
  );
  return rows.map(rowToEmail);
}

export async function getEmail(id: string): Promise<Email | null> {
  const database = getDb();
  const row = await database.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM emails WHERE id = ?',
    [id],
  );
  if (!row) return null;
  return rowToEmail(row);
}

export async function markRead(id: string, isRead: boolean): Promise<void> {
  const database = getDb();
  await database.runAsync(
    'UPDATE emails SET is_read = ? WHERE id = ?',
    [isRead ? 1 : 0, id],
  );
}

export async function markStar(id: string, isStarred: boolean): Promise<void> {
  const database = getDb();
  await database.runAsync(
    'UPDATE emails SET is_starred = ? WHERE id = ?',
    [isStarred ? 1 : 0, id],
  );
}

export async function markDeleted(id: string): Promise<void> {
  const database = getDb();
  await database.runAsync(
    'UPDATE emails SET is_deleted = 1 WHERE id = ?',
    [id],
  );
}

/** フォルダ内のUID一覧を取得（フラグ同期用） */
export async function getUidsForFolder(accountId: string, folder: string): Promise<{ uid: number; id: string; isRead: boolean; isStarred: boolean }[]> {
  const database = getDb();
  const rows = await database.getAllAsync<{ uid: number; id: string; is_read: number; is_starred: number }>(
    'SELECT uid, id, is_read, is_starred FROM emails WHERE account_id = ? AND folder = ? AND is_deleted = 0',
    [accountId, folder],
  );
  return rows.map(r => ({ uid: r.uid, id: r.id, isRead: Boolean(r.is_read), isStarred: Boolean(r.is_starred) }));
}

/** フラグを一括更新（既読・スター） */
export async function updateEmailFlags(id: string, isRead: boolean, isStarred: boolean): Promise<void> {
  const database = getDb();
  await database.runAsync(
    'UPDATE emails SET is_read = ?, is_starred = ? WHERE id = ?',
    [isRead ? 1 : 0, isStarred ? 1 : 0, id],
  );
}

/** サーバーに存在しないメールをINBOXから除外（移動・削除済み） */
export async function removeExpungedEmails(accountId: string, folder: string, existingUids: number[]): Promise<void> {
  if (existingUids.length === 0) return;
  const database = getDb();
  // existingUids に含まれないUID（サーバーから消えたメール）を is_deleted = 1 にする
  const placeholders = existingUids.map(() => '?').join(',');
  await database.runAsync(
    `UPDATE emails SET is_deleted = 1
     WHERE account_id = ? AND folder = ? AND uid NOT IN (${placeholders}) AND is_deleted = 0`,
    [accountId, folder, ...existingUids],
  );
}

/** フォルダごとの未読数を一括取得 */
export async function getUnreadCountsByFolder(
  accountId: string,
): Promise<Record<string, number>> {
  const database = getDb();
  const rows = await database.getAllAsync<{ folder: string; cnt: number }>(
    `SELECT folder, COUNT(*) as cnt
     FROM emails
     WHERE account_id = ? AND is_read = 0 AND is_deleted = 0
       AND folder NOT LIKE '%Trash%'
       AND folder NOT LIKE '%ゴミ箱%'
       AND folder NOT LIKE '%Deleted%'
       AND folder NOT LIKE '%迷惑%'
       AND folder NOT LIKE '%Spam%'
       AND folder NOT LIKE '%Junk%'
     GROUP BY folder`,
    [accountId],
  );
  const result: Record<string, number> = {};
  for (const row of rows) result[row.folder] = row.cnt;
  return result;
}

export async function getMaxUid(accountId: string, folder: string): Promise<number> {
  const database = getDb();
  const row = await database.getFirstAsync<{ max_uid: number | null }>(
    'SELECT MAX(uid) as max_uid FROM emails WHERE account_id = ? AND folder = ?',
    [accountId, folder],
  );
  return row?.max_uid ?? 0;
}

// ─── フィルタールール ──────────────────────────────────────

function rowToFilterRule(row: Record<string, unknown>): FilterRule {
  let conditions: FilterCondition[] = [];
  try { conditions = JSON.parse(row.conditions as string); } catch {}
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    conditions,
    conditionType: (row.condition_type as 'all' | 'any') ?? 'any',
    actionFolder: (row.action_folder as string | null) ?? null,
    actionMarkRead: Boolean(row.action_mark_read),
    actionStarred: Boolean(row.action_starred),
    active: Boolean(row.active),
    createdAt: row.created_at as number,
  };
}

export async function listFilterRules(accountId: string): Promise<FilterRule[]> {
  const database = getDb();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM filter_rules WHERE account_id = ? ORDER BY created_at DESC',
    [accountId],
  );
  return rows.map(rowToFilterRule);
}

export async function createFilterRule(
  accountId: string,
  data: Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>,
): Promise<FilterRule> {
  const database = getDb();
  const id = `fr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = Date.now();
  await database.runAsync(
    `INSERT INTO filter_rules (id, account_id, name, conditions, condition_type, action_folder, action_mark_read, action_starred, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, accountId, data.name,
      JSON.stringify(data.conditions),
      data.conditionType,
      data.actionFolder ?? null,
      data.actionMarkRead ? 1 : 0,
      data.actionStarred ? 1 : 0,
      data.active ? 1 : 0,
      createdAt,
    ],
  );
  return { id, accountId, createdAt, ...data };
}

export async function deleteFilterRule(id: string): Promise<void> {
  const database = getDb();
  await database.runAsync('DELETE FROM filter_rules WHERE id = ?', [id]);
}

/** フィルタールールをメールに適用（syncEmails 後に呼ぶ） */
export interface FilterMatch {
  emailId: string;
  uid: number;
  fromFolder: string;
  toFolder: string | null;
  markRead: boolean;
  starred: boolean;
}

/** フィルタールールを適用してローカルDBを更新し、IMAP移動が必要なものを返す */
export async function applyFilterRules(accountId: string): Promise<FilterMatch[]> {
  const rules = await listFilterRules(accountId);
  if (rules.length === 0) return [];

  const database = getDb();
  const emails = await database.getAllAsync<Record<string, unknown>>(
    `SELECT id, uid, folder, from_address, to_addresses, subject, body_text, is_read, is_starred
     FROM emails WHERE account_id = ? AND is_deleted = 0`,
    [accountId],
  );

  const moves: FilterMatch[] = [];

  for (const email of emails) {
    for (const rule of rules) {
      if (!rule.active) continue;

      const matchFn = (c: FilterCondition): boolean => {
        let target = '';
        if (c.field === 'from')    target = (email.from_address as string) ?? '';
        if (c.field === 'to')      target = (email.to_addresses as string) ?? '';
        if (c.field === 'subject') target = (email.subject as string) ?? '';
        if (c.field === 'body')    target = (email.body_text as string) ?? '';
        target = target.toLowerCase();
        const v = c.value.toLowerCase();
        switch (c.operator) {
          case 'contains':    return target.includes(v);
          case 'equals':      return target === v;
          case 'startsWith':  return target.startsWith(v);
          case 'endsWith':    return target.endsWith(v);
          default:            return false;
        }
      };

      const matched = rule.conditionType === 'all'
        ? rule.conditions.every(matchFn)
        : rule.conditions.some(matchFn);

      if (!matched) continue;

      // ローカルDB更新
      if (rule.actionMarkRead && !email.is_read) {
        await database.runAsync('UPDATE emails SET is_read = 1 WHERE id = ?', [email.id]);
      }
      if (rule.actionStarred && !email.is_starred) {
        await database.runAsync('UPDATE emails SET is_starred = 1 WHERE id = ?', [email.id]);
      }
      if (rule.actionFolder && rule.actionFolder !== (email.folder as string)) {
        await database.runAsync('UPDATE emails SET folder = ? WHERE id = ?', [rule.actionFolder, email.id]);
      }

      // IMAP移動が必要な場合はリストに追加
      moves.push({
        emailId: email.id as string,
        uid: email.uid as number,
        fromFolder: email.folder as string,
        toFolder: rule.actionFolder ?? null,
        markRead: rule.actionMarkRead,
        starred: rule.actionStarred,
      });

      break; // 最初にマッチしたルールのみ適用
    }
  }

  return moves;
}

// ─── 署名 ──────────────────────────────────────────────────────────

export async function listSignatures(accountId?: string): Promise<Signature[]> {
  const database = getDb();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    accountId
      ? 'SELECT * FROM signatures WHERE account_id = ? OR account_id IS NULL ORDER BY created_at DESC'
      : 'SELECT * FROM signatures ORDER BY created_at DESC',
    accountId ? [accountId] : [],
  );
  return rows.map(r => ({
    id: r.id as string,
    accountId: (r.account_id as string | null) ?? undefined,
    name: r.name as string,
    content: r.content as string,
    isDefault: Boolean(r.is_default),
    createdAt: r.created_at as number,
  }));
}

export async function createSignature(data: Omit<Signature, 'id' | 'createdAt'> & { accountId?: string | null }): Promise<Signature> {
  const database = getDb();
  const id = `sig_${Date.now()}`;
  const createdAt = Date.now();
  if (data.isDefault) {
    await database.runAsync('UPDATE signatures SET is_default = 0 WHERE account_id = ? OR account_id IS NULL', [data.accountId ?? null]);
  }
  await database.runAsync(
    'INSERT INTO signatures (id, account_id, name, content, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, data.accountId ?? null, data.name, data.content, data.isDefault ? 1 : 0, createdAt],
  );
  return { id, createdAt, ...data };
}

export async function updateSignature(id: string, data: Partial<Omit<Signature, 'id' | 'createdAt'>>): Promise<void> {
  const database = getDb();
  if (data.isDefault) {
    await database.runAsync('UPDATE signatures SET is_default = 0');
    await database.runAsync('UPDATE signatures SET is_default = 1 WHERE id = ?', [id]);
  }
  if (data.name !== undefined) await database.runAsync('UPDATE signatures SET name = ? WHERE id = ?', [data.name, id]);
  if (data.content !== undefined) await database.runAsync('UPDATE signatures SET content = ? WHERE id = ?', [data.content, id]);
}

export async function deleteSignature(id: string): Promise<void> {
  const database = getDb();
  await database.runAsync('DELETE FROM signatures WHERE id = ?', [id]);
}

// ─── ブロックリスト ──────────────────────────────────────────────────

export async function listBlockList(accountId: string): Promise<{ id: string; email: string; createdAt: number }[]> {
  const database = getDb();
  const rows = await database.getAllAsync<{ id: string; email: string; created_at: number }>(
    'SELECT * FROM block_list WHERE account_id = ? ORDER BY created_at DESC',
    [accountId],
  );
  return rows.map(r => ({ id: r.id, email: r.email, createdAt: r.created_at }));
}

export async function addToBlockList(accountId: string, email: string): Promise<void> {
  const database = getDb();
  const id = `bl_${Date.now()}`;
  await database.runAsync(
    'INSERT OR IGNORE INTO block_list (id, account_id, email, created_at) VALUES (?, ?, ?, ?)',
    [id, accountId, email.toLowerCase().trim(), Date.now()],
  );
}

export async function removeFromBlockList(id: string): Promise<void> {
  const database = getDb();
  await database.runAsync('DELETE FROM block_list WHERE id = ?', [id]);
}

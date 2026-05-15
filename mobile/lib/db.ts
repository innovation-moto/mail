import * as SQLite from 'expo-sqlite';
import type { Email, EmailAddress } from '@/shared/types';

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

export async function getMaxUid(accountId: string, folder: string): Promise<number> {
  const database = getDb();
  const row = await database.getFirstAsync<{ max_uid: number | null }>(
    'SELECT MAX(uid) as max_uid FROM emails WHERE account_id = ? AND folder = ?',
    [accountId, folder],
  );
  return row?.max_uid ?? 0;
}

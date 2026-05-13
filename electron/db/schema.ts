export const SCHEMA_SQL = `
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
  password_encrypted BLOB NOT NULL,
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
  is_deleted INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  ai_category TEXT,
  ai_priority TEXT,
  ai_summary TEXT,
  ai_actions TEXT,
  thread_id TEXT,
  synced_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_emails_account_folder ON emails(account_id, folder);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_read ON emails(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  content BLOB,
  FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocklist (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('address', 'domain')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  to_addresses TEXT NOT NULL DEFAULT '[]',
  cc_addresses TEXT NOT NULL DEFAULT '[]',
  bcc_addresses TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  reply_to_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  conditions TEXT NOT NULL DEFAULT '[]',
  condition_type TEXT NOT NULL DEFAULT 'any',
  action_folder TEXT,
  action_mark_read INTEGER NOT NULL DEFAULT 0,
  action_starred INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings VALUES ('ai_enabled', 'false');
INSERT OR IGNORE INTO settings VALUES ('theme', 'system');
INSERT OR IGNORE INTO settings VALUES ('notifications_enabled', 'true');
INSERT OR IGNORE INTO settings VALUES ('notify_high_only', 'false');
INSERT OR IGNORE INTO settings VALUES ('sync_interval_sec', '30');
`;

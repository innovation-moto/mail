import { getDb } from '../index';
import { Account } from '../../../shared/types';

interface AccountRow {
  id: string;
  name: string;
  email: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  imap_secure: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  avatar: string | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: number | null;
  created_at: number;
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    provider: row.provider,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure === 1,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure === 1,
    avatar: row.avatar ?? undefined,
    oauthAccessToken: row.oauth_access_token ?? undefined,
    oauthRefreshToken: row.oauth_refresh_token ?? undefined,
    oauthExpiresAt: row.oauth_expires_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function listAccounts(): Account[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() as AccountRow[];
  return rows.map(rowToAccount);
}

export function getAccount(id: string): Account | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function insertAccount(
  id: string,
  config: Omit<Account, 'id' | 'createdAt'>,
  encryptedPassword: Buffer,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO accounts (id, name, email, provider, imap_host, imap_port, imap_secure,
      smtp_host, smtp_port, smtp_secure, password_encrypted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    config.name,
    config.email,
    config.provider,
    config.imapHost,
    config.imapPort,
    config.imapSecure ? 1 : 0,
    config.smtpHost,
    config.smtpPort,
    config.smtpSecure ? 1 : 0,
    encryptedPassword,
    Date.now(),
  );
}

export function updateAccount(
  id: string,
  config: Partial<Omit<Account, 'id' | 'createdAt'>>,
  encryptedPassword?: Buffer,
): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (config.name !== undefined) { fields.push('name = ?'); values.push(config.name); }
  if (config.email !== undefined) { fields.push('email = ?'); values.push(config.email); }
  if (config.provider !== undefined) { fields.push('provider = ?'); values.push(config.provider); }
  if (config.imapHost !== undefined) { fields.push('imap_host = ?'); values.push(config.imapHost); }
  if (config.imapPort !== undefined) { fields.push('imap_port = ?'); values.push(config.imapPort); }
  if (config.imapSecure !== undefined) { fields.push('imap_secure = ?'); values.push(config.imapSecure ? 1 : 0); }
  if (config.smtpHost !== undefined) { fields.push('smtp_host = ?'); values.push(config.smtpHost); }
  if (config.smtpPort !== undefined) { fields.push('smtp_port = ?'); values.push(config.smtpPort); }
  if (config.smtpSecure !== undefined) { fields.push('smtp_secure = ?'); values.push(config.smtpSecure ? 1 : 0); }
  if (config.avatar !== undefined) { fields.push('avatar = ?'); values.push(config.avatar ?? null); }
  if ((config as any).oauthAccessToken !== undefined) { fields.push('oauth_access_token = ?'); values.push((config as any).oauthAccessToken ?? null); }
  if ((config as any).oauthRefreshToken !== undefined) { fields.push('oauth_refresh_token = ?'); values.push((config as any).oauthRefreshToken ?? null); }
  if ((config as any).oauthExpiresAt !== undefined) { fields.push('oauth_expires_at = ?'); values.push((config as any).oauthExpiresAt ?? null); }
  if (encryptedPassword !== undefined) { fields.push('password_encrypted = ?'); values.push(encryptedPassword); }

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteAccount(id: string): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

export function getEncryptedPassword(id: string): Buffer | null {
  const db = getDb();
  const row = db.prepare('SELECT password_encrypted FROM accounts WHERE id = ?').get(id) as
    | { password_encrypted: Buffer }
    | undefined;
  return row?.password_encrypted ?? null;
}

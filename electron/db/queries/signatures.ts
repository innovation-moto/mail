import { getDb } from '../index';

export interface Signature {
  id: string;
  accountId: string | null;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: number;
}

interface SignatureRow {
  id: string;
  account_id: string | null;
  name: string;
  content: string;
  is_default: number;
  created_at: number;
}

function rowToSignature(row: SignatureRow): Signature {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    content: row.content,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  };
}

export function listSignatures(accountId?: string): Signature[] {
  const db = getDb();
  if (accountId) {
    const rows = db.prepare(`
      SELECT * FROM signatures
      WHERE account_id = ? OR account_id IS NULL
      ORDER BY is_default DESC, created_at ASC
    `).all(accountId) as SignatureRow[];
    return rows.map(rowToSignature);
  }
  const rows = db.prepare('SELECT * FROM signatures ORDER BY is_default DESC, created_at ASC').all() as SignatureRow[];
  return rows.map(rowToSignature);
}

export function getDefaultSignature(accountId: string): Signature | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM signatures
    WHERE (account_id = ? OR account_id IS NULL) AND is_default = 1
    ORDER BY account_id DESC
    LIMIT 1
  `).get(accountId) as SignatureRow | undefined;
  return row ? rowToSignature(row) : null;
}

export function insertSignature(id: string, data: Omit<Signature, 'id' | 'createdAt'>): void {
  const db = getDb();
  if (data.isDefault) {
    db.prepare(`UPDATE signatures SET is_default = 0 WHERE account_id = ? OR account_id IS NULL`)
      .run(data.accountId);
  }
  db.prepare(`
    INSERT INTO signatures (id, account_id, name, content, is_default, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.accountId ?? null, data.name, data.content, data.isDefault ? 1 : 0, Date.now());
}

export function updateSignature(id: string, data: Partial<Omit<Signature, 'id' | 'createdAt'>>): void {
  const db = getDb();
  if (data.isDefault) {
    const sig = db.prepare('SELECT account_id FROM signatures WHERE id = ?').get(id) as { account_id: string | null } | undefined;
    db.prepare(`UPDATE signatures SET is_default = 0 WHERE account_id = ? OR account_id IS NULL`)
      .run(sig?.account_id ?? null);
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.content !== undefined) { fields.push('content = ?'); values.push(data.content); }
  if (data.isDefault !== undefined) { fields.push('is_default = ?'); values.push(data.isDefault ? 1 : 0); }
  if (data.accountId !== undefined) { fields.push('account_id = ?'); values.push(data.accountId ?? null); }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE signatures SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSignature(id: string): void {
  getDb().prepare('DELETE FROM signatures WHERE id = ?').run(id);
}

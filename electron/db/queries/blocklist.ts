import { getDb } from '../index';
import { BlockEntry } from '../../../shared/types';

interface BlockRow {
  id: string;
  account_id: string;
  pattern: string;
  type: 'address' | 'domain';
  created_at: number;
}

export function listBlocklist(accountId: string): BlockEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM blocklist WHERE account_id = ? ORDER BY created_at DESC')
    .all(accountId) as BlockRow[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    pattern: r.pattern,
    type: r.type,
    createdAt: r.created_at,
  }));
}

export function addBlockEntry(id: string, accountId: string, pattern: string, type: 'address' | 'domain'): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO blocklist (id, account_id, pattern, type, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, accountId, pattern.toLowerCase(), type, Date.now());
}

export function removeBlockEntry(id: string): void {
  getDb().prepare('DELETE FROM blocklist WHERE id = ?').run(id);
}

export function isBlocked(accountId: string, fromAddress: string): boolean {
  const db = getDb();
  const addr = fromAddress.toLowerCase();
  const domain = addr.split('@')[1] ?? '';

  const row = db.prepare(`
    SELECT id FROM blocklist
    WHERE account_id = ?
      AND ((type = 'address' AND pattern = ?) OR (type = 'domain' AND pattern = ?))
    LIMIT 1
  `).get(accountId, addr, domain);
  return !!row;
}

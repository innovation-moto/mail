import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../index';
import { FilterRule, FilterCondition } from '../../../shared/types';

interface FilterRow {
  id: string;
  account_id: string;
  name: string;
  conditions: string;
  condition_type: string;
  action_folder: string | null;
  action_mark_read: number;
  action_starred: number;
  active: number;
  created_at: number;
}

function rowToFilter(row: FilterRow): FilterRule {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    conditions: JSON.parse(row.conditions) as FilterCondition[],
    conditionType: row.condition_type as 'all' | 'any',
    actionFolder: row.action_folder,
    actionMarkRead: row.action_mark_read === 1,
    actionStarred: row.action_starred === 1,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export function listFilters(accountId: string): FilterRule[] {
  const rows = getDb()
    .prepare('SELECT * FROM filters WHERE account_id = ? ORDER BY created_at ASC')
    .all(accountId) as FilterRow[];
  return rows.map(rowToFilter);
}

export function createFilter(
  accountId: string,
  data: Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>,
): FilterRule {
  const id = uuidv4();
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO filters (id, account_id, name, conditions, condition_type,
      action_folder, action_mark_read, action_starred, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, accountId, data.name,
    JSON.stringify(data.conditions),
    data.conditionType,
    data.actionFolder ?? null,
    data.actionMarkRead ? 1 : 0,
    data.actionStarred ? 1 : 0,
    data.active ? 1 : 0,
    now,
  );
  return { id, accountId, createdAt: now, ...data };
}

export function updateFilter(
  id: string,
  data: Partial<Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>>,
): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined)         { fields.push('name = ?');             values.push(data.name); }
  if (data.conditions !== undefined)   { fields.push('conditions = ?');       values.push(JSON.stringify(data.conditions)); }
  if (data.conditionType !== undefined){ fields.push('condition_type = ?');   values.push(data.conditionType); }
  if (data.actionFolder !== undefined) { fields.push('action_folder = ?');    values.push(data.actionFolder); }
  if (data.actionMarkRead !== undefined){ fields.push('action_mark_read = ?'); values.push(data.actionMarkRead ? 1 : 0); }
  if (data.actionStarred !== undefined){ fields.push('action_starred = ?');   values.push(data.actionStarred ? 1 : 0); }
  if (data.active !== undefined)       { fields.push('active = ?');           values.push(data.active ? 1 : 0); }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE filters SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteFilter(id: string): void {
  getDb().prepare('DELETE FROM filters WHERE id = ?').run(id);
}

export function applyFilters(
  accountId: string,
  email: { from: string; to: string; subject: string; body: string },
): { folder: string | null; markRead: boolean; starred: boolean } | null {
  const filters = listFilters(accountId).filter((f) => f.active);

  for (const filter of filters) {
    const matches = filter.conditions.map((c) => {
      const field = c.field === 'from' ? email.from
        : c.field === 'to' ? email.to
        : c.field === 'subject' ? email.subject
        : email.body;
      const val = field.toLowerCase();
      const q = c.value.toLowerCase();
      switch (c.operator) {
        case 'contains':   return val.includes(q);
        case 'equals':     return val === q;
        case 'startsWith': return val.startsWith(q);
        case 'endsWith':   return val.endsWith(q);
        default: return false;
      }
    });

    const matched = filter.conditionType === 'all'
      ? matches.every(Boolean)
      : matches.some(Boolean);

    if (matched) {
      return {
        folder: filter.actionFolder,
        markRead: filter.actionMarkRead,
        starred: filter.actionStarred,
      };
    }
  }
  return null;
}

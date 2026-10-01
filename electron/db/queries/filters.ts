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

export function getFilterAccountId(id: string): string | null {
  const row = getDb().prepare('SELECT account_id FROM filters WHERE id = ?').get(id) as { account_id: string } | undefined;
  return row?.account_id ?? null;
}

export function deleteFilter(id: string): void {
  getDb().prepare('DELETE FROM filters WHERE id = ?').run(id);
}

/** 指定フォルダを振り分け先とするフィルターをすべて削除（フォルダ削除時の連動用）。件数を返す。 */
export function deleteFiltersByFolder(accountId: string, folder: string): number {
  const info = getDb()
    .prepare('DELETE FROM filters WHERE account_id = ? AND action_folder = ?')
    .run(accountId, folder);
  return info.changes;
}

// システムフォルダ（振り分け対象外）判定
const SYSTEM_FOLDER_RE = [
  /^inbox$/i, /(^|\/)sent/i, /送信済み/i, /(^|\/)draft/i, /下書き/i,
  /(^|\/)trash/i, /ゴミ箱/i, /deleted/i, /(^|\/)spam/i, /junk/i, /迷惑/i,
  /starred/i, /スター/i, /flagged/i, /すべてのメール/i, /all\s*mail/i,
  /(^|\/)important/i, /重要/i, /im-mail-config/i, /^\[gmail\]$/i,
];

function isSystemFolder(folder: string): boolean {
  return SYSTEM_FOLDER_RE.some((re) => re.test(folder));
}

/**
 * 既存の各カスタムフォルダ（Gmail ラベル等でサーバ側振り分け済みを含む）から、
 * そのフォルダに入っているメールの送信者を推測してアプリフィルターを自動生成する。
 * 既にそのフォルダを振り分け先とするフィルターがある場合はスキップ（重複作成しない）。
 * 生成したフィルター件数を返す。
 */
export function generateFiltersFromFolders(accountId: string): number {
  const db = getDb();

  // メールが存在する全フォルダ
  const folders = (db.prepare(
    'SELECT DISTINCT folder FROM emails WHERE account_id = ? AND is_deleted = 0',
  ).all(accountId) as { folder: string }[]).map((r) => r.folder);

  // 既にフィルターの振り分け先になっているフォルダ
  const existing = new Set(
    (db.prepare('SELECT DISTINCT action_folder FROM filters WHERE account_id = ? AND action_folder IS NOT NULL')
      .all(accountId) as { action_folder: string }[]).map((r) => r.action_folder),
  );

  const now = Date.now();
  let created = 0;

  const insert = db.prepare(`
    INSERT INTO filters (id, account_id, name, conditions, condition_type,
      action_folder, action_mark_read, action_starred, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?)
  `);

  for (const folder of folders) {
    if (isSystemFolder(folder)) continue;
    if (existing.has(folder)) continue;

    // フォルダ内メールの送信者を頻度順に取得（最大8件）
    const senders = db.prepare(`
      SELECT from_address AS addr, COUNT(*) AS c
      FROM emails
      WHERE account_id = ? AND folder = ? AND is_deleted = 0 AND from_address != ''
      GROUP BY lower(from_address)
      ORDER BY c DESC
      LIMIT 8
    `).all(accountId, folder) as { addr: string; c: number }[];

    if (senders.length === 0) continue;

    const conditions: FilterCondition[] = senders.map((s) => ({
      field: 'from',
      operator: 'contains',
      value: s.addr,
    }));

    insert.run(
      uuidv4(), accountId, folder,
      JSON.stringify(conditions),
      'any',      // いずれかの送信者に一致
      folder,     // 振り分け先＝そのフォルダ
      now + created, // created_at を少しずらして並び順を安定化
    );
    created++;
  }

  return created;
}

export function replaceFiltersForAccount(accountId: string, rules: FilterRule[]): void {
  const db = getDb();
  db.prepare('DELETE FROM filters WHERE account_id = ?').run(accountId);
  for (const rule of rules) {
    db.prepare(`
      INSERT OR REPLACE INTO filters
        (id, account_id, name, conditions, condition_type,
         action_folder, action_mark_read, action_starred, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rule.id, accountId, rule.name,
      JSON.stringify(rule.conditions),
      rule.conditionType,
      rule.actionFolder ?? null,
      rule.actionMarkRead ? 1 : 0,
      rule.actionStarred ? 1 : 0,
      rule.active ? 1 : 0,
      rule.createdAt,
    );
  }
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

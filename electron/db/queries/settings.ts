import { getDb } from '../index';
import { Settings } from '../../../shared/types';

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getAllSettings(): Settings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    aiEnabled: map['ai_enabled'] === 'true',
    geminiApiKey: map['gemini_api_key'] ?? '',
    theme: (map['theme'] as Settings['theme']) ?? 'system',
    notificationsEnabled: map['notifications_enabled'] !== 'false',
    notifyHighOnly: map['notify_high_only'] === 'true',
    syncIntervalSec: parseInt(map['sync_interval_sec'] ?? '30', 10),
  };
}

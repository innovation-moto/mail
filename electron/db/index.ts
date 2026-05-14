import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { SCHEMA_SQL } from './schema';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'mail.db');
    db = new Database(dbPath);
    db.exec(SCHEMA_SQL);
    // マイグレーション: is_pinnedカラムを追加（既存DBへの対応）
    try {
      db.exec('ALTER TABLE emails ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
    } catch {
      // カラムが既に存在する場合は無視
    }
    // マイグレーション: avatarカラムを追加
    try {
      db.exec('ALTER TABLE accounts ADD COLUMN avatar TEXT');
    } catch {
      // カラムが既に存在する場合は無視
    }
    // マイグレーション: OAuthトークンカラムを追加
    try {
      db.exec('ALTER TABLE accounts ADD COLUMN oauth_access_token TEXT');
      db.exec('ALTER TABLE accounts ADD COLUMN oauth_refresh_token TEXT');
      db.exec('ALTER TABLE accounts ADD COLUMN oauth_expires_at INTEGER');
    } catch {
      // カラムが既に存在する場合は無視
    }
    // マイグレーション: ゴミ箱・迷惑メール内の未読メールを既読にする（Gmailと同じ挙動）
    db.exec(`
      UPDATE emails SET is_read = 1
      WHERE is_read = 0
        AND (
          folder LIKE '%Trash%'
          OR folder LIKE '%ゴミ箱%'
          OR folder LIKE '%Deleted%'
          OR folder LIKE '%迷惑%'
          OR folder LIKE '%Spam%'
          OR folder LIKE '%Junk%'
        )
    `);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

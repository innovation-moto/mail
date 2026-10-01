import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { SCHEMA_SQL } from './schema';
import { generateThreadId } from '../utils/thread';

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
    // マイグレーション: thread_idインデックス
    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(account_id, thread_id)');
    } catch {}

    // マイグレーション: 既存メールに thread_id を付与（全件）
    try {
      const rows = db.prepare(
        'SELECT id, account_id, subject, message_id FROM emails WHERE thread_id IS NULL',
      ).all() as { id: string; account_id: string; subject: string; message_id: string }[];
      if (rows.length > 0) {
        const update = db.prepare('UPDATE emails SET thread_id = ? WHERE id = ?');
        const run = db.transaction(() => {
          for (const row of rows) {
            update.run(generateThreadId(row.account_id, row.subject ?? '', row.message_id), row.id);
          }
        });
        run();
        console.log(`[migration] assigned thread_id to ${rows.length} emails`);
      }
    } catch (e) {
      console.warn('[migration] thread_id backfill failed:', e);
    }

    // マイグレーション: reply_to_address カラムを追加
    try {
      db.exec('ALTER TABLE emails ADD COLUMN reply_to_address TEXT');
    } catch {}

    // マイグレーション: folder_sync_state テーブルを追加（既存DBへの対応）
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS folder_sync_state (
        account_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        last_uid INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, folder),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`);
    } catch {}

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

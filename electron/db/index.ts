import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { SCHEMA_SQL } from './schema';
import { isReplySubject } from '../utils/thread';

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
            update.run(`${row.account_id}:msgid:${row.message_id || row.id}`, row.id);
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
        uid_validity TEXT,
        PRIMARY KEY (account_id, folder),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )`);
    } catch {}
    try {
      db.exec('ALTER TABLE folder_sync_state ADD COLUMN uid_validity TEXT');
    } catch {
      // カラムが既に存在する場合は無視
    }

    // マイグレーション: 件名だけでまとめていたスレッドを分解する（1回のみ）
    // 既存メールは返信ヘッダーを保存していないため、件名グループ内に Re:/Fwd: のメールが
    // 1通も無いもの（銀行通知など同じ件名の別メール）だけを1通ずつのスレッドに分ける。
    // 返信を含むグループは会話とみなして従来の件名スレッドのまま残す。
    try {
      const done = db.prepare("SELECT value FROM settings WHERE key = 'migration_thread_by_headers'").get();
      if (!done) {
        const rows = db.prepare(
          "SELECT id, account_id, thread_id, subject, message_id FROM emails WHERE thread_id IS NOT NULL AND thread_id NOT LIKE '%:msgid:%'",
        ).all() as { id: string; account_id: string; thread_id: string; subject: string | null; message_id: string | null }[];
        const groups = new Map<string, typeof rows>();
        for (const row of rows) {
          const g = groups.get(row.thread_id);
          if (g) g.push(row); else groups.set(row.thread_id, [row]);
        }
        const update = db.prepare('UPDATE emails SET thread_id = ? WHERE id = ?');
        let changed = 0;
        db.transaction(() => {
          for (const group of groups.values()) {
            if (group.some((r) => isReplySubject(r.subject ?? ''))) continue;
            for (const r of group) {
              update.run(`${r.account_id}:msgid:${r.message_id || r.id}`, r.id);
              changed++;
            }
          }
          db!.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_thread_by_headers', '1')").run();
        })();
        console.log(`[migration] split subject-only threads: ${changed} emails`);
      }
    } catch (e) {
      console.warn('[migration] thread split failed:', e);
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

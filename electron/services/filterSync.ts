import { ImapFlow } from 'imapflow';
import type { Account, FilterRule } from '../../shared/types';
import { getDb } from '../db/index';

const CONFIG_FOLDER = 'IM-Mail-Config';
const CONFIG_SUBJECT = '__IM-MAIL-FILTER-SYNC-V1__';
const FOLDER_STATE_SUBJECT = '__IM-MAIL-FOLDER-STATE-V1__';

async function safeLogout(client: ImapFlow): Promise<void> {
  try { await client.logout(); } catch { try { client.close(); } catch {} }
}

/**
 * フィルタールールをIMAPサーバーの設定フォルダに保存する（Mac→IMAP push）
 */
export async function pushFilterRulesToImap(
  account: Account,
  password: string,
  rules: FilterRule[],
): Promise<void> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    socketTimeout: 30000,
    greetingTimeout: 10000,
    disableAutoIdle: true,
  });

  try {
    await client.connect();

    // 設定フォルダを作成（既存の場合は無視）
    try {
      await client.mailboxCreate(CONFIG_FOLDER);
      console.log(`[filterSync] created folder: ${CONFIG_FOLDER}`);
    } catch {
      // 既存フォルダなので無視
    }

    // 既存の設定メールを削除
    const lock = await client.getMailboxLock(CONFIG_FOLDER);
    try {
      const existingUids = await client.search({ subject: CONFIG_SUBJECT }, { uid: true });
      if (existingUids && Array.isArray(existingUids) && existingUids.length > 0) {
        await client.messageDelete((existingUids as number[]).map(String).join(','), { uid: true });
        console.log(`[filterSync] deleted ${existingUids.length} old config emails`);
      }
    } finally {
      lock.release();
    }

    // 新しい設定メールを追加
    const emailBody = [
      `Subject: ${CONFIG_SUBJECT}`,
      `Content-Type: application/json; charset=utf-8`,
      `X-IM-Mail-Config: filters`,
      ``,
      JSON.stringify(rules),
    ].join('\r\n');

    await client.append(CONFIG_FOLDER, Buffer.from(emailBody), ['\\Seen']);
    console.log(`[filterSync] pushed ${rules.length} filter rules to IMAP`);
  } finally {
    await safeLogout(client);
  }
}

/**
 * INBOXから移動済みメールのフォルダ状態をIMAPに保存する（Mac→スマホ同期用）
 * accountIdのアカウントで、INBOX以外のカスタムフォルダにあるメールのUID→フォルダマッピングを保存
 */
export async function pushFolderStateToImap(
  account: Account,
  password: string,
  accountId: string,
): Promise<void> {
  const db = getDb();

  // INBOX以外のカスタムフォルダのメール（システムフォルダ除く）
  const rows = db.prepare(`
    SELECT uid, folder FROM emails
    WHERE account_id = ?
      AND folder != 'INBOX'
      AND folder NOT LIKE '%Gmail%'
      AND folder NOT LIKE '%重要%'
      AND folder NOT LIKE '%Important%'
      AND folder NOT LIKE '%Sent%'
      AND folder NOT LIKE '%送信%'
      AND folder NOT LIKE '%Draft%'
      AND folder NOT LIKE '%下書き%'
      AND folder NOT LIKE '%Trash%'
      AND folder NOT LIKE '%ゴミ箱%'
      AND folder NOT LIKE '%Spam%'
      AND folder NOT LIKE '%Junk%'
      AND folder NOT LIKE '%迷惑%'
      AND is_deleted = 0
  `).all({ account_id: accountId }) as { uid: number; folder: string }[];

  if (rows.length === 0) {
    console.log(`[folderState] no moved emails to push for ${account.email}`);
    return;
  }

  // { uid → folder } のマップに変換（重複UIDは最後のものを使う）
  const stateMap: Record<number, string> = {};
  for (const row of rows) {
    stateMap[row.uid] = row.folder;
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    socketTimeout: 30000,
    greetingTimeout: 10000,
    disableAutoIdle: true,
  });

  try {
    await client.connect();

    // 設定フォルダを作成（既存の場合は無視）
    try { await client.mailboxCreate(CONFIG_FOLDER); } catch {}

    // 既存のフォルダ状態メールを削除
    const lock = await client.getMailboxLock(CONFIG_FOLDER);
    try {
      const existingUids = await client.search({ subject: FOLDER_STATE_SUBJECT }, { uid: true });
      if (Array.isArray(existingUids) && existingUids.length > 0) {
        await client.messageDelete(existingUids.map(String).join(','), { uid: true });
      }
    } finally {
      lock.release();
    }

    // 新しいフォルダ状態メールを追加
    const emailBody = [
      `Subject: ${FOLDER_STATE_SUBJECT}`,
      `Content-Type: application/json; charset=utf-8`,
      `X-IM-Mail-Config: folder-state`,
      ``,
      JSON.stringify(stateMap),
    ].join('\r\n');

    await client.append(CONFIG_FOLDER, Buffer.from(emailBody), ['\\Seen']);
    console.log(`[folderState] pushed ${Object.keys(stateMap).length} folder states to IMAP for ${account.email}`);
  } finally {
    await safeLogout(client);
  }
}

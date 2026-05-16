import { ImapFlow } from 'imapflow';
import type { Account, FilterRule } from '../../shared/types';

const CONFIG_FOLDER = 'IM-Mail-Config';
const CONFIG_SUBJECT = '__IM-MAIL-FILTER-SYNC-V1__';

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

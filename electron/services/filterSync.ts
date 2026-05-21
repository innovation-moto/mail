import { ImapFlow } from 'imapflow';
import type { Account, FilterRule } from '../../shared/types';
import { getDb } from '../db/index';

const CONFIG_FOLDER = 'IM-Mail-Config';
const CONFIG_SUBJECT = '__IM-MAIL-FILTER-SYNC-V1__';
const FOLDER_STATE_SUBJECT = '__IM-MAIL-FOLDER-STATE-V1__';

/**
 * IMAPの設定フォルダからフィルタールールを取得してローカルDBに反映（スマホ→Mac同期）
 */
export async function pullFilterRulesFromImap(
  account: Account,
  password: string,
  accountId: string,
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

    let lock: { release: () => void } | null = null;
    try {
      lock = await client.getMailboxLock(CONFIG_FOLDER);
    } catch {
      return; // フォルダなし → 同期不要
    }

    try {
      const uidsResult = await client.search({ subject: CONFIG_SUBJECT }, { uid: true });
      const uids = Array.isArray(uidsResult) ? uidsResult : [];
      if (uids.length === 0) return;

      const latestUid = Math.max(...uids);
      let rulesJson = '';
      for await (const msg of client.fetch(String(latestUid), { source: true }, { uid: true })) {
        const source = msg.source?.toString() ?? '';
        const bodyStart = source.indexOf('\r\n\r\n');
        if (bodyStart !== -1) rulesJson = source.slice(bodyStart + 4).trim();
      }

      if (!rulesJson) return;
      const rules: FilterRule[] = JSON.parse(rulesJson);

      const { replaceFiltersForAccount, listFilters } = await import('../db/queries/filters');
      const localRules = listFilters(accountId);

      // IDセットで差分チェック — 同じ内容なら上書きしない
      const localIds = new Set(localRules.map(r => r.id));
      const imapIds = new Set(rules.map(r => r.id));
      const isDifferent =
        localIds.size !== imapIds.size ||
        rules.some(r => !localIds.has(r.id)) ||
        localRules.some(r => !imapIds.has(r.id));

      if (isDifferent) {
        replaceFiltersForAccount(accountId, rules);
        console.log(`[filterSync] pulled ${rules.length} rules from IMAP for ${account.email}`);
      }
    } finally {
      lock?.release();
    }
  } catch (err) {
    console.warn('[filterSync] pullFilterRulesFromImap failed:', (err as Error).message);
  } finally {
    await safeLogout(client);
  }
}

async function safeLogout(client: ImapFlow): Promise<void> {
  try { await client.logout(); } catch { try { client.close(); } catch {} }
}

/**
 * IM-Mail-Config 関連メールをIMAPの全フォルダから削除（一回限りのクリーンアップ用）
 */
export async function cleanupConfigMessages(account: Account, password: string): Promise<void> {
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

    // 削除対象のsubject一覧
    const targets = [CONFIG_SUBJECT, FOLDER_STATE_SUBJECT];

    // INBOX から削除
    const inboxLock = await client.getMailboxLock('INBOX');
    try {
      for (const subject of targets) {
        const uids = await client.search({ subject }, { uid: true });
        if (Array.isArray(uids) && uids.length > 0) {
          await client.messageDelete(uids.map(String).join(','), { uid: true });
          console.log(`[cleanup] deleted ${uids.length} "${subject}" from INBOX`);
        }
      }
    } catch (e) {
      console.warn('[cleanup] INBOX cleanup failed:', (e as Error).message);
    } finally {
      inboxLock.release();
    }

    // IM-Mail-Config フォルダごと削除
    try {
      const cfgLock = await client.getMailboxLock(CONFIG_FOLDER);
      try {
        await client.messageDelete('1:*', { uid: false });
      } catch {} finally {
        cfgLock.release();
      }
      await client.mailboxDelete(CONFIG_FOLDER);
      console.log(`[cleanup] deleted folder: ${CONFIG_FOLDER}`);
    } catch (e) {
      console.warn('[cleanup] config folder delete failed:', (e as Error).message);
    }
  } finally {
    await safeLogout(client);
  }
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

    // 既存の設定メールを全削除
    const lock = await client.getMailboxLock(CONFIG_FOLDER);
    try {
      const status = await client.status(CONFIG_FOLDER, { messages: true });
      if (status.messages && status.messages > 0) {
        await client.messageDelete('1:*', { uid: false });
        console.log(`[filterSync] deleted all old config emails`);
      }
    } catch {
      // 削除失敗は無視して上書き
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
  `).all(accountId) as { uid: number; folder: string }[];

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

    // 既存のフォルダ状態メールを全削除（subject検索が効かない環境向けに1:* で全消し）
    const lock = await client.getMailboxLock(CONFIG_FOLDER);
    try {
      const status = await client.status(CONFIG_FOLDER, { messages: true });
      if (status.messages && status.messages > 0) {
        await client.messageDelete('1:*', { uid: false });
      }
    } catch {
      // 削除失敗は無視して上書き
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

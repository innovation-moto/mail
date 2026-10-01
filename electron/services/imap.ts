import { ImapFlow, MailboxLockObject } from 'imapflow';
import { Account, Folder } from '../../shared/types';
import { parseRawEmail, ParsedEmail } from './parser';
import { upsertEmail, UpsertEmailData, getMaxUid, getFolderLastUid, setFolderLastUid, getMinUidForFolder, getEmailUidsForFolder, getAllEmailUidsForFolder, getAllEmailUidsWithFlagsForFolder, getCustomFolderEmailUids, updateEmailFlags, saveAttachments, moveEmail, listEmails } from '../db/queries/emails';
import { generateThreadId } from '../utils/thread';
import { isBlocked } from '../db/queries/blocklist';
import { applyFilters } from '../db/queries/filters';
import { refreshMicrosoftToken, buildXOAuth2Token } from './microsoftAuth';
import { updateAccount } from '../db/queries/accounts';

async function getValidAccessToken(account: Account): Promise<string> {
  const a = account as Account & { oauthAccessToken?: string; oauthRefreshToken?: string; oauthExpiresAt?: number };
  if (!a.oauthRefreshToken) throw new Error('OAuthトークンがありません');
  if (a.oauthExpiresAt && a.oauthExpiresAt > Date.now() + 60000) {
    return a.oauthAccessToken!;
  }
  const tokens = await refreshMicrosoftToken(a.oauthRefreshToken);
  updateAccount(account.id, {
    oauthAccessToken: tokens.accessToken,
    oauthRefreshToken: tokens.refreshToken,
    oauthExpiresAt: tokens.expiresAt,
  } as any);
  return tokens.accessToken;
}

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

function imapLog(account: string, entry: any): void {
  try {
    const logPath = path.join(app.getPath('userData'), 'imap.log');
    const line = `${new Date().toISOString()} [${account}] ${JSON.stringify(entry)}\n`;
    fs.appendFileSync(logPath, line);
  } catch {}
}

function createClient(account: Account, password: string): ImapFlow {
  const a = account as Account & { oauthAccessToken?: string };
  const auth = a.oauthAccessToken
    ? { user: account.email, accessToken: a.oauthAccessToken }
    : { user: account.email, pass: password };
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth,
    logger: {
      debug: (entry: any) => imapLog(account.email, { level: 'debug', ...entry }),
      info: (entry: any) => imapLog(account.email, { level: 'info', ...entry }),
      warn: (entry: any) => imapLog(account.email, { level: 'warn', ...entry }),
      error: (entry: any) => imapLog(account.email, { level: 'error', ...entry }),
    },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 20000,
    socketTimeout: 120000,
    greetingTimeout: 10000,
    disableAutoIdle: true,
  });
}

async function createClientWithRefresh(account: Account, password: string): Promise<ImapFlow> {
  const a = account as Account & { oauthRefreshToken?: string };
  if (a.oauthRefreshToken) {
    const accessToken = await getValidAccessToken(account);
    return new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      auth: { user: account.email, accessToken },
      logger: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 20000,
      socketTimeout: 30000,
      greetingTimeout: 10000,
      disableAutoIdle: true,
    });
  }
  return createClient(account, password);
}

async function safeLogout(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    try { client.close(); } catch {}
  }
}

export async function testImapConnection(
  host: string,
  port: number,
  secure: boolean,
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user: email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    socketTimeout: 20000,
    greetingTimeout: 15000,
  });
  try {
    await client.connect();
    await safeLogout(client);
    return { ok: true };
  } catch (err) {
    try { client.close(); } catch {}
    return { ok: false, error: (err as Error).message };
  }
}

export async function fetchFolders(account: Account, password: string): Promise<Folder[]> {
  const client = createClient(account, password);
  await client.connect();
  const folders: Folder[] = [];
  try {
    const list = await client.list();
    // INBOXのみSTATUSで実際の未読数を取得（他フォルダはローカルDB集計）
    let inboxUnread = 0;
    try {
      const status = await client.status('INBOX', { unseen: true });
      inboxUnread = status?.unseen ?? 0;
      console.log('[fetchFolders] IMAP STATUS INBOX unseen:', inboxUnread);
    } catch {}
    for (const f of list) {
      folders.push({
        path: f.path,
        name: f.name,
        delimiter: f.delimiter ?? '/',
        flags: Array.from(f.flags ?? []),
        specialUse: f.specialUse ?? null,
        unreadCount: f.path === 'INBOX' ? inboxUnread : 0,
      });
    }
  } finally {
    await safeLogout(client);
  }
  return folders;
}

export async function syncFolder(
  account: Account,
  password: string,
  folder = 'INBOX',
  limit = 50,
): Promise<{ added: number; blocked: number }> {
  const client = createClient(account, password);
  let lock: MailboxLockObject | null = null;
  let added = 0;
  let blocked = 0;

  try {
    await client.connect();
    lock = await client.getMailboxLock(folder);
    const mailbox = client.mailbox;
    if (!mailbox || mailbox.exists === 0) {
      console.log(`[sync] ${folder}: empty mailbox`);
      return { added, blocked };
    }

    console.log(`[sync] ${folder}: exists=${mailbox.exists}`);

    const lastKnownUid = getMaxUid(account.id, folder);
    console.log(`[sync] ${folder}: lastKnownUid=${lastKnownUid}`);

    let fetchRange: string;
    let fetchOpts: { uid: boolean } | undefined;

    if (lastKnownUid === 0) {
      // First sync: fetch latest N messages by sequence number
      const total = mailbox.exists;
      const startSeq = Math.max(1, total - limit + 1);
      fetchRange = `${startSeq}:*`;
      fetchOpts = undefined;
      console.log(`[sync] first sync, seq ${fetchRange}`);
    } else {
      // Incremental: fetch only messages with UID > lastKnownUid
      fetchRange = `${lastKnownUid + 1}:*`;
      fetchOpts = { uid: true };
      console.log(`[sync] incremental, uid ${fetchRange}`);
    }

    let count = 0;
    for await (const msg of client.fetch(
      fetchRange,
      { uid: true, flags: true, source: true },
      fetchOpts,
    )) {
      if (!msg.source) continue;
      if (count >= limit) break;
      count++;

      // IMAP仕様: '288:*' で * が287の場合、サーバーは287を返す。スキップする。
      if (lastKnownUid > 0 && msg.uid <= lastKnownUid) {
        console.log(`[sync] skip uid=${msg.uid} (already known)`);
        continue;
      }
      console.log(`[sync] msg uid=${msg.uid} seq=${msg.seq}`);

      let parsed: ParsedEmail;
      try {
        parsed = await parseRawEmail(msg.source);
      } catch (e) {
        console.error('[sync] parse error:', e);
        continue;
      }

      // ブロックリスト判定
      if (isBlocked(account.id, parsed.from.address)) {
        upsertEmail({
          id: `${account.id}-${msg.uid}-${folder}`,
          accountId: account.id, uid: msg.uid,
          messageId: parsed.messageId, folder: 'Trash',
          from: parsed.from, to: parsed.to, cc: parsed.cc,
          replyToAddress: parsed.replyToAddress,
          subject: parsed.subject, bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml, date: parsed.date,
          isRead: true, hasAttachments: parsed.hasAttachments,
          threadId: generateThreadId(account.id, parsed.subject, parsed.messageId),
        });
        blocked++;
        continue;
      }

      // フィルタールール適用
      const filterResult = applyFilters(account.id, {
        from: parsed.from.address,
        to: parsed.to.map((t) => t.address).join(' '),
        subject: parsed.subject,
        body: parsed.bodyText,
      });

      const targetFolder = filterResult?.folder ?? folder;
      const isRead = filterResult?.markRead ? true : (msg.flags?.has('\\Seen') ?? false);
      const isStarred = filterResult?.starred ?? false;

      // フィルターでフォルダ移動がある場合 IMAP サーバー側も移動
      if (filterResult?.folder && filterResult.folder !== folder) {
        try {
          await client.messageMove({ uid: msg.uid }, filterResult.folder, { uid: true });
        } catch {
          // 移動失敗しても DB には保存する
        }
      }

      const id = `${account.id}-${msg.uid}-${folder}`;
      console.log(`[sync] storing id=${id} folder=${targetFolder} subject="${parsed.subject}"`);
      upsertEmail({
        id,
        accountId: account.id, uid: msg.uid,
        messageId: parsed.messageId, folder: targetFolder,
        from: parsed.from, to: parsed.to, cc: parsed.cc,
        replyToAddress: parsed.replyToAddress,
        subject: parsed.subject, bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml, date: parsed.date,
        isRead, isStarred,
        hasAttachments: parsed.hasAttachments,
        threadId: generateThreadId(account.id, parsed.subject, parsed.messageId),
      });

      // 添付ファイルをDBに保存
      if (parsed.attachments.length > 0) {
        saveAttachments(id, parsed.attachments);
      }

      added++;
    }

    console.log(`[sync] ${folder}: done added=${added} blocked=${blocked} processed=${count}`);
  } finally {
    lock?.release();
    await safeLogout(client);
  }

  return { added, blocked };
}

export async function fetchAttachmentsForEmail(
  account: Account,
  password: string,
  folder: string,
  uid: number,
): Promise<Array<{ filename: string; contentType: string; size: number; content: ArrayBuffer }>> {
  const client = createClient(account, password);
  let lock: MailboxLockObject | null = null;
  try {
    await client.connect();
    lock = await client.getMailboxLock(folder);
    const attachments: Array<{ filename: string; contentType: string; size: number; content: ArrayBuffer }> = [];
    for await (const msg of client.fetch(String(uid), { uid: true, source: true }, { uid: true })) {
      if (!msg.source) break;
      const parsed = await parseRawEmail(msg.source);
      attachments.push(...parsed.attachments);
      break;
    }
    return attachments;
  } finally {
    lock?.release();
    await safeLogout(client);
  }
}

export async function syncFlags(
  account: Account,
  password: string,
  folder = 'INBOX',
): Promise<number> {
  const existing = getEmailUidsForFolder(account.id, folder, 200);
  if (existing.length === 0) return 0;

  const client = createClient(account, password);
  let lock: MailboxLockObject | null = null;
  let updated = 0;

  try {
    await client.connect();
    lock = await client.getMailboxLock(folder);

    const uidMap = new Map(existing.map((e) => [e.uid, e]));
    const uids = existing.map((e) => e.uid);
    const uidRange = uids.join(',');

    for await (const msg of client.fetch(uidRange, { uid: true, flags: true }, { uid: true })) {
      const entry = uidMap.get(msg.uid);
      if (!entry) continue;
      const isRead = msg.flags?.has('\\Seen') ?? false;
      const isStarred = msg.flags?.has('\\Flagged') ?? false;
      if (isRead !== entry.isRead || isStarred !== entry.isStarred) {
        updateEmailFlags(entry.id, isRead, isStarred);
        updated++;
      }
    }
  } finally {
    lock?.release();
    await safeLogout(client);
  }

  return updated;
}

/**
 * 1接続で全フォルダを順番に同期（接続過多によるタイムアウト解消）
 */
export async function syncAllFolders(
  account: Account,
  password: string,
  folders: string[],
  limit = 50,
  onFolderDone?: (folder: string, added: number, unreadAdded: number) => void,
): Promise<{ totalAdded: number }> {
  const client = await createClientWithRefresh(account, password);
  let totalAdded = 0;

  try {
    await client.connect();

    for (const folder of folders) {
      let lock: MailboxLockObject | null = null;
      try {
        lock = await client.getMailboxLock(folder);
        const mailbox = client.mailbox;
        if (!mailbox || mailbox.exists === 0) {
          lock.release();
          lock = null;
          continue;
        }

        console.log(`[sync] ${folder}: exists=${mailbox.exists}`);
        // folder_sync_state から正確な lastUid を取得（getMaxUid は INBOX 移動メールで汚染される）
        const lastKnownUid = getFolderLastUid(account.id, folder);
        console.log(`[sync] ${folder}: lastKnownUid=${lastKnownUid}`);

        let fetchRange: string;
        let fetchOpts: { uid: boolean } | undefined;
        if (lastKnownUid === 0) {
          const total = mailbox.exists;
          const startSeq = Math.max(1, total - limit + 1);
          fetchRange = `${startSeq}:*`;
          fetchOpts = undefined;
          console.log(`[sync] first sync, seq ${fetchRange}`);
        } else {
          fetchRange = `${lastKnownUid + 1}:*`;
          fetchOpts = { uid: true };
          console.log(`[sync] incremental, uid ${fetchRange}`);
        }

        let added = 0;
        let unreadAdded = 0;
        let count = 0;

        // フェッチ中にIMAP移動が必要なものを収集（ループ後にまとめて実行してハング回避）
        const pendingMoves: { uid: number; toFolder: string }[] = [];

        // --- 新着メール取得 ---
        for await (const msg of client.fetch(fetchRange, { uid: true, flags: true, source: true }, fetchOpts)) {
          if (!msg.source) continue;
          if (count >= limit) break;
          count++;
          if (lastKnownUid > 0 && msg.uid <= lastKnownUid) continue;
          console.log(`[sync] msg uid=${msg.uid} seq=${msg.seq}`);

          let parsed: ParsedEmail;
          try { parsed = await parseRawEmail(msg.source); } catch { continue; }

          if (isBlocked(account.id, parsed.from.address)) {
            upsertEmail({ id: `${account.id}-${msg.uid}-${folder}`, accountId: account.id, uid: msg.uid, messageId: parsed.messageId, folder: 'Trash', from: parsed.from, to: parsed.to, cc: parsed.cc, replyToAddress: parsed.replyToAddress, subject: parsed.subject, bodyText: parsed.bodyText, bodyHtml: parsed.bodyHtml, date: parsed.date, isRead: true, hasAttachments: parsed.hasAttachments, threadId: generateThreadId(account.id, parsed.subject, parsed.messageId) });
            continue;
          }

          const filterResult = applyFilters(account.id, { from: parsed.from.address, to: parsed.to.map((t) => t.address).join(' '), subject: parsed.subject, body: parsed.bodyText });
          const targetFolder = filterResult?.folder ?? folder;
          const isRead = filterResult?.markRead ? true : (msg.flags?.has('\\Seen') ?? false);
          const isStarred = filterResult?.starred ?? false;

          // フィルターでフォルダ移動がある場合は後でまとめて移動
          if (filterResult?.folder && filterResult.folder !== folder) {
            pendingMoves.push({ uid: msg.uid, toFolder: filterResult.folder });
          }

          upsertEmail({ id: `${account.id}-${msg.uid}-${folder}`, accountId: account.id, uid: msg.uid, messageId: parsed.messageId, folder: targetFolder, from: parsed.from, to: parsed.to, cc: parsed.cc, replyToAddress: parsed.replyToAddress, subject: parsed.subject, bodyText: parsed.bodyText, bodyHtml: parsed.bodyHtml, date: parsed.date, isRead, isStarred, hasAttachments: parsed.hasAttachments, threadId: generateThreadId(account.id, parsed.subject, parsed.messageId) });
          if (parsed.attachments.length > 0) saveAttachments(`${account.id}-${msg.uid}-${folder}`, parsed.attachments);
          // このフォルダの lastUid を更新（他フォルダのUID汚染を防ぐ）
          setFolderLastUid(account.id, folder, msg.uid);
          added++;
          if (!isRead) unreadAdded++;
        }

        // --- 既存メールのフィルター再適用（フィルター設定前に届いたメールを救済） ---
        if (folder === 'INBOX') {
          const existingEmails = listEmails(account.id, folder, 500, 0);
          for (const email of existingEmails) {
            const filterResult = applyFilters(account.id, {
              from: email.from.address,
              to: email.to.map((t) => t.address).join(' '),
              subject: email.subject,
              body: email.bodyText,
            });
            if (filterResult?.folder && filterResult.folder !== folder) {
              moveEmail(email.id, filterResult.folder);
              pendingMoves.push({ uid: email.uid, toFolder: filterResult.folder });
              console.log(`[filter] re-apply: uid=${email.uid} → ${filterResult.folder}`);
            }
          }

          // NOTE: DBのカスタムフォルダUIDとINBOX UID空間の不一致により誤移動が発生するため無効化
        }

        // --- フェッチ完了後にIMAPサーバー移動をまとめて実行 ---
        for (const { uid, toFolder } of pendingMoves) {
          try {
            await client.messageMove({ uid }, toFolder, { uid: true });
            console.log(`[filter] moved uid=${uid} → ${toFolder}`);
          } catch (e) {
            console.warn(`[filter] move failed uid=${uid}:`, (e as Error).message);
          }
        }

        // --- フラグ同期（全件・上限なし）---
        const existing = getAllEmailUidsWithFlagsForFolder(account.id, folder);
        if (existing.length > 0) {
          const uidMap = new Map(existing.map((e) => [e.uid, e]));
          const foundUids = new Set<number>();
          // IMAPのUID範囲指定は長すぎると失敗するので100件ずつバッチ処理
          const BATCH = 100;
          for (let i = 0; i < existing.length; i += BATCH) {
            const batch = existing.slice(i, i + BATCH);
            const uidRange = batch.map((e) => e.uid).join(',');
            for await (const msg of client.fetch(uidRange, { uid: true, flags: true }, { uid: true })) {
              foundUids.add(msg.uid);
              const entry = uidMap.get(msg.uid);
              if (!entry) continue;
              const isReadOnImap = msg.flags?.has('\\Seen') ?? false;
              const isStarred = msg.flags?.has('\\Flagged') ?? false;
              // IMAPのフラグを正として双方向同期（Gmail Web等での未読戻しも反映）
              const newIsRead = isReadOnImap;
              if (newIsRead !== entry.isRead || isStarred !== entry.isStarred) updateEmailFlags(entry.id, newIsRead, isStarred);
            }
          }
          // サーバー上に存在しないUID（UIDが変わった・削除済み）は既読にする
          for (const entry of existing) {
            if (!foundUids.has(entry.uid) && !entry.isRead) {
              updateEmailFlags(entry.id, true, entry.isStarred);
            }
          }
        }

        // --- バックフィル: サーバー上にあってDBに未登録のメールを取得 ---
        // lastKnownUid > 0 の場合はインクリメンタル同期で十分なためスキップ（全UID取得は高コスト）
        if (lastKnownUid === 0) try {
          const dbUids = getAllEmailUidsForFolder(account.id, folder);
          // 他フォルダに振り分け済みのUID（バックフィルで上書きしない）
          const otherFolderUids = getCustomFolderEmailUids(account.id);
          const serverUids: number[] = [];
          for await (const msg of client.fetch('1:*', { uid: true }, { uid: true })) {
            serverUids.push(msg.uid);
          }
          const missingUids = serverUids.filter((uid) => !dbUids.has(uid) && !otherFolderUids.has(uid));
          if (missingUids.length > 0) {
            console.log(`[sync] ${folder}: backfill ${missingUids.length} missing emails`);
            const BATCH = 10;
            for (let i = 0; i < missingUids.length; i += BATCH) {
              const batch = missingUids.slice(i, i + BATCH);
              const range = batch.join(',');
              for await (const msg of client.fetch(range, { uid: true, flags: true, source: true }, { uid: true })) {
                if (!msg.source) continue;
                let parsed: ParsedEmail;
                try { parsed = await parseRawEmail(msg.source); } catch { continue; }
                if (isBlocked(account.id, parsed.from.address)) continue;
                const filterResult = applyFilters(account.id, { from: parsed.from.address, to: parsed.to.map((t) => t.address).join(' '), subject: parsed.subject, body: parsed.bodyText });
                const targetFolder = filterResult?.folder ?? folder;
                const isRead = filterResult?.markRead ? true : (msg.flags?.has('\\Seen') ?? false);
                const isStarred = filterResult?.starred ?? false;
                upsertEmail({ id: `${account.id}-${msg.uid}-${folder}`, accountId: account.id, uid: msg.uid, messageId: parsed.messageId, folder: targetFolder, from: parsed.from, to: parsed.to, cc: parsed.cc, replyToAddress: parsed.replyToAddress, subject: parsed.subject, bodyText: parsed.bodyText, bodyHtml: parsed.bodyHtml, date: parsed.date, isRead, isStarred, hasAttachments: parsed.hasAttachments, threadId: generateThreadId(account.id, parsed.subject, parsed.messageId) });
                if (parsed.attachments.length > 0) saveAttachments(`${account.id}-${msg.uid}-${folder}`, parsed.attachments);
                setFolderLastUid(account.id, folder, msg.uid);
                added++;
              }
            }
          }
          // バックフィル完了後にサーバーの最大UIDを記録
          if (serverUids.length > 0) {
            setFolderLastUid(account.id, folder, Math.max(...serverUids));
          }
        } catch (backfillErr) {
          console.warn(`[sync] ${folder}: backfill failed (ignored):`, (backfillErr as Error).message);
        }

        console.log(`[sync] ${folder}: done added=${added} unreadAdded=${unreadAdded}`);
        totalAdded += added;
        onFolderDone?.(folder, added, unreadAdded);
      } catch (e) {
        console.error(`[sync] folder=${folder} error:`, (e as Error).message);
      } finally {
        lock?.release();
      }
    }
  } finally {
    await safeLogout(client);
  }

  return { totalAdded };
}

/**
 * スクロール時バックフィル: minUid より古いメールを IMAP から取得して DB に追加する。
 * limit 件まで取得し、追加件数を返す。
 */
export async function syncFolderOlderEmails(
  account: Account,
  password: string,
  folder: string,
  limit = 50,
): Promise<number> {
  const client = await createClientWithRefresh(account, password);
  let lock: MailboxLockObject | null = null;
  let added = 0;

  try {
    await client.connect();
    lock = await client.getMailboxLock(folder);

    const mailbox = client.mailbox;
    if (!mailbox || mailbox.exists === 0) return 0;

    // DB にある「このフォルダから取得済み」の最小 UID を調べる
    const minUid = getMinUidForFolder(account.id, folder);
    if (minUid <= 1) {
      // UID=1 以下ならこれ以上古いものはない
      return 0;
    }

    // minUid より前のシーケンス範囲をサーバーから取得（古い順に limit 件）
    // UID 1 〜 minUid-1 の範囲を fetch
    const fetchRange = `1:${minUid - 1}`;
    const allOldUids: number[] = [];
    for await (const msg of client.fetch(fetchRange, { uid: true }, { uid: true })) {
      allOldUids.push(msg.uid);
    }
    if (allOldUids.length === 0) return 0;

    // 新しいものから limit 件に絞る（降順ソートして先頭 limit 件）
    const targetUids = allOldUids.sort((a, b) => b - a).slice(0, limit);
    const uidRange = targetUids.join(',');

    const dbUids = getAllEmailUidsForFolder(account.id, folder);

    for await (const msg of client.fetch(uidRange, { uid: true, flags: true, source: true }, { uid: true })) {
      if (!msg.source) continue;
      if (dbUids.has(msg.uid)) continue; // 既存

      let parsed: ParsedEmail;
      try { parsed = await parseRawEmail(msg.source); } catch { continue; }
      if (isBlocked(account.id, parsed.from.address)) continue;

      const filterResult = applyFilters(account.id, {
        from: parsed.from.address,
        to: parsed.to.map((t) => t.address).join(' '),
        subject: parsed.subject,
        body: parsed.bodyText,
      });
      const targetFolder = filterResult?.folder ?? folder;
      const isRead = filterResult?.markRead ? true : (msg.flags?.has('\\Seen') ?? false);
      const isStarred = filterResult?.starred ?? false;

      upsertEmail({
        id: `${account.id}-${msg.uid}-${folder}`,
        accountId: account.id, uid: msg.uid,
        messageId: parsed.messageId, folder: targetFolder,
        from: parsed.from, to: parsed.to, cc: parsed.cc,
        replyToAddress: parsed.replyToAddress,
        subject: parsed.subject, bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml, date: parsed.date,
        isRead, isStarred,
        hasAttachments: parsed.hasAttachments,
        threadId: generateThreadId(account.id, parsed.subject, parsed.messageId),
      });
      if (parsed.attachments.length > 0) {
        saveAttachments(`${account.id}-${msg.uid}-${folder}`, parsed.attachments);
      }
      added++;
    }
  } finally {
    lock?.release();
    await safeLogout(client);
  }

  console.log(`[backfill] ${folder}: added=${added}`);
  return added;
}

export async function imapMarkRead(
  account: Account,
  password: string,
  folder: string,
  uid: number,
  isRead: boolean,
): Promise<void> {
  const client = createClient(account, password);
  await client.connect();
  const lock = await client.getMailboxLock(folder);
  try {
    if (isRead) {
      await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
    } else {
      await client.messageFlagsRemove({ uid }, ['\\Seen'], { uid: true });
    }
  } finally {
    lock.release();
    await safeLogout(client);
  }
}

export async function imapMarkAllRead(
  account: Account,
  password: string,
  folder: string,
): Promise<void> {
  const client = createClient(account, password);
  await client.connect();
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageFlagsAdd('1:*', ['\\Seen']);
  } finally {
    lock.release();
    await safeLogout(client);
  }
}

const PINNED_LABEL = 'Pinned';

export async function imapPinEmail(
  account: Account,
  password: string,
  folder: string,
  uid: number,
  messageId: string,
  isPinned: boolean,
): Promise<void> {
  const client = createClient(account, password);
  await client.connect();
  try {
    if (isPinned) {
      // Pinnedラベルを作成（存在しても無視）
      try { await client.mailboxCreate(PINNED_LABEL); } catch {}
      const lock = await client.getMailboxLock(folder);
      try {
        // メールをPinnedラベルにコピー（Gmailではラベル付与と同義）
        await client.messageCopy(String(uid), PINNED_LABEL, { uid: true });
      } finally {
        lock.release();
      }
    } else {
      // PinnedフォルダでmessageIdを検索して削除（Gmailではラベル削除）
      let lock: MailboxLockObject | null = null;
      try {
        lock = await client.getMailboxLock(PINNED_LABEL);
        const uids = await client.search({ header: { 'message-id': messageId } });
        if (Array.isArray(uids) && uids.length > 0) {
          await client.messageDelete(uids as number[], {});
        }
      } catch {
        // Pinnedフォルダが存在しない場合は無視
      } finally {
        lock?.release();
      }
    }
  } finally {
    await safeLogout(client);
  }
}

export async function imapDeleteEmail(
  account: Account,
  password: string,
  folder: string,
  uid: number,
): Promise<void> {
  const client = createClient(account, password);
  await client.connect();
  try {
    const list = await client.list();
    const trashFolder =
      list.find((f) => (f as any).specialUse === '\\Trash')?.path ||
      list.find((f) => /^\[Gmail\]\/Trash$/i.test(f.path))?.path ||
      list.find((f) => /^(Trash|Deleted Items|Deleted Messages|ゴミ箱)$/i.test(f.name))?.path ||
      'Trash';
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageMove({ uid }, trashFolder, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await safeLogout(client);
  }
}

export async function createFolder(account: Account, password: string, folderPath: string): Promise<void> {
  const client = createClient(account, password);
  try {
    await client.connect();
    await client.mailboxCreate(folderPath);
  } finally {
    await safeLogout(client);
  }
}

export async function deleteFolder(account: Account, password: string, folderPath: string): Promise<void> {
  const client = createClient(account, password);
  try {
    await client.connect();
    await client.mailboxDelete(folderPath);
  } finally {
    await safeLogout(client);
  }
}

export async function imapMoveEmail(
  account: Account,
  password: string,
  fromFolder: string,
  uid: number,
  toFolder: string,
): Promise<void> {
  const client = createClient(account, password);
  await client.connect();
  const lock = await client.getMailboxLock(fromFolder);
  try {
    await client.messageMove({ uid }, toFolder, { uid: true });
  } finally {
    lock.release();
    await safeLogout(client);
  }
}

export async function imapAppendToSent(
  account: Account,
  password: string,
  rawMessage: Buffer,
): Promise<void> {
  const client = createClient(account, password);
  try {
    await client.connect();
    // Sentフォルダを特定（specialUse \Sent → 一般的な名前の順で探す）
    const list = await client.list();
    const sentFolder =
      list.find((f) => (f as any).specialUse === '\\Sent')?.path ||
      list.find((f) => /^(Sent|Sent Items|送信済み|Sent Mail)$/i.test(f.name))?.path ||
      list.find((f) => /sent/i.test(f.path))?.path ||
      'Sent';
    await client.append(sentFolder, rawMessage, ['\\Seen']);
    console.log(`[smtp] appended to Sent folder: ${sentFolder}`);
  } catch (e) {
    // Sentフォルダへの保存失敗はエラーにしない（送信自体は成功）
    console.error('[smtp] append to Sent failed:', (e as Error).message);
  } finally {
    await safeLogout(client);
  }
}

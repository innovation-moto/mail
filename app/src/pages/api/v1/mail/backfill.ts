import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow, MailboxLockObject } from 'imapflow';
import PostalMime from 'postal-mime';
import type { AccountConfig, Email, EmailAddress } from '../../../../types/shared';

type RequestBody = {
  account: AccountConfig & { password: string };
  folder: string;
  minUid: number;
  limit?: number;
};

type ResponseBody = { emails: Email[] } | { error: string };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms),
    ),
  ]);
}

async function safeLogout(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    try { client.close(); } catch {}
  }
}

function normalizeAddress(addr: { name?: string; address?: string } | undefined): EmailAddress {
  return { name: addr?.name ?? '', address: addr?.address ?? '' };
}

async function parseSource(source: Uint8Array | Buffer) {
  const parser = new PostalMime();
  const parsed = await parser.parse(source as unknown as ArrayBuffer);
  const bodyHtml = parsed.html ?? '';
  const bodyText = parsed.text ?? bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const attachments = (parsed.attachments ?? []).filter(
    (a) => a.disposition === 'attachment' || (!a.disposition && a.filename),
  );
  return {
    messageId: parsed.messageId ?? '',
    from: normalizeAddress(parsed.from),
    to: (parsed.to ?? []).map(normalizeAddress),
    cc: (parsed.cc ?? []).map(normalizeAddress),
    subject: parsed.subject ?? '(件名なし)',
    bodyText,
    bodyHtml,
    date: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
    hasAttachments: attachments.length > 0,
  };
}

// 過去メールのバックフィル: ローカルDBが尽きたフォルダで、既知の最小UIDより
// さらに古いメールをIMAPから取得する（electron版 syncFolderOlderEmails と同じ方針）。
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { account, folder = 'INBOX', minUid, limit = 50 } = req.body as RequestBody;
  if (!account || !minUid) {
    return res.status(400).json({ error: 'account and minUid are required' });
  }
  if (minUid <= 1) {
    return res.status(200).json({ emails: [] });
  }

  const { password, oauthAccessToken, ...accountConfig } = account;

  const client = new ImapFlow({
    host: accountConfig.imapHost,
    port: accountConfig.imapPort,
    secure: accountConfig.imapSecure,
    auth: oauthAccessToken
      ? { user: accountConfig.email, accessToken: oauthAccessToken }
      : { user: accountConfig.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    socketTimeout: 20000,
  });

  let lock: MailboxLockObject | null = null;

  try {
    await withTimeout(client.connect(), 55_000);
    lock = await client.getMailboxLock(folder);
    const mailbox = client.mailbox;
    if (!mailbox || mailbox.exists === 0) {
      return res.status(200).json({ emails: [] });
    }

    // minUid より前（1 〜 minUid-1）の範囲のUIDをすべて取得
    const fetchRange = `1:${minUid - 1}`;
    const allOldUids: number[] = [];
    for await (const msg of client.fetch(fetchRange, { uid: true }, { uid: true })) {
      allOldUids.push(msg.uid);
    }
    if (allOldUids.length === 0) {
      return res.status(200).json({ emails: [] });
    }

    // 新しいものから limit 件に絞る
    const targetUids = allOldUids.sort((a, b) => b - a).slice(0, limit);
    const uidRange = targetUids.join(',');

    const emails: Email[] = [];
    for await (const msg of client.fetch(uidRange, { uid: true, flags: true, source: true }, { uid: true })) {
      if (!msg.source) continue;

      let parsed: Awaited<ReturnType<typeof parseSource>>;
      try {
        parsed = await parseSource(msg.source);
      } catch (e) {
        console.error('[backfill] parse error:', e);
        continue;
      }

      const id = `${accountConfig.email}-${msg.uid}-${folder}`;
      emails.push({
        id,
        accountId: accountConfig.email,
        uid: msg.uid,
        messageId: parsed.messageId,
        folder,
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        date: parsed.date,
        isRead: msg.flags?.has('\\Seen') ?? false,
        isStarred: msg.flags?.has('\\Flagged') ?? false,
        isPinned: false,
        isDeleted: false,
        hasAttachments: parsed.hasAttachments,
        aiCategory: null,
        aiPriority: null,
        aiSummary: null,
        aiActions: null,
        threadId: null,
        attachments: [],
      });
    }

    return res.status(200).json({ emails });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[api/v1/mail/backfill]', msg);
    if (msg === 'TIMEOUT') {
      return res.status(504).json({ error: 'backfill timeout' });
    }
    return res.status(500).json({ error: msg });
  } finally {
    lock?.release();
    await safeLogout(client);
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow, MailboxLockObject } from 'imapflow';
import PostalMime from 'postal-mime';
import type { AccountConfig, Email, EmailAddress } from '../../../../types/shared';

type RequestBody = {
  account: AccountConfig & { password: string };
  folder: string;
  sinceUid?: number;
  limit?: number;
};

type ResponseBody = { emails: Email[]; maxUid: number } | { error: string };

async function safeLogout(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    try { client.close(); } catch {}
  }
}

function normalizeAddress(addr: { name?: string; address?: string } | undefined): EmailAddress {
  return {
    name: addr?.name ?? '',
    address: addr?.address ?? '',
  };
}

async function parseSource(source: Uint8Array | Buffer): Promise<{
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  date: number;
  hasAttachments: boolean;
}> {
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { account, folder = 'INBOX', sinceUid, limit = 50 } = req.body as RequestBody;
  if (!account) {
    return res.status(400).json({ error: 'account is required' });
  }

  const { password, ...accountConfig } = account;

  const client = new ImapFlow({
    host: accountConfig.imapHost,
    port: accountConfig.imapPort,
    secure: accountConfig.imapSecure,
    auth: { user: accountConfig.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000,
    socketTimeout: 55000,
  });

  let lock: MailboxLockObject | null = null;

  try {
    await client.connect();
    lock = await client.getMailboxLock(folder);
    const mailbox = client.mailbox;

    if (!mailbox || mailbox.exists === 0) {
      return res.status(200).json({ emails: [], maxUid: 0 });
    }

    let fetchRange: string;
    let fetchOpts: { uid: boolean } | undefined;

    if (!sinceUid || sinceUid === 0) {
      // First sync: fetch latest N by sequence number
      const total = mailbox.exists;
      const startSeq = Math.max(1, total - limit + 1);
      fetchRange = `${startSeq}:*`;
      fetchOpts = undefined;
    } else {
      // Incremental: fetch UIDs > sinceUid
      fetchRange = `${sinceUid + 1}:*`;
      fetchOpts = { uid: true };
    }

    const emails: Email[] = [];
    let maxUid = 0;
    let count = 0;

    for await (const msg of client.fetch(
      fetchRange,
      { uid: true, flags: true, source: true },
      fetchOpts,
    )) {
      if (!msg.source) continue;
      if (count >= limit) break;
      if (sinceUid && sinceUid > 0 && msg.uid <= sinceUid) continue;
      count++;

      let parsed: Awaited<ReturnType<typeof parseSource>>;
      try {
        parsed = await parseSource(msg.source);
      } catch (e) {
        console.error('[sync] parse error:', e);
        continue;
      }

      if (msg.uid > maxUid) maxUid = msg.uid;

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

    return res.status(200).json({ emails, maxUid });
  } catch (err) {
    console.error('[api/v1/mail/sync]', err);
    return res.status(500).json({ error: (err as Error).message });
  } finally {
    lock?.release();
    await safeLogout(client);
  }
}

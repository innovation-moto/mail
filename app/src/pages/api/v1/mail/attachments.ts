import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow, MailboxLockObject } from 'imapflow';
import PostalMime from 'postal-mime';
import type { AccountConfig } from '../../../../types/shared';

type RequestBody = {
  account: AccountConfig & { password: string };
  folder: string;
  uid: number;
};

type ResponseAttachment = { filename: string; contentType: string; size: number; content: string };

type ResponseBody = { attachments: ResponseAttachment[] } | { error: string };

async function safeLogout(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    try { client.close(); } catch {}
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { account, folder, uid } = req.body as RequestBody;
  if (!account || !folder || !uid) {
    return res.status(400).json({ error: 'account, folder, and uid are required' });
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
    await client.connect();
    lock = await client.getMailboxLock(folder);

    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
    if (!msg || !msg.source) {
      return res.status(404).json({ error: 'message not found' });
    }

    const parser = new PostalMime();
    const parsed = await parser.parse(msg.source as unknown as ArrayBuffer);
    const rawAttachments = (parsed.attachments ?? []).filter(
      (a) => a.disposition === 'attachment' || (!a.disposition && a.filename),
    );

    const attachments: ResponseAttachment[] = rawAttachments.map((a) => ({
      filename: a.filename || 'attachment',
      contentType: a.mimeType || 'application/octet-stream',
      size: a.content instanceof ArrayBuffer ? a.content.byteLength : (a.content as Uint8Array).byteLength,
      content: Buffer.from(a.content as ArrayBuffer).toString('base64'),
    }));

    return res.status(200).json({ attachments });
  } catch (err) {
    console.error('[api/v1/mail/attachments]', err);
    return res.status(500).json({ error: (err as Error).message });
  } finally {
    lock?.release();
    await safeLogout(client);
  }
}

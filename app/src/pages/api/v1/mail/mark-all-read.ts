import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow, MailboxLockObject } from 'imapflow';
import type { AccountConfig } from '../../../../types/shared';

type RequestBody = {
  account: AccountConfig & { password: string };
  folder: string;
};

type ResponseBody = { ok: boolean } | { error: string };

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

  const { account, folder } = req.body as RequestBody;
  if (!account || !folder) {
    return res.status(400).json({ error: 'account and folder are required' });
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
    await client.messageFlagsAdd('1:*', ['\\Seen']);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/v1/mail/mark-all-read]', err);
    return res.status(500).json({ error: (err as Error).message });
  } finally {
    lock?.release();
    await safeLogout(client);
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow } from 'imapflow';
import type { AccountConfig, Folder } from '../../../../types/shared';

type RequestBody = {
  account: AccountConfig & { password: string };
};

type ResponseBody = Folder[] | { error: string };

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

  const { account } = req.body as RequestBody;
  if (!account) {
    return res.status(400).json({ error: 'account is required' });
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

  try {
    await client.connect();
    const list = await client.list();
    // 未読数はローカルDBから取得するため、ここでは 0 を返す
    const folders: Folder[] = list.map((f) => ({
      path: f.path,
      name: f.name,
      delimiter: f.delimiter ?? '/',
      flags: Array.from(f.flags ?? []),
      specialUse: (f as any).specialUse ?? null,
      unreadCount: 0,
    }));
    return res.status(200).json(folders);
  } catch (err) {
    console.error('[api/v1/mail/folders]', err);
    return res.status(500).json({ error: (err as Error).message });
  } finally {
    await safeLogout(client);
  }
}

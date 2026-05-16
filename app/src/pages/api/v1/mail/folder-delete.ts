import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow } from 'imapflow';
import type { AccountConfig } from '../../../../types/shared';

type RequestBody = { account: AccountConfig & { password: string }; folderPath: string };

async function safeLogout(client: ImapFlow): Promise<void> {
  try { await client.logout(); } catch { try { client.close(); } catch {} }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { account, folderPath } = req.body as RequestBody;
  if (!account || !folderPath) return res.status(400).json({ error: 'account and folderPath are required' });
  const { password, ...cfg } = account;
  const client = new ImapFlow({
    host: cfg.imapHost, port: cfg.imapPort, secure: cfg.imapSecure,
    auth: { user: cfg.email, pass: password }, logger: false,
    tls: { rejectUnauthorized: false }, connectionTimeout: 30000, socketTimeout: 55000,
  });
  try {
    await client.connect();
    await client.mailboxDelete(folderPath);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  } finally { await safeLogout(client); }
}

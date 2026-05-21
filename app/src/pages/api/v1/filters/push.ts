import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow } from 'imapflow';
import type { FilterRule } from '../../../../types/shared';

const CONFIG_FOLDER = 'IM-Mail-Config';
const CONFIG_SUBJECT = '__IM-MAIL-FILTER-SYNC-V1__';

async function safeLogout(client: ImapFlow): Promise<void> {
  try { await client.logout(); } catch { try { client.close(); } catch {} }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { account, rules } = req.body as {
    account: { email: string; password: string; imapHost: string; imapPort: number; imapSecure: boolean };
    rules: FilterRule[];
  };
  if (!account || !Array.isArray(rules)) return res.status(400).json({ error: 'account and rules required' });

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.email, pass: account.password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    socketTimeout: 30000,
    greetingTimeout: 10000,
    disableAutoIdle: true,
  });

  try {
    await client.connect();

    try { await client.mailboxCreate(CONFIG_FOLDER); } catch {}

    const lock = await client.getMailboxLock(CONFIG_FOLDER);
    try {
      const status = await client.status(CONFIG_FOLDER, { messages: true });
      if (status.messages && status.messages > 0) {
        const uids = await client.search({ subject: CONFIG_SUBJECT }, { uid: true });
        if (Array.isArray(uids) && uids.length > 0) {
          await client.messageDelete(uids.map(String).join(','), { uid: true });
        }
      }
    } catch {} finally {
      lock.release();
    }

    const emailBody = [
      `Subject: ${CONFIG_SUBJECT}`,
      `Content-Type: application/json; charset=utf-8`,
      `X-IM-Mail-Config: filters`,
      ``,
      JSON.stringify(rules),
    ].join('\r\n');

    await client.append(CONFIG_FOLDER, Buffer.from(emailBody), ['\\Seen']);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[filters/push]', err);
    return res.status(500).json({ error: 'push failed' });
  } finally {
    await safeLogout(client);
  }
}

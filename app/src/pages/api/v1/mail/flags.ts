import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow, MailboxLockObject } from 'imapflow';
import type { AccountConfig } from '../../../../types/shared';

type RequestBody = {
  account: AccountConfig & { password: string };
  folder: string;
  uids: number[];
};

type FlagEntry = {
  uid: number;
  isRead: boolean;
  isStarred: boolean;
};

type ResponseBody = { flags: FlagEntry[]; existingUids: number[] } | { error: string };

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

  const { account, folder = 'INBOX', uids } = req.body as RequestBody;
  if (!account || !uids || uids.length === 0) {
    return res.status(400).json({ error: 'account and uids are required' });
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

    const uidRange = uids.join(',');
    const flags: FlagEntry[] = [];
    const existingUids: number[] = [];

    for await (const msg of client.fetch(uidRange, { uid: true, flags: true }, { uid: true })) {
      existingUids.push(msg.uid);
      flags.push({
        uid: msg.uid,
        isRead: msg.flags?.has('\\Seen') ?? false,
        isStarred: msg.flags?.has('\\Flagged') ?? false,
      });
    }

    return res.status(200).json({ flags, existingUids });
  } catch (err) {
    console.error('[api/v1/mail/flags]', err);
    return res.status(500).json({ error: (err as Error).message });
  } finally {
    lock?.release();
    await safeLogout(client);
  }
}

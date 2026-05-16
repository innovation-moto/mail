import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow, MailboxLockObject } from 'imapflow';
import type { AccountConfig } from '../../../../types/shared';

type ActionType = 'markRead' | 'markUnread' | 'star' | 'unstar' | 'delete' | 'move';

type RequestBody = {
  account: AccountConfig & { password: string };
  folder: string;
  uid: number;
  action: ActionType;
  targetFolder?: string;
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

  const { account, folder, uid, action, targetFolder } = req.body as RequestBody;
  if (!account || !folder || !uid || !action) {
    return res.status(400).json({ error: 'account, folder, uid, and action are required' });
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

    switch (action) {
      case 'markRead':
        await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
        break;

      case 'markUnread':
        await client.messageFlagsRemove({ uid }, ['\\Seen'], { uid: true });
        break;

      case 'star':
        await client.messageFlagsAdd({ uid }, ['\\Flagged'], { uid: true });
        break;

      case 'unstar':
        await client.messageFlagsRemove({ uid }, ['\\Flagged'], { uid: true });
        break;

      case 'delete': {
        const trashFolder = 'Trash';
        try {
          await client.messageMove({ uid }, trashFolder, { uid: true });
        } catch {
          // If no Trash folder, just add Deleted flag
          await client.messageFlagsAdd({ uid }, ['\\Deleted'], { uid: true });
          await client.messageDelete({ uid }, { uid: true });
        }
        break;
      }

      case 'move': {
        if (!targetFolder) {
          return res.status(400).json({ error: 'targetFolder is required for move action' });
        }
        await client.messageMove({ uid }, targetFolder, { uid: true });
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/v1/mail/action]', err);
    return res.status(500).json({ error: (err as Error).message });
  } finally {
    lock?.release();
    await safeLogout(client);
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow } from 'imapflow';

const CONFIG_FOLDER = 'IM-Mail-Config';
const FOLDER_STATE_SUBJECT = '__IM-MAIL-FOLDER-STATE-V1__';

async function safeLogout(client: ImapFlow): Promise<void> {
  try { await client.logout(); } catch { try { client.close(); } catch {} }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { account } = req.body as {
    account: { email: string; password: string; imapHost: string; imapPort: number; imapSecure: boolean };
  };
  if (!account) return res.status(400).json({ error: 'account required' });

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

    // 設定フォルダを開く（存在しない場合は空を返す）
    let lock: { release: () => void } | null = null;
    try {
      lock = await client.getMailboxLock(CONFIG_FOLDER);
    } catch {
      return res.json({ state: {} });
    }

    try {
      const uidsResult = await client.search({ subject: FOLDER_STATE_SUBJECT }, { uid: true });
      const uids = Array.isArray(uidsResult) ? uidsResult : [];
      if (uids.length === 0) return res.json({ state: {} });

      const latestUid = Math.max(...uids);
      let stateJson = '';
      for await (const msg of client.fetch(String(latestUid), { source: true }, { uid: true })) {
        const source = msg.source?.toString() ?? '';
        const bodyStart = source.indexOf('\r\n\r\n');
        if (bodyStart !== -1) stateJson = source.slice(bodyStart + 4).trim();
      }

      if (!stateJson) return res.json({ state: {} });
      const state: Record<string, string> = JSON.parse(stateJson);
      return res.json({ state });
    } finally {
      lock?.release();
    }
  } catch (err) {
    console.error('[folders/state]', err);
    return res.json({ state: {} });
  } finally {
    await safeLogout(client);
  }
}

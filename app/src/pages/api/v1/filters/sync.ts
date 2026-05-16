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

  const { account } = req.body as { account: { email: string; password: string; imapHost: string; imapPort: number; imapSecure: boolean } };
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

    // 設定フォルダを開く（存在しない場合は空ルールを返す）
    let lock: { release: () => void } | null = null;
    try {
      lock = await client.getMailboxLock(CONFIG_FOLDER);
    } catch {
      return res.json({ rules: [] });
    }

    try {
      // 設定メールを検索
      const uidsResult = await client.search({ subject: CONFIG_SUBJECT }, { uid: true });
      const uids = Array.isArray(uidsResult) ? uidsResult : [];
      if (uids.length === 0) return res.json({ rules: [] });

      // 最新の設定メールを取得
      const latestUid = Math.max(...uids);
      let rulesJson = '';
      for await (const msg of client.fetch(String(latestUid), { source: true }, { uid: true })) {
        const source = msg.source?.toString() ?? '';
        const bodyStart = source.indexOf('\r\n\r\n');
        if (bodyStart !== -1) rulesJson = source.slice(bodyStart + 4).trim();
      }

      if (!rulesJson) return res.json({ rules: [] });
      const rules: FilterRule[] = JSON.parse(rulesJson);
      return res.json({ rules });
    } finally {
      lock?.release();
    }
  } catch (err) {
    console.error('[filters/sync]', err);
    // エラーでも空ルールを返してクラッシュ防止
    return res.json({ rules: [] });
  } finally {
    await safeLogout(client);
  }
}

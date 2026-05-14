import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';
import { syncFolderEmails } from '@/lib/imapHelper';

// Increase timeout for IMAP sync (Vercel Hobby: up to 60s)
export const config = {
  maxDuration: 60,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { accountId, folder = 'INBOX' } = req.body;

  // アカウント情報取得
  const { data: account, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (accErr || !account) return res.status(404).json({ error: 'アカウントが見つかりません' });

  // 最後に同期したUIDを取得
  const { data: lastEmail } = await supabase
    .from('emails')
    .select('uid')
    .eq('account_id', accountId)
    .eq('folder', folder)
    .order('uid', { ascending: false })
    .limit(1)
    .single();
  const lastUid = lastEmail?.uid ?? 0;

  try {
    const newEmails = await syncFolderEmails(account, folder, lastUid, 20);

    if (newEmails.length > 0) {
      const rows = newEmails.map((e) => ({
        id: `${accountId}-${e.uid}-${e.folder}`,
        account_id: accountId,
        uid: e.uid,
        message_id: e.messageId,
        folder: e.folder,
        from_address: e.fromAddress,
        from_name: e.fromName,
        to_addresses: e.toAddresses,
        cc_addresses: e.ccAddresses,
        subject: e.subject,
        date: e.date,
        is_read: e.isRead,
        has_attachments: e.hasAttachments,
      }));

      const { error } = await supabase
        .from('emails')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
      if (error) return res.status(500).json({ error: error.message });
    }

    return res.json({ added: newEmails.length, folder });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}

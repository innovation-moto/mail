import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { accountId, folder = 'INBOX', limit = '50', offset = '0' } = req.query as Record<string, string>;

  if (folder === 'Pinned') {
    const { data, error } = await supabase
      .from('emails')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_pinned', true)
      .eq('is_deleted', false)
      .order('date', { ascending: false })
      .limit(Number(limit));
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data?.map(toEmail) ?? []);
  }

  if (folder === 'Starred') {
    const { data, error } = await supabase
      .from('emails')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_starred', true)
      .eq('is_deleted', false)
      .order('date', { ascending: false })
      .limit(Number(limit));
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data?.map(toEmail) ?? []);
  }

  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('account_id', accountId)
    .eq('folder', folder)
    .eq('is_deleted', false)
    .order('date', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data?.map(toEmail) ?? []);
}

function toEmail(row: any) {
  return {
    id: row.id,
    accountId: row.account_id,
    uid: row.uid,
    messageId: row.message_id,
    folder: row.folder,
    from: { address: row.from_address, name: row.from_name },
    to: row.to_addresses || [],
    cc: row.cc_addresses || [],
    subject: row.subject,
    bodyText: '',   // 本文はオンデマンドで取得
    bodyHtml: '',
    date: row.date,
    isRead: row.is_read,
    isStarred: row.is_starred,
    isPinned: row.is_pinned,
    isDeleted: row.is_deleted,
    hasAttachments: row.has_attachments,
  };
}

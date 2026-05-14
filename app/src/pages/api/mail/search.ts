import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { accountId, query } = req.query as { accountId: string; query: string };
  if (!query?.trim()) return res.json([]);

  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_deleted', false)
    .or(`subject.ilike.%${query}%,from_address.ilike.%${query}%,from_name.ilike.%${query}%`)
    .order('date', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });

  return res.json(data?.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    uid: row.uid,
    folder: row.folder,
    from: { address: row.from_address, name: row.from_name },
    to: row.to_addresses || [],
    cc: row.cc_addresses || [],
    subject: row.subject,
    bodyText: '',
    bodyHtml: '',
    date: row.date,
    isRead: row.is_read,
    isStarred: row.is_starred,
    isPinned: row.is_pinned,
    isDeleted: row.is_deleted,
    hasAttachments: row.has_attachments,
  })) ?? []);
}

import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';

// markRead / star / pin / delete / move をまとめて処理
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { action, emailId, value, folder } = req.body;

  const updateMap: Record<string, Record<string, unknown>> = {
    markRead:  { is_read: value },
    star:      { is_starred: value },
    pin:       { is_pinned: value },
    delete:    { is_deleted: true, is_read: true },
    move:      { folder },
  };

  const updates = updateMap[action];
  if (!updates) return res.status(400).json({ error: '不明なaction' });

  const { error } = await supabase
    .from('emails')
    .update(updates)
    .eq('id', emailId);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
}

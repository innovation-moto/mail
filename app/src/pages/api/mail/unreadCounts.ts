import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { accountId } = req.query as { accountId: string };

  const { data, error } = await supabase
    .from('emails')
    .select('folder')
    .eq('account_id', accountId)
    .eq('is_read', false)
    .eq('is_deleted', false)
    .not('folder', 'ilike', '%Trash%')
    .not('folder', 'ilike', '%ゴミ箱%')
    .not('folder', 'ilike', '%Spam%')
    .not('folder', 'ilike', '%Junk%');

  if (error) return res.status(500).json({ error: error.message });

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.folder] = (counts[row.folder] || 0) + 1;
  }
  return res.json(counts);
}

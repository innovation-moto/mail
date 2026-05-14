import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';
import { encrypt } from '@/lib/crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { user, supabase } = auth;
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const { name, password } = req.body;
    const updates: Record<string, unknown> = { name };
    if (password) updates.encrypted_password = encrypt(password);
    const { error } = await supabase
      .from('accounts')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.status(405).end();
}

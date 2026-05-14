import { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient } from './supabase';

export async function getAuthUser(req: NextApiRequest, res: NextApiResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: '認証が必要です' });
    return null;
  }
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: '認証が無効です' });
    return null;
  }
  return { user, supabase };
}

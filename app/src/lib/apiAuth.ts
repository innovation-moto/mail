import { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient } from './supabase';
import { createClient } from '@supabase/supabase-js';

export async function getAuthUser(req: NextApiRequest, res: NextApiResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: '認証が必要です' });
    return null;
  }
  // Use admin client to verify the token
  const adminClient = createServerClient();
  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: '認証が無効です' });
    return null;
  }
  // If service role key is available, use admin client (bypasses RLS).
  // Otherwise, create a client that passes the user's JWT so RLS works correctly.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = serviceKey
    ? adminClient
    : createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
  return { user, supabase };
}

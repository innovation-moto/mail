import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { user, supabase } = auth;

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', user.id)
      .single();
    return res.json({
      theme: data?.theme ?? 'system',
      notificationsEnabled: data?.notifications_enabled ?? true,
      syncIntervalSec: data?.sync_interval_sec ?? 30,
    });
  }

  if (req.method === 'POST') {
    const { theme, notificationsEnabled, syncIntervalSec } = req.body;
    await supabase.from('settings').upsert({
      user_id: user.id,
      theme,
      notifications_enabled: notificationsEnabled,
      sync_interval_sec: syncIntervalSec,
    }, { onConflict: 'user_id' });
    return res.json({ ok: true });
  }

  res.status(405).end();
}

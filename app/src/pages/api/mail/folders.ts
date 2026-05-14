import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';
import { fetchFolderList } from '@/lib/imapHelper';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { accountId } = req.query as { accountId: string };

  const { data: account, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (error || !account) return res.status(404).json({ error: 'アカウントが見つかりません' });

  try {
    const folders = await fetchFolderList(account);
    // Supabaseにも保存
    const rows = folders.map((f) => ({
      account_id: accountId,
      path: f.path,
      name: f.name,
      special_use: f.specialUse,
    }));
    await supabase.from('folders').upsert(rows, { onConflict: 'account_id,path', ignoreDuplicates: false });
    return res.json(folders);
  } catch (e) {
    // IMAPエラー時はDBから返す
    const { data } = await supabase.from('folders').select('path, name, special_use').eq('account_id', accountId);
    return res.json(data?.map((f) => ({ path: f.path, name: f.name, specialUse: f.special_use })) ?? []);
  }
}

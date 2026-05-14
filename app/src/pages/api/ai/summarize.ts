import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';
import { fetchEmailBody } from '@/lib/imapHelper';
import { summarizeEmail } from '@/lib/aiHelper';

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { emailId } = req.body as { emailId: string };
  if (!emailId) return res.status(400).json({ error: 'emailId required' });

  const { data: email, error } = await supabase
    .from('emails').select('*, accounts(*)').eq('id', emailId).single();
  if (error || !email) return res.status(404).json({ error: 'メールが見つかりません' });

  let bodyText = email.body_text ?? '';
  if (!bodyText) {
    try {
      const fetched = await fetchEmailBody(email.accounts, email.folder, email.uid);
      bodyText = fetched.bodyText ?? '';
    } catch {}
  }

  try {
    const result = await summarizeEmail(email.subject ?? '', bodyText);
    await supabase.from('emails').update({
      ai_summary: result.summary,
      ai_actions: result.actions,
    }).eq('id', emailId);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}

import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';
import { fetchEmailBody } from '@/lib/imapHelper';
import { generateReply } from '@/lib/aiHelper';
import { AiTone } from '@/types/shared';

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { emailId, tone } = req.body as { emailId: string; tone: AiTone };
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
    const reply = await generateReply(email.subject ?? '', bodyText, tone ?? 'polite');
    return res.json({ reply });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}

import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';
import { decrypt } from '@/lib/crypto';
import nodemailer from 'nodemailer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { accountId, to, cc, bcc, subject, body, replyToMessageId } = req.body;

  const { data: account, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .single();
  if (error || !account) return res.status(404).json({ error: 'アカウントが見つかりません' });

  const password = decrypt(account.encrypted_password);
  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure,
    auth: { user: account.email, pass: password },
    tls: { rejectUnauthorized: false },
  });

  try {
    await transporter.sendMail({
      from: `${account.name} <${account.email}>`,
      to, cc, bcc, subject,
      text: body,
      inReplyTo: replyToMessageId,
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}

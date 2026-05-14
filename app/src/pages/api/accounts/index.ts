import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';
import { encrypt } from '@/lib/crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { user, supabase } = auth;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, name, email, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, avatar, created_at')
      .eq('user_id', user.id)
      .order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const { name, email, imapHost, imapPort, imapSecure, smtpHost, smtpPort, smtpSecure, password } = req.body;
    const encrypted_password = password ? encrypt(password) : null;
    const { data, error } = await supabase
      .from('accounts')
      .insert({
        user_id: user.id,
        name, email,
        imap_host: imapHost, imap_port: imapPort, imap_secure: imapSecure,
        smtp_host: smtpHost, smtp_port: smtpPort, smtp_secure: smtpSecure,
        encrypted_password,
      })
      .select('id, name, email, imap_host, imap_port, smtp_host, smtp_port, avatar')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  res.status(405).end();
}

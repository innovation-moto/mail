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
    // Convert snake_case to camelCase for frontend
    const accounts = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      imapSecure: row.imap_secure,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpSecure: row.smtp_secure,
      avatar: row.avatar,
    }));
    return res.json(accounts);
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
    // Convert snake_case to camelCase for frontend
    const account = data ? {
      id: data.id,
      name: data.name,
      email: data.email,
      imapHost: data.imap_host,
      imapPort: data.imap_port,
      smtpHost: data.smtp_host,
      smtpPort: data.smtp_port,
      avatar: data.avatar,
    } : null;
    return res.json(account);
  }

  res.status(405).end();
}

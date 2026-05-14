import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/apiAuth';
import { fetchEmailBody } from '@/lib/imapHelper';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await getAuthUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { emailId } = req.query as { emailId: string };

  // DBからメタデータ取得
  const { data: email, error } = await supabase
    .from('emails')
    .select('*, accounts(*)')
    .eq('id', emailId)
    .single();
  if (error || !email) return res.status(404).json({ error: 'メールが見つかりません' });

  // IMAPから本文をオンデマンドで取得
  try {
    const { bodyText, bodyHtml } = await fetchEmailBody(
      email.accounts,
      email.folder,
      email.uid,
    );
    return res.json({
      id: email.id,
      accountId: email.account_id,
      uid: email.uid,
      folder: email.folder,
      from: { address: email.from_address, name: email.from_name },
      to: email.to_addresses || [],
      cc: email.cc_addresses || [],
      subject: email.subject,
      bodyText,
      bodyHtml,
      date: email.date,
      isRead: email.is_read,
      isStarred: email.is_starred,
      isPinned: email.is_pinned,
      hasAttachments: email.has_attachments,
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}

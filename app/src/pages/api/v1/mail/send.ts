import type { NextApiRequest, NextApiResponse } from 'next';
import nodemailer from 'nodemailer';
import type { AccountConfig, ComposeData } from '../../../../types/shared';

type RequestBody = {
  account: AccountConfig & { password: string };
  compose: ComposeData;
};

type ResponseBody = { ok: boolean } | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { account, compose } = req.body as RequestBody;
  if (!account || !compose) {
    return res.status(400).json({ error: 'account and compose are required' });
  }

  const { password, ...accountConfig } = account;

  const transporter = nodemailer.createTransport({
    host: accountConfig.smtpHost,
    port: accountConfig.smtpPort,
    secure: accountConfig.smtpSecure,
    auth: { user: accountConfig.email, pass: password },
    tls: { rejectUnauthorized: false },
  });

  try {
    const mailOptions: nodemailer.SendMailOptions = {
      from: `"${accountConfig.name}" <${accountConfig.email}>`,
      to: compose.to.join(', '),
      cc: compose.cc.length > 0 ? compose.cc.join(', ') : undefined,
      bcc: compose.bcc.length > 0 ? compose.bcc.join(', ') : undefined,
      subject: compose.subject,
      text: compose.bodyText,
      html: compose.bodyHtml,
    };

    if (compose.replyToMessageId) {
      mailOptions.inReplyTo = compose.replyToMessageId;
      mailOptions.references = compose.replyToMessageId;
    }

    await transporter.sendMail(mailOptions);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/v1/mail/send]', err);
    return res.status(500).json({ error: (err as Error).message });
  } finally {
    transporter.close();
  }
}

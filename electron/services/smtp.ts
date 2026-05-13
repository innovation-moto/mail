import nodemailer from 'nodemailer';
import { Account, ComposeData, TestConnectionResult } from '../../shared/types';

export async function testSmtpConnection(
  host: string,
  port: number,
  secure: boolean,
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: email, pass: password },
    tls: { rejectUnauthorized: false },
  });
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    transporter.close();
  }
}

export async function sendEmail(account: Account, password: string, data: ComposeData): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.email, pass: password },
    tls: { rejectUnauthorized: false },
  });

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${account.name}" <${account.email}>`,
    to: data.to.join(', '),
    cc: data.cc.length > 0 ? data.cc.join(', ') : undefined,
    bcc: data.bcc.length > 0 ? data.bcc.join(', ') : undefined,
    subject: data.subject,
    text: data.bodyText,
    html: data.bodyHtml,
  };

  if (data.replyToMessageId) {
    mailOptions.inReplyTo = data.replyToMessageId;
    mailOptions.references = data.replyToMessageId;
  }

  try {
    await transporter.sendMail(mailOptions);
  } finally {
    transporter.close();
  }
}

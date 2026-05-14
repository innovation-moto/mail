import nodemailer from 'nodemailer';
import { Account, ComposeData, TestConnectionResult } from '../../shared/types';
import { refreshMicrosoftToken } from './microsoftAuth';
import { updateAccount } from '../db/queries/accounts';

async function getSmtpAuth(account: Account, password: string) {
  const a = account as Account & { oauthRefreshToken?: string; oauthAccessToken?: string; oauthExpiresAt?: number };
  if (a.oauthRefreshToken) {
    let accessToken = a.oauthAccessToken;
    if (!accessToken || !a.oauthExpiresAt || a.oauthExpiresAt < Date.now() + 60000) {
      const tokens = await refreshMicrosoftToken(a.oauthRefreshToken);
      updateAccount(account.id, {
        oauthAccessToken: tokens.accessToken,
        oauthRefreshToken: tokens.refreshToken,
        oauthExpiresAt: tokens.expiresAt,
      } as any);
      accessToken = tokens.accessToken;
    }
    return { type: 'OAuth2' as const, user: account.email, accessToken };
  }
  return { user: account.email, pass: password };
}

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
  const auth = await getSmtpAuth(account, password);
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth,
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
    // 送信 & rawメッセージを取得してSentフォルダに保存
    const info = await transporter.sendMail(mailOptions);
    const raw: Buffer = (info as any).message?.getMessageId
      ? await new Promise((resolve, reject) => {
          (info as any).message.build((err: Error, buf: Buffer) => err ? reject(err) : resolve(buf));
        })
      : Buffer.from('');

    if (raw.length > 0) {
      const { imapAppendToSent } = await import('./imap');
      await imapAppendToSent(account, password, raw);
    }
  } finally {
    transporter.close();
  }
}

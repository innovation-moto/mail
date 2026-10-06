import nodemailer from 'nodemailer';
import dns from 'dns';
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

// SMTP ホストを IPv4 で解決する。nodemailer は IPv4 の DNS 問い合わせが一時失敗すると
// IPv6 アドレスへフォールバックし（しかも数分キャッシュする）、IPv6 経路の無いネットワークで
// EHOSTUNREACH になるため、OS のリゾルバで IPv4 を先に確定させる。
// 解決できなければホスト名のまま返し、nodemailer の既定動作に任せる。
async function resolveSmtpHost(host: string): Promise<{ host: string; servername: string }> {
  try {
    const { address } = await dns.promises.lookup(host, { family: 4 });
    return { host: address, servername: host };
  } catch {
    return { host, servername: host };
  }
}

export async function testSmtpConnection(
  host: string,
  port: number,
  secure: boolean,
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const resolved = await resolveSmtpHost(host);
  const transporter = nodemailer.createTransport({
    host: resolved.host,
    port,
    secure,
    auth: { user: email, pass: password },
    tls: { rejectUnauthorized: false, servername: resolved.servername },
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
  const resolved = await resolveSmtpHost(account.smtpHost);
  const transporter = nodemailer.createTransport({
    host: resolved.host,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth,
    tls: { rejectUnauthorized: false, servername: resolved.servername },
  });

  if (!data.to || data.to.length === 0) {
    throw new Error('宛先が指定されていません');
  }

  console.log('[smtp] envelope — to:', data.to, 'cc:', data.cc, 'bcc:', data.bcc);

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${account.name}" <${account.email}>`,
    to: data.to,
    cc: data.cc.length > 0 ? data.cc : undefined,
    bcc: data.bcc.length > 0 ? data.bcc : undefined,
    subject: data.subject,
    text: data.bodyText,
    html: data.bodyHtml,
  };

  if (data.replyToMessageId) {
    mailOptions.inReplyTo = data.replyToMessageId;
    mailOptions.references = data.replyToMessageId;
  }

  if (data.attachments?.length) {
    mailOptions.attachments = data.attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
      contentType: a.contentType,
    }));
  }

  try {
    // 送信 & rawメッセージを取得してSentフォルダに保存
    const info = await transporter.sendMail(mailOptions);

    // 拒否されたアドレスがあれば警告
    if (info.rejected?.length > 0) {
      console.warn('[smtp] rejected recipients:', info.rejected);
      throw new Error(`送信先に拒否されたアドレスがあります: ${info.rejected.join(', ')}`);
    }

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

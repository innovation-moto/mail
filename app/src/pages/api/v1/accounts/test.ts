import type { NextApiRequest, NextApiResponse } from 'next';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type { AccountConfig, TestConnectionResult } from '../../../../types/shared';

type RequestBody = {
  account: AccountConfig & { password: string };
};

async function testImap(account: AccountConfig, password: string): Promise<{ ok: boolean; error?: string }> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    socketTimeout: 20000,
  });
  try {
    await client.connect();
    try { await client.logout(); } catch { try { client.close(); } catch {} }
    return { ok: true };
  } catch (err) {
    try { client.close(); } catch {}
    return { ok: false, error: (err as Error).message };
  }
}

async function testSmtp(account: AccountConfig, password: string): Promise<{ ok: boolean; error?: string }> {
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.email, pass: password },
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TestConnectionResult | { error: string }>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { account } = req.body as RequestBody;
  if (!account) {
    return res.status(400).json({ error: 'account is required' });
  }

  const { password, ...accountConfig } = account;

  const [imapResult, smtpResult] = await Promise.all([
    testImap(account, password),
    testSmtp(account, password),
  ]);

  return res.status(200).json({
    imap: imapResult.ok,
    smtp: smtpResult.ok,
    imapError: imapResult.error,
    smtpError: smtpResult.error,
  });
}

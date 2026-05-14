import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { decrypt } from './crypto';

export interface AccountRow {
  id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  encrypted_password: string;
}

export function createImapClient(account: AccountRow) {
  const password = decrypt(account.encrypted_password);
  return new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure,
    auth: { user: account.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

export async function fetchEmailBody(
  account: AccountRow,
  folder: string,
  uid: number,
): Promise<{ bodyText: string; bodyHtml: string }> {
  const client = createImapClient(account);
  let lock = null;
  try {
    await client.connect();
    lock = await client.getMailboxLock(folder);
    let bodyText = '';
    let bodyHtml = '';
    for await (const msg of client.fetch(
      String(uid),
      { uid: true, source: true },
      { uid: true },
    )) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      bodyText = parsed.text || '';
      bodyHtml = parsed.html || '';
      break;
    }
    return { bodyText, bodyHtml };
  } finally {
    lock?.release();
    try { await client.logout(); } catch { /* ignore */ }
  }
}

export async function syncFolderEmails(
  account: AccountRow,
  folder: string,
  lastUid: number,
  limit = 50,
): Promise<Array<{
  uid: number; messageId: string; folder: string;
  fromAddress: string; fromName: string;
  toAddresses: { address: string; name: string }[];
  ccAddresses: { address: string; name: string }[];
  subject: string; date: string;
  isRead: boolean; hasAttachments: boolean;
}>> {
  const client = createImapClient(account);
  let lock = null;
  const results = [];

  try {
    await client.connect();
    lock = await client.getMailboxLock(folder);
    const mailbox = client.mailbox;
    if (!mailbox || mailbox.exists === 0) return [];

    let fetchRange: string;
    let fetchOpts: { uid: boolean } | undefined;

    if (lastUid === 0) {
      const total = mailbox.exists;
      const startSeq = Math.max(1, total - limit + 1);
      fetchRange = `${startSeq}:*`;
      fetchOpts = undefined;
    } else {
      fetchRange = `${lastUid + 1}:*`;
      fetchOpts = { uid: true };
    }

    let count = 0;
    for await (const msg of client.fetch(
      fetchRange,
      { uid: true, flags: true, source: true },
      fetchOpts,
    )) {
      if (!msg.source || count >= limit) break;
      if (lastUid > 0 && msg.uid <= lastUid) continue;
      count++;

      try {
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value?.[0] || { address: '', name: '' };
        results.push({
          uid: msg.uid,
          messageId: parsed.messageId || '',
          folder,
          fromAddress: from.address || '',
          fromName: from.name || '',
          toAddresses: (parsed.to as any)?.value?.map((a: any) => ({ address: a.address || '', name: a.name || '' })) || [],
          ccAddresses: (parsed.cc as any)?.value?.map((a: any) => ({ address: a.address || '', name: a.name || '' })) || [],
          subject: parsed.subject || '',
          date: (parsed.date || new Date()).toISOString(),
          isRead: msg.flags?.has('\\Seen') ?? false,
          hasAttachments: (parsed.attachments?.length || 0) > 0,
        });
      } catch { /* skip */ }
    }
    return results;
  } finally {
    lock?.release();
    try { await client.logout(); } catch { /* ignore */ }
  }
}

export async function fetchFolderList(account: AccountRow): Promise<{ path: string; name: string; specialUse: string }[]> {
  const client = createImapClient(account);
  try {
    await client.connect();
    const list = await client.list();
    return list.map((f) => ({
      path: f.path,
      name: f.name,
      specialUse: (f as any).specialUse || '',
    }));
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}

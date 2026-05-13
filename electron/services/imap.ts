import { ImapFlow, MailboxLockObject } from 'imapflow';
import { v4 as uuidv4 } from 'uuid';
import { Account, Folder, TestConnectionResult } from '../../shared/types';
import { parseRawEmail, ParsedEmail } from './parser';
import { upsertEmail, UpsertEmailData } from '../db/queries/emails';
import { isBlocked } from '../db/queries/blocklist';
import { markDeleted } from '../db/queries/emails';

const clientPool: Map<string, ImapFlow> = new Map();

function createClient(account: Account, password: string): ImapFlow {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

export async function testImapConnection(
  host: string,
  port: number,
  secure: boolean,
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user: email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function fetchFolders(account: Account, password: string): Promise<Folder[]> {
  const client = createClient(account, password);
  await client.connect();
  const folders: Folder[] = [];
  try {
    const list = await client.list();
    for (const f of list) {
      folders.push({
        path: f.path,
        name: f.name,
        delimiter: f.delimiter ?? '/',
        flags: Array.from(f.flags ?? []),
        specialUse: f.specialUse ?? null,
        unreadCount: 0,
      });
    }
  } finally {
    await client.logout();
  }
  return folders;
}

export async function syncFolder(
  account: Account,
  password: string,
  folder = 'INBOX',
  limit = 50,
): Promise<{ added: number; blocked: number }> {
  const client = createClient(account, password);
  await client.connect();
  let lock: MailboxLockObject | null = null;
  let added = 0;
  let blocked = 0;

  try {
    lock = await client.getMailboxLock(folder);
    const mailbox = client.mailbox;
    if (!mailbox || mailbox.exists === 0) return { added, blocked };

    const total = mailbox.exists;
    const startSeq = Math.max(1, total - limit + 1);

    for await (const msg of client.fetch(`${startSeq}:*`, {
      uid: true,
      flags: true,
      envelope: true,
      source: true,
    })) {
      if (!msg.source) continue;

      let parsed: ParsedEmail;
      try {
        parsed = await parseRawEmail(msg.source);
      } catch {
        continue;
      }

      if (isBlocked(account.id, parsed.from.address)) {
        const id = `${account.id}-${msg.uid}-${folder}`;
        const emailData: UpsertEmailData = {
          id,
          accountId: account.id,
          uid: msg.uid,
          messageId: parsed.messageId,
          folder: 'Trash',
          from: parsed.from,
          to: parsed.to,
          cc: parsed.cc,
          subject: parsed.subject,
          bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml,
          date: parsed.date,
          isRead: true,
          hasAttachments: parsed.hasAttachments,
        };
        upsertEmail(emailData);
        blocked++;
        continue;
      }

      const id = `${account.id}-${msg.uid}-${folder}`;
      const emailData: UpsertEmailData = {
        id,
        accountId: account.id,
        uid: msg.uid,
        messageId: parsed.messageId,
        folder,
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        date: parsed.date,
        isRead: msg.flags?.has('\\Seen') ?? false,
        hasAttachments: parsed.hasAttachments,
      };
      upsertEmail(emailData);
      added++;
    }
  } finally {
    lock?.release();
    await client.logout();
  }

  return { added, blocked };
}

export async function imapMarkRead(
  account: Account,
  password: string,
  folder: string,
  uid: number,
  isRead: boolean,
): Promise<void> {
  const client = createClient(account, password);
  await client.connect();
  const lock = await client.getMailboxLock(folder);
  try {
    if (isRead) {
      await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
    } else {
      await client.messageFlagsRemove({ uid }, ['\\Seen'], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

export async function imapDeleteEmail(
  account: Account,
  password: string,
  folder: string,
  uid: number,
): Promise<void> {
  const client = createClient(account, password);
  await client.connect();
  const lock = await client.getMailboxLock(folder);
  try {
    const trashFolder = 'Trash';
    await client.messageMove({ uid }, trashFolder, { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}

export async function imapMoveEmail(
  account: Account,
  password: string,
  fromFolder: string,
  uid: number,
  toFolder: string,
): Promise<void> {
  const client = createClient(account, password);
  await client.connect();
  const lock = await client.getMailboxLock(fromFolder);
  try {
    await client.messageMove({ uid }, toFolder, { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}

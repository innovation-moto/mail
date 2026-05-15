import type { Account, ComposeData, Email, Folder, TestConnectionResult } from '@/shared/types';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

type AccountWithPassword = Omit<Account, 'id' | 'createdAt'> & { password: string };

function buildAccountPayload(account: Account, password: string): AccountWithPassword {
  return {
    name: account.name,
    email: account.email,
    password,
    provider: account.provider,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapSecure: account.imapSecure,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecure: account.smtpSecure,
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      errorMsg = data.error ?? errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }

  return res.json() as Promise<T>;
}

export const mailApi = {
  /**
   * Fetch folder list for an account
   */
  folders(account: Account, password: string): Promise<Folder[]> {
    return post<Folder[]>('/api/v1/mail/folders', {
      account: buildAccountPayload(account, password),
    });
  },

  /**
   * Sync emails from a folder (incremental by UID)
   */
  sync(
    account: Account,
    password: string,
    folder: string,
    sinceUid?: number,
    limit = 50,
  ): Promise<{ emails: Email[]; maxUid: number }> {
    return post<{ emails: Email[]; maxUid: number }>('/api/v1/mail/sync', {
      account: buildAccountPayload(account, password),
      folder,
      sinceUid,
      limit,
    });
  },

  /**
   * Perform an action on an email (read/star/delete/move)
   */
  action(
    account: Account,
    password: string,
    folder: string,
    uid: number,
    action: 'markRead' | 'markUnread' | 'star' | 'unstar' | 'delete' | 'move',
    targetFolder?: string,
  ): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/v1/mail/action', {
      account: buildAccountPayload(account, password),
      folder,
      uid,
      action,
      targetFolder,
    });
  },

  /**
   * Send an email
   */
  send(
    account: Account,
    password: string,
    compose: ComposeData,
  ): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/v1/mail/send', {
      account: buildAccountPayload(account, password),
      compose,
    });
  },

  /**
   * Test IMAP + SMTP connectivity
   */
  testConnection(
    account: Account,
    password: string,
  ): Promise<TestConnectionResult> {
    return post<TestConnectionResult>('/api/v1/accounts/test', {
      account: buildAccountPayload(account, password),
    });
  },
};

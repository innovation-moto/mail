import type { Account, AiSummarizeResult, AiTone, CalendarEvent, ComposeData, Email, Folder, TestConnectionResult } from '@/shared/types';

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

  // ─── フォルダ管理 ─────────────────────────────────────────────────

  folderCreate(account: Account, password: string, folderPath: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/v1/mail/folder-create', {
      account: buildAccountPayload(account, password),
      folderPath,
    });
  },

  folderDelete(account: Account, password: string, folderPath: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/v1/mail/folder-delete', {
      account: buildAccountPayload(account, password),
      folderPath,
    });
  },

  // ─── AI ───────────────────────────────────────────────────────────

  /**
   * Summarize an email with AI
   */
  aiSummarize(
    apiKey: string,
    subject: string,
    bodyText: string,
  ): Promise<AiSummarizeResult> {
    return post<AiSummarizeResult>('/api/v1/ai/summarize', { apiKey, subject, bodyText });
  },

  /**
   * Generate an AI reply draft
   */
  aiReply(
    apiKey: string,
    subject: string,
    bodyText: string,
    tone: AiTone,
  ): Promise<{ reply: string }> {
    return post<{ reply: string }>('/api/v1/ai/reply', { apiKey, subject, bodyText, tone });
  },

  /**
   * フォルダ内の既存メールのフラグ（既読・スター）と存在確認を取得
   */
  syncFlags(
    account: Account,
    password: string,
    folder: string,
    uids: number[],
  ): Promise<{ flags: { uid: number; isRead: boolean; isStarred: boolean }[]; existingUids: number[] }> {
    return post<{ flags: { uid: number; isRead: boolean; isStarred: boolean }[]; existingUids: number[] }>(
      '/api/v1/mail/flags',
      { account: buildAccountPayload(account, password), folder, uids },
    );
  },

  /**
   * IMAPに保存されたフィルタールールを取得（Mac→スマホ同期用）
   */
  filterPull(
    account: Account,
    password: string,
  ): Promise<{ rules: import('@/shared/types').FilterRule[] }> {
    return post<{ rules: import('@/shared/types').FilterRule[] }>('/api/v1/filters/sync', {
      account: buildAccountPayload(account, password),
    });
  },

  /**
   * IMAPに保存されたフォルダ状態を取得（Mac→スマホ同期用）
   * { uid: folder } のマッピングを返す
   */
  folderStatePull(
    account: Account,
    password: string,
  ): Promise<{ state: Record<string, string> }> {
    return post<{ state: Record<string, string> }>('/api/v1/folders/state', {
      account: buildAccountPayload(account, password),
    });
  },

  /**
   * Detect calendar events in an email
   */
  aiDetectEvent(
    apiKey: string,
    subject: string,
    bodyText: string,
    emailDate: number,
    fromName: string,
    fromAddress: string,
  ): Promise<{ event: CalendarEvent | null }> {
    return post<{ event: CalendarEvent | null }>('/api/v1/ai/detect-event', {
      apiKey, subject, bodyText, emailDate, fromName, fromAddress,
    });
  },
};

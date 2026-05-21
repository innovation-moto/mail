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

// ─── AbortController 管理（同一エンドポイントの旧リクエストをキャンセル）───────
const controllers = new Map<string, AbortController>();

function getSignal(key: string): AbortSignal {
  const prev = controllers.get(key);
  if (prev) prev.abort();
  const ctrl = new AbortController();
  controllers.set(key, ctrl);
  return ctrl.signal;
}

function clearSignal(key: string) {
  controllers.delete(key);
}

// ─── 指数バックオフ付き fetch ───────────────────────────────────────────────
async function post<T>(
  path: string,
  body: unknown,
  opts: { signal?: AbortSignal; maxRetries?: number } = {},
): Promise<T> {
  const { signal, maxRetries = 2 } = opts;
  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      // 429（重複リクエスト）と 5xx はリトライ対象
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 16000);
        attempt++;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          errorMsg = data.error ?? errorMsg;
        } catch {}
        throw new Error(errorMsg);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      // AbortError はリトライしない
      if ((err as Error).name === 'AbortError') throw err;
      if (attempt >= maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 16000);
      attempt++;
      await new Promise(r => setTimeout(r, delay));
    }
  }
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
   * 同一フォルダの旧リクエストは自動キャンセル
   */
  sync(
    account: Account,
    password: string,
    folder: string,
    sinceUid?: number,
    limit = 50,
  ): Promise<{ emails: Email[]; maxUid: number }> {
    const key = `sync:${account.email}:${folder}`;
    const signal = getSignal(key);
    const p = post<{ emails: Email[]; maxUid: number }>(
      '/api/v1/mail/sync',
      { account: buildAccountPayload(account, password), folder, sinceUid, limit },
      { signal },
    );
    p.finally(() => clearSignal(key)).catch(() => {});
    return p;
  },

  /**
   * フラグのみ軽量取得（本文なし）— 既読・スター・削除検出用
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
      { maxRetries: 1 },
    );
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
    }, { maxRetries: 1 });
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
    }, { maxRetries: 0 }); // 送信は絶対にリトライしない
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

  aiSummarize(
    apiKey: string,
    subject: string,
    bodyText: string,
  ): Promise<AiSummarizeResult> {
    return post<AiSummarizeResult>('/api/v1/ai/summarize', { apiKey, subject, bodyText });
  },

  aiReply(
    apiKey: string,
    subject: string,
    bodyText: string,
    tone: AiTone,
  ): Promise<{ reply: string }> {
    return post<{ reply: string }>('/api/v1/ai/reply', { apiKey, subject, bodyText, tone });
  },

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

  // ─── 同期・フィルター ──────────────────────────────────────────────

  filterPull(
    account: Account,
    password: string,
  ): Promise<{ rules: import('@/shared/types').FilterRule[] }> {
    return post<{ rules: import('@/shared/types').FilterRule[] }>('/api/v1/filters/sync', {
      account: buildAccountPayload(account, password),
    });
  },

  filterPush(
    account: Account,
    password: string,
    rules: import('@/shared/types').FilterRule[],
  ): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>('/api/v1/filters/push', {
      account: buildAccountPayload(account, password),
      rules,
    });
  },

  folderStatePull(
    account: Account,
    password: string,
  ): Promise<{ state: Record<string, string> }> {
    return post<{ state: Record<string, string> }>('/api/v1/folders/state', {
      account: buildAccountPayload(account, password),
    });
  },
};

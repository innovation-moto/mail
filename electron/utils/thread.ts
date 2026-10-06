const REPLY_PREFIX = /^((re|fwd?|fw|aw|回答|転送|返信)\s*[:：]\s*)+/i;

export function normalizeSubject(subject: string): string {
  return subject
    .replace(new RegExp(REPLY_PREFIX.source, 'gi'), '')
    .trim()
    .toLowerCase();
}

/** 件名が返信・転送（Re: / Fwd: 等）かどうか */
export function isReplySubject(subject: string): boolean {
  return REPLY_PREFIX.test((subject ?? '').trim());
}

/** In-Reply-To / References ヘッダー値から Message-ID を取り出す（DB と同じく <> なし） */
export function extractMessageIds(header?: string): string[] {
  if (!header) return [];
  const bracketed = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  if (bracketed.length > 0) return bracketed;
  return header.split(/\s+/).filter(Boolean);
}

/**
 * ヘッダーから決まるスレッドID。References の先頭（会話の起点）を使うので、
 * 親より先に返信を取り込んでも、後から取り込んだ起点メール自身と同じIDになる。
 */
export function rootThreadId(
  accountId: string,
  messageId: string,
  references: string[],
  inReplyTo: string[],
  fallbackKey: string,
): string {
  const root = references[0] ?? inReplyTo[0] ?? messageId;
  return `${accountId}:msgid:${root || fallbackKey}`;
}

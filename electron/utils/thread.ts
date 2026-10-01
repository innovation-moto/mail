export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^((re|fwd?|fw|aw|回答|転送|返信)\s*[:：]\s*)+/gi, '')
    .trim()
    .toLowerCase();
}

export function generateThreadId(accountId: string, subject: string, messageId?: string): string {
  const normalized = normalizeSubject(subject ?? '');
  if (!normalized) {
    return `${accountId}:msgid:${messageId ?? Date.now()}`;
  }
  return `${accountId}:${normalized}`;
}

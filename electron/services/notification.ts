import { Notification } from 'electron';
import { appendLog } from './logFile';
import type { NewMailInfo } from './imap';

// GC防止のため最近の通知オブジェクトを保持
const activeNotifications: Notification[] = [];

// 通知済みメールの重複排除。INBOX通知は IMAP IDLE・30秒チェック・定期同期の
// 3経路が独立して発火するため、同じメールを複数回通知してしまう。
// 加えて Gmail ではラベル（フォルダ）ごとに同じメールが届く。Message-ID を記録し、一度通知したメールは再通知しない。
const NOTIFIED_TTL_MS = 24 * 60 * 60 * 1000; // 24時間で失効（メモリ肥大防止）
const NOTIFIED_MAX = 5000;
const notifiedKeys = new Map<string, number>(); // key -> 通知時刻(ms)

function alreadyNotified(key: string): boolean {
  const now = Date.now();
  // 失効エントリを掃除
  if (notifiedKeys.size > 0) {
    for (const [k, ts] of notifiedKeys) {
      if (now - ts > NOTIFIED_TTL_MS) notifiedKeys.delete(k);
    }
  }
  const ts = notifiedKeys.get(key);
  if (ts !== undefined && now - ts <= NOTIFIED_TTL_MS) return true;
  notifiedKeys.set(key, now);
  // 上限超過時は古い順に削除
  if (notifiedKeys.size > NOTIFIED_MAX) {
    const oldest = [...notifiedKeys.entries()].sort((a, b) => a[1] - b[1]).slice(0, notifiedKeys.size - NOTIFIED_MAX);
    for (const [k] of oldest) notifiedKeys.delete(k);
  }
  return false;
}

function writeNotifLog(msg: string): void {
  appendLog('notification.log', `${new Date().toISOString()} ${msg}`);
}

/**
 * 新着メールを通知する。3経路（IDLE・30秒チェック・定期同期）や複数フォルダ（Gmail のラベル）から
 * 同じメールが渡されても、Message-ID 単位で一度だけ通知する。
 */
export function notifyNewMail(accountEmail: string, mails: NewMailInfo[]): void {
  if (mails.length === 0) return;
  const fresh = mails.filter((m, i) =>
    mails.findIndex((x) => x.key === m.key) === i && !alreadyNotified(`${accountEmail}|${m.key}`),
  );
  writeNotifLog(`called: account=${accountEmail} given=${mails.length} fresh=${fresh.length} supported=${Notification.isSupported()}`);
  if (fresh.length === 0) {
    writeNotifLog('SKIP: all duplicate');
    return;
  }
  if (!Notification.isSupported()) {
    writeNotifLog('SKIP: not supported');
    return;
  }

  const count = fresh.length;
  const latest = fresh.reduce((a, b) => (b.date > a.date ? b : a));
  let title: string;
  let subtitle: string | undefined;
  let body: string;

  if (count === 1 && latest) {
    title = latest.from || accountEmail;
    subtitle = latest.subject || '件名なし';
    body = latest.bodyText
      ? latest.bodyText.replace(/\s+/g, ' ').trim().slice(0, 100)
      : accountEmail;
  } else {
    title = `新着メール (${accountEmail})`;
    subtitle = `${count}件の新しいメールが届きました`;
    body = '';
  }

  writeNotifLog(`show: title="${title}" subtitle="${subtitle}" body="${body.slice(0, 50)}"`);
  const n = new Notification({ title, subtitle, body, silent: false });
  activeNotifications.push(n);
  n.on('show', () => {
    writeNotifLog('event: show fired');
    // 表示済みは保持不要なので削除
    const idx = activeNotifications.indexOf(n);
    if (idx !== -1) activeNotifications.splice(idx, 1);
  });
  n.on('failed', (_e, err) => {
    writeNotifLog(`event: failed err=${err}`);
    const idx = activeNotifications.indexOf(n);
    if (idx !== -1) activeNotifications.splice(idx, 1);
  });
  n.show();
}

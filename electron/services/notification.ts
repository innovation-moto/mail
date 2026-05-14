import { Notification } from 'electron';

export function showNewMailNotification(
  accountEmail: string,
  count: number,
  latest?: { from: string; subject: string; bodyText: string },
): void {
  if (!Notification.isSupported()) return;

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

  const n = new Notification({ title, subtitle, body, silent: false });
  n.show();
}

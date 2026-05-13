import { Notification } from 'electron';

export function showNewMailNotification(accountEmail: string, count: number): void {
  if (!Notification.isSupported()) return;

  const n = new Notification({
    title: `新着メール (${accountEmail})`,
    body: `${count}件の新しいメールが届きました`,
    silent: false,
  });
  n.show();
}

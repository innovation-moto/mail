import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// AES-256-GCM復号
async function decrypt(encryptedText: string, keyStr: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(keyStr.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
  const data = Uint8Array.from(atob(encryptedText), (c) => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

// Expo Push Notification送信
async function sendExpoPush(
  token: string,
  count: number,
  fromName: string,
  subject: string,
): Promise<void> {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify({
      to: token,
      title: count === 1 ? `新着メール: ${fromName}` : `新着メール ${count}件`,
      body: subject || '（件名なし）',
      sound: 'default',
      badge: count,
      data: { type: 'new_mail' },
    }),
  });
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const encKey = Deno.env.get('ENCRYPTION_KEY')!;
  const apiUrl = Deno.env.get('API_URL') ?? 'https://mail-opal.vercel.app';

  // 全登録を取得（Gmail/OutlookもIMAPポーリングで対応）
  const { data: registrations, error } = await supabase
    .from('push_registrations')
    .select('*');

  if (error || !registrations) {
    return new Response(JSON.stringify({ error: error?.message ?? 'no data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let processed = 0;
  let notified = 0;

  for (const reg of registrations) {
    try {
      const password = await decrypt(reg.encrypted_password, encKey);

      const res = await fetch(`${apiUrl}/api/v1/mail/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: {
            email: reg.account_email,
            imapHost: reg.imap_host,
            imapPort: reg.imap_port,
            imapSecure: reg.imap_secure,
            password,
          },
          folder: 'INBOX',
          sinceUid: reg.last_uid > 0 ? reg.last_uid : undefined,
          limit: 10,
        }),
      });

      if (!res.ok) {
        console.warn(`[imap-poll] sync failed for ${reg.account_email}: HTTP ${res.status}`);
        continue;
      }

      const { emails, maxUid } = await res.json() as { emails: Array<{ from: { name: string; address: string }; subject: string }>; maxUid: number };

      if (emails.length > 0 && maxUid > reg.last_uid) {
        const latest = emails[0];
        const fromName = latest.from?.name || latest.from?.address || '';
        await sendExpoPush(reg.device_token, emails.length, fromName, latest.subject ?? '');
        notified++;
      }

      // maxUidが更新された場合のみDB更新
      if (maxUid > reg.last_uid) {
        await supabase
          .from('push_registrations')
          .update({ last_uid: maxUid })
          .eq('id', reg.id);
      }

      processed++;
    } catch (e) {
      console.error(`[imap-poll] error for ${reg.account_email}:`, (e as Error).message);
    }
  }

  console.log(`[imap-poll] processed=${processed} notified=${notified}`);

  return new Response(JSON.stringify({ processed, notified }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

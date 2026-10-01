/**
 * Gmail Watch セットアップ / 更新 Edge Function
 * - GmailアカウントのPub/Sub watchを開始・更新する
 * - 7日ごとに更新が必要（Supabase cronで定期実行）
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TOPIC_NAME = 'projects/im-mail-497404/topics/gmail-push';

async function getAccessToken(): Promise<string> {
  const clientId     = Deno.env.get('GMAIL_CLIENT_ID')!;
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET')!;
  const refreshToken = Deno.env.get('GMAIL_REFRESH_TOKEN')!;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function watchGmail(accessToken: string, email: string): Promise<void> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(email)}/watch`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicName: TOPIC_NAME,
        labelIds: ['INBOX'],
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`watch error for ${email}: ${JSON.stringify(data)}`);
  console.log(`[gmail-watch] ${email} → expiration: ${new Date(Number(data.expiration)).toISOString()}`);
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Gmail アカウント一覧を取得
  const { data: registrations, error } = await supabase
    .from('push_registrations')
    .select('account_email')
    .eq('provider', 'gmail');

  if (error || !registrations) {
    return new Response(JSON.stringify({ error: error?.message ?? 'no data' }), { status: 500 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }

  const results: string[] = [];
  for (const reg of registrations) {
    try {
      await watchGmail(accessToken, reg.account_email);
      results.push(`✓ ${reg.account_email}`);
    } catch (e) {
      results.push(`✗ ${reg.account_email}: ${(e as Error).message}`);
    }
  }

  console.log('[gmail-watch-setup] done:', results);
  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/**
 * Gmail Push Notifications (Phase 2)
 *
 * セットアップ手順:
 * 1. Google Cloud Console でプロジェクトを作成
 * 2. Gmail API を有効化
 * 3. Pub/Sub トピックを作成: gcloud pubsub topics create gmail-push
 * 4. このEdge FunctionのURLをサブスクリプションのエンドポイントに設定
 * 5. 各ユーザーのGmailアカウントでwatchを開始:
 *    POST https://gmail.googleapis.com/gmail/v1/users/me/watch
 *    { "topicName": "projects/PROJECT_ID/topics/gmail-push", "labelIds": ["INBOX"] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sendExpoPush(token: string, title: string, body: string): Promise<void> {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ to: token, title, body, sound: 'default', data: { type: 'new_mail' } }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Google Pub/Sub は base64エンコードされたメッセージを送信する
  const body = await req.json();
  const messageData = body?.message?.data;
  if (!messageData) {
    return new Response('ok', { status: 200 }); // Pub/Subの確認応答
  }

  let notification: { emailAddress?: string; historyId?: string };
  try {
    notification = JSON.parse(atob(messageData));
  } catch {
    return new Response('ok', { status: 200 });
  }

  const email = notification.emailAddress;
  if (!email) return new Response('ok', { status: 200 });

  // 該当メールアドレスの全デバイスに通知
  const { data: registrations } = await supabase
    .from('push_registrations')
    .select('device_token')
    .eq('account_email', email)
    .eq('provider', 'gmail');

  for (const reg of registrations ?? []) {
    await sendExpoPush(reg.device_token, '新着メール', `${email} に新しいメールが届きました`);
  }

  return new Response('ok', { status: 200, headers: corsHeaders });
});

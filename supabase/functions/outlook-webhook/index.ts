/**
 * Outlook Push Notifications (Phase 2)
 *
 * セットアップ手順:
 * 1. Azure Portal でアプリ登録
 * 2. Microsoft Graph API の Mail.Read 権限を付与
 * 3. このEdge FunctionのURLでサブスクリプションを作成:
 *    POST https://graph.microsoft.com/v1.0/subscriptions
 *    {
 *      "changeType": "created",
 *      "notificationUrl": "https://PROJECT.supabase.co/functions/v1/outlook-webhook",
 *      "resource": "me/mailFolders('Inbox')/messages",
 *      "expirationDateTime": "2025-12-31T00:00:00Z",
 *      "clientState": "SECRET_TOKEN"
 *    }
 * 4. サブスクリプションは最大3日で失効するため定期的な更新が必要
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

  const url = new URL(req.url);

  // Microsoft Graph のサブスクリプション検証（初回のみ）
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    return new Response(validationToken, {
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json();
  const notifications = body?.value ?? [];

  for (const notif of notifications) {
    const userEmail = notif?.clientState; // clientStateにメールアドレスを設定しておく運用
    if (!userEmail) continue;

    const { data: registrations } = await supabase
      .from('push_registrations')
      .select('device_token')
      .eq('account_email', userEmail)
      .eq('provider', 'outlook');

    for (const reg of registrations ?? []) {
      await sendExpoPush(reg.device_token, '新着メール', `${userEmail} に新しいメールが届きました`);
    }
  }

  return new Response('', { status: 202, headers: corsHeaders });
});

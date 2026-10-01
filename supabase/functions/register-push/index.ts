import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AES-256-GCM暗号化
async function encrypt(text: string, keyStr: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(keyStr.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const combined = new Uint8Array(12 + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), 12);
  return btoa(String.fromCharCode(...combined));
}

function detectProvider(imapHost: string): string {
  if (imapHost.includes('gmail')) return 'gmail';
  if (imapHost.includes('outlook') || imapHost.includes('office365')) return 'outlook';
  return 'imap';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 登録解除
  if (req.method === 'DELETE') {
    const { deviceToken, accountEmail } = await req.json();
    const { error } = await supabase
      .from('push_registrations')
      .delete()
      .eq('device_token', deviceToken)
      .eq('account_email', accountEmail);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 登録
  const { deviceToken, accountId, accountEmail, imapHost, imapPort, imapSecure, password } = await req.json();

  if (!deviceToken || !accountEmail || !password) {
    return new Response(JSON.stringify({ error: 'missing required fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const encKey = Deno.env.get('ENCRYPTION_KEY')!;
  const encryptedPassword = await encrypt(password, encKey);
  const provider = detectProvider(imapHost);

  // 初回登録時: 現在のmaxUidを取得して「既存メールで通知しない」ようにする
  let lastUid = 0;
  try {
    const apiUrl = Deno.env.get('API_URL') ?? 'https://im-mail-api.vercel.app';
    const res = await fetch(`${apiUrl}/api/v1/mail/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: { email: accountEmail, imapHost, imapPort, imapSecure, password },
        folder: 'INBOX',
        limit: 1,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      lastUid = data.maxUid ?? 0;
    }
  } catch {
    // 取得失敗は無視（0から始まると既存メールで通知が来る可能性があるが許容）
  }

  const { error } = await supabase.from('push_registrations').upsert(
    {
      device_token: deviceToken,
      account_id: accountId,
      account_email: accountEmail,
      imap_host: imapHost,
      imap_port: imapPort,
      imap_secure: imapSecure,
      encrypted_password: encryptedPassword,
      last_uid: lastUid,
      provider,
    },
    { onConflict: 'device_token,account_email' },
  );

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

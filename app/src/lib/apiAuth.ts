import { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient } from './supabase';
import { createClient } from '@supabase/supabase-js';

// JWTのペイロードをデコードしてユーザーIDを取得（署名検証なし）
function decodeJwtPayload(token: string): { sub?: string; exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export async function getAuthUser(req: NextApiRequest, res: NextApiResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: '認証が必要です' });
    return null;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Service Role Keyがある場合はadmin APIでユーザー取得
  if (serviceKey) {
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // まずauth.getUserで試みる
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (user) {
      return { user, supabase: adminClient };
    }
    // auth.getUserが失敗した場合、JWTをデコードしてadmin.getUserByIdで取得
    console.warn('[apiAuth] auth.getUser failed:', error?.message, '- trying JWT decode fallback');
    const payload = decodeJwtPayload(token);
    if (payload?.sub) {
      // トークンの有効期限チェック
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        res.status(401).json({ error: 'セッションの有効期限が切れています。再ログインしてください。' });
        return null;
      }
      const { data: { user: adminUser }, error: adminError } = await adminClient.auth.admin.getUserById(payload.sub);
      if (adminUser && !adminError) {
        return { user: adminUser, supabase: adminClient };
      }
      console.error('[apiAuth] admin.getUserById failed:', adminError?.message);
    }
    res.status(401).json({ error: '認証が無効です。再ログインしてください。' });
    return null;
  }

  // Service Role Keyなし: JWTをAuthorizationヘッダーに付けてRLS経由でアクセス
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: '認証が無効です。再ログインしてください。' });
    return null;
  }
  return { user, supabase };
}

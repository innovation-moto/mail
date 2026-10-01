import type { Account } from '@/shared/types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function callEdgeFunction(method: string, body: object): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/register-push`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn('[pushRegistration] edge function error (ignored):', (e as Error).message);
  }
}

/** アカウントをプッシュ通知に登録 */
export async function registerAccountForPush(
  deviceToken: string,
  account: Account,
  password: string,
): Promise<void> {
  await callEdgeFunction('POST', {
    deviceToken,
    accountId: account.id,
    accountEmail: account.email,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapSecure: account.imapSecure,
    password,
  });
}

/** アカウントのプッシュ通知登録を解除 */
export async function deregisterAccountFromPush(
  deviceToken: string,
  accountEmail: string,
): Promise<void> {
  await callEdgeFunction('DELETE', { deviceToken, accountEmail });
}

/** 全アカウントを再登録（トークン更新時・アプリ起動時） */
export async function syncPushRegistrations(
  deviceToken: string,
  accounts: Account[],
  getPassword: (accountId: string) => Promise<string | null>,
): Promise<void> {
  for (const account of accounts) {
    const password = await getPassword(account.id);
    if (!password) continue;
    await registerAccountForPush(deviceToken, account, password);
  }
}

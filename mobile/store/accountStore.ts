import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { Account } from '@/shared/types';
import { registerAccountForPush, deregisterAccountFromPush } from '../lib/pushRegistration';

const ACCOUNTS_KEY = 'im_mail_accounts';
const PASSWORDS_KEY_PREFIX = 'im_mail_pwd_';
const SELECTED_KEY = 'im_mail_selected_account';
const OPENAI_KEY = 'im_mail_openai_key';
const PUSH_TOKEN_KEY = 'im_mail_push_token';

const MICROSOFT_CLIENT_ID = '263bba99-c8d1-4bfe-a2ae-9a6f9a0e0192';

interface AccountStore {
  accounts: Account[];
  selectedAccountId: string | null;
  initialized: boolean;
  openAiKey: string | null;

  init(): Promise<void>;
  addAccount(account: Account, password: string): Promise<void>;
  removeAccount(id: string): Promise<void>;
  selectAccount(id: string): Promise<void>;
  getPassword(accountId: string): Promise<string | null>;
  getSelectedAccount(): Account | null;
  saveOpenAiKey(key: string): Promise<void>;
  clearOpenAiKey(): Promise<void>;
  savePushToken(token: string): Promise<void>;
  getPushToken(): Promise<string | null>;
  refreshOAuthTokenIfNeeded(account: Account): Promise<Account>;
  updateAccount(account: Account): Promise<void>;
}

export const useAccountStore = create<AccountStore>((set, get) => ({
  accounts: [],
  selectedAccountId: null,
  initialized: false,
  openAiKey: null,

  async init() {
    try {
      const accountsJson = await SecureStore.getItemAsync(ACCOUNTS_KEY);
      const accounts: Account[] = accountsJson ? JSON.parse(accountsJson) : [];

      const selectedId = await SecureStore.getItemAsync(SELECTED_KEY);
      const selectedAccountId = selectedId && accounts.find((a) => a.id === selectedId)
        ? selectedId
        : (accounts[0]?.id ?? null);

      const openAiKey = await SecureStore.getItemAsync(OPENAI_KEY);

      set({ accounts, selectedAccountId, initialized: true, openAiKey });
    } catch {
      set({ accounts: [], selectedAccountId: null, initialized: true, openAiKey: null });
    }
  },

  async addAccount(account: Account, password: string) {
    const { accounts } = get();

    await SecureStore.setItemAsync(`${PASSWORDS_KEY_PREFIX}${account.id}`, password);

    const updated = [...accounts.filter((a) => a.id !== account.id), account];
    await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(updated));

    const selectedAccountId = get().selectedAccountId ?? account.id;
    await SecureStore.setItemAsync(SELECTED_KEY, selectedAccountId);

    set({ accounts: updated, selectedAccountId });

    // プッシュ通知に登録（失敗しても無視）
    try {
      const pushToken = await get().getPushToken();
      if (pushToken) {
        await registerAccountForPush(pushToken, account, password);
      }
    } catch {}
  },

  async removeAccount(id: string) {
    const { accounts, selectedAccountId } = get();

    // プッシュ通知登録を解除（失敗しても無視）
    try {
      const account = accounts.find((a) => a.id === id);
      const pushToken = await get().getPushToken();
      if (account && pushToken) {
        await deregisterAccountFromPush(pushToken, account.email);
      }
    } catch {}

    await SecureStore.deleteItemAsync(`${PASSWORDS_KEY_PREFIX}${id}`);

    const updated = accounts.filter((a) => a.id !== id);
    await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(updated));

    const newSelected = selectedAccountId === id
      ? (updated[0]?.id ?? null)
      : selectedAccountId;

    if (newSelected) {
      await SecureStore.setItemAsync(SELECTED_KEY, newSelected);
    } else {
      await SecureStore.deleteItemAsync(SELECTED_KEY);
    }

    set({ accounts: updated, selectedAccountId: newSelected });
  },

  async selectAccount(id: string) {
    await SecureStore.setItemAsync(SELECTED_KEY, id);
    set({ selectedAccountId: id });
  },

  async getPassword(accountId: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(`${PASSWORDS_KEY_PREFIX}${accountId}`);
    } catch {
      return null;
    }
  },

  getSelectedAccount(): Account | null {
    const { accounts, selectedAccountId } = get();
    return accounts.find((a) => a.id === selectedAccountId) ?? null;
  },

  async updateAccount(account: Account): Promise<void> {
    const { accounts } = get();
    const updated = accounts.map((a) => a.id === account.id ? account : a);
    await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(updated));
    set({ accounts: updated });
  },

  async refreshOAuthTokenIfNeeded(account: Account): Promise<Account> {
    if (!account.oauthRefreshToken) return account;
    const expiresAt = account.oauthExpiresAt ?? 0;
    if (expiresAt > Date.now() + 60000) return account;

    const body = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: account.oauthRefreshToken,
      scope: [
        'offline_access', 'openid', 'email', 'profile',
        'https://outlook.office.com/IMAP.AccessAsUser.All',
        'https://outlook.office.com/SMTP.Send',
      ].join(' '),
    });

    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) return account;

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const refreshed: Account = {
      ...account,
      oauthAccessToken: data.access_token,
      oauthRefreshToken: data.refresh_token ?? account.oauthRefreshToken,
      oauthExpiresAt: Date.now() + data.expires_in * 1000,
    };

    await get().updateAccount(refreshed);
    return refreshed;
  },

  async saveOpenAiKey(key: string) {
    await SecureStore.setItemAsync(OPENAI_KEY, key);
    set({ openAiKey: key });
  },

  async clearOpenAiKey() {
    await SecureStore.deleteItemAsync(OPENAI_KEY);
    set({ openAiKey: null });
  },

  async savePushToken(token: string) {
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  },

  async getPushToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    } catch {
      return null;
    }
  },
}));

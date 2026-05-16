import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { Account } from '@/shared/types';

const ACCOUNTS_KEY = 'im_mail_accounts';
const PASSWORDS_KEY_PREFIX = 'im_mail_pwd_';
const SELECTED_KEY = 'im_mail_selected_account';
const OPENAI_KEY = 'im_mail_openai_key';

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

    // Save password in SecureStore separately
    await SecureStore.setItemAsync(`${PASSWORDS_KEY_PREFIX}${account.id}`, password);

    const updated = [...accounts.filter((a) => a.id !== account.id), account];
    await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(updated));

    const selectedAccountId = get().selectedAccountId ?? account.id;
    await SecureStore.setItemAsync(SELECTED_KEY, selectedAccountId);

    set({ accounts: updated, selectedAccountId });
  },

  async removeAccount(id: string) {
    const { accounts, selectedAccountId } = get();
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

  async saveOpenAiKey(key: string) {
    await SecureStore.setItemAsync(OPENAI_KEY, key);
    set({ openAiKey: key });
  },

  async clearOpenAiKey() {
    await SecureStore.deleteItemAsync(OPENAI_KEY);
    set({ openAiKey: null });
  },
}));

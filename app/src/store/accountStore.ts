'use client';
import { create } from 'zustand';
import { Account, AccountConfig, TestConnectionResult } from '@/types/shared';
import { api } from '@/lib/ipc';

interface AccountState {
  accounts: Account[];
  selectedAccountId: string | null;
  loading: boolean;
  error: string | null;

  loadAccounts: () => Promise<void>;
  selectAccount: (id: string) => void;
  createAccount: (config: AccountConfig) => Promise<Account>;
  updateAccount: (id: string, config: Partial<AccountConfig>) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  testConnection: (config: AccountConfig) => Promise<TestConnectionResult>;
  selectedAccount: () => Account | null;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  selectedAccountId: null,
  loading: false,
  error: null,

  selectedAccount: () => {
    const { accounts, selectedAccountId } = get();
    return accounts.find((a) => a.id === selectedAccountId) ?? null;
  },

  loadAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const accounts = await api.accounts.list();
      set({
        accounts,
        selectedAccountId: accounts.length > 0 ? (get().selectedAccountId ?? accounts[0].id) : null,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  selectAccount: (id) => set({ selectedAccountId: id }),

  createAccount: async (config) => {
    const account = await api.accounts.create(config);
    set((s) => ({
      accounts: [...s.accounts, account],
      selectedAccountId: s.selectedAccountId ?? account.id,
    }));
    return account;
  },

  updateAccount: async (id, config) => {
    const updated = await api.accounts.update(id, config);
    set((s) => ({
      accounts: s.accounts.map((a) => (a.id === id ? updated : a)),
    }));
  },

  deleteAccount: async (id) => {
    await api.accounts.delete(id);
    set((s) => {
      const accounts = s.accounts.filter((a) => a.id !== id);
      return {
        accounts,
        selectedAccountId:
          s.selectedAccountId === id ? (accounts[0]?.id ?? null) : s.selectedAccountId,
      };
    });
  },

  testConnection: (config) => api.accounts.test(config),
}));

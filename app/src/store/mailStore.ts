'use client';
import { create } from 'zustand';
import { Email, Folder, ComposeData, SyncResult } from '@/types/shared';
import { api } from '@/lib/ipc';

interface MailState {
  emails: Email[];
  selectedEmailId: string | null;
  selectedFolder: string;
  folders: Folder[];
  loading: boolean;
  syncing: boolean;
  searchQuery: string;
  searchResults: Email[] | null;
  isSmartSearch: boolean;
  smartSearchAnswer: string;
  error: string | null;
  inboxUnreadCount: number;
  folderUnreadCounts: Record<string, number>;
  loadUnreadCounts: (accountId: string) => Promise<void>;
  setUnreadCounts: (counts: Record<string, number>) => void;

  loadFolders: (accountId: string) => Promise<void>;
  loadEmails: (accountId: string, folder?: string) => Promise<void>;
  selectEmail: (id: string | null) => void;
  selectFolder: (folder: string) => void;
  syncEmails: (accountId: string) => Promise<SyncResult>;
  sendEmail: (data: ComposeData) => Promise<void>;
  markRead: (emailId: string, isRead: boolean) => Promise<void>;
  markAllRead: (accountId: string, folder: string) => Promise<void>;
  starEmail: (emailId: string, isStarred: boolean) => Promise<void>;
  pinEmail: (emailId: string, isPinned: boolean) => Promise<void>;
  deleteEmail: (emailId: string) => Promise<void>;
  moveEmail: (emailId: string, folder: string) => Promise<void>;
  search: (accountId: string, query: string) => Promise<void>;
  clearSearch: () => void;
  smartSearch: (accountId: string, query: string) => Promise<void>;
  selectedEmail: () => Email | null;
  updateEmailLocally: (id: string, patch: Partial<Email>) => void;
}

export const useMailStore = create<MailState>((set, get) => ({
  emails: [],
  selectedEmailId: null,
  selectedFolder: 'INBOX',
  folders: [],
  loading: false,
  syncing: false,
  searchQuery: '',
  searchResults: null,
  isSmartSearch: false,
  smartSearchAnswer: '',
  error: null,
  inboxUnreadCount: 0,
  folderUnreadCounts: {},

  selectedEmail: () => {
    const { emails, selectedEmailId, searchResults } = get();
    const pool = searchResults ?? emails;
    return pool.find((e) => e.id === selectedEmailId) ?? null;
  },

  updateEmailLocally: (id, patch) => {
    set((s) => ({
      emails: s.emails.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      searchResults: s.searchResults
        ? s.searchResults.map((e) => (e.id === id ? { ...e, ...patch } : e))
        : null,
    }));
  },

  loadFolders: async (accountId) => {
    try {
      const folders = await api.mail.fetchFolders(accountId);
      set({ folders });
    } catch (err) {
      console.error('Failed to load folders:', err);
      // エラー時はフォルダ一覧を消さない（現状維持）
    }
  },

  loadEmails: async (accountId, folder) => {
    const f = folder ?? get().selectedFolder;
    set({ loading: true, error: null });
    try {
      const emails = await api.mail.fetchEmails(accountId, f, 50, 0);
      const unreadCount = f === 'INBOX' ? emails.filter((e: { isRead: boolean }) => !e.isRead).length : get().inboxUnreadCount;
      set({ emails, loading: false, selectedFolder: f, inboxUnreadCount: unreadCount });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  loadUnreadCounts: async (accountId) => {
    try {
      const counts = await api.mail.getUnreadCounts(accountId);
      set({
        folderUnreadCounts: counts,
        inboxUnreadCount: counts['INBOX'] ?? 0,
      });
    } catch {}
  },

  setUnreadCounts: (counts) => {
    set({
      folderUnreadCounts: counts,
      inboxUnreadCount: counts['INBOX'] ?? 0,
    });
  },

  selectEmail: (id) => set({ selectedEmailId: id }),

  selectFolder: (folder) => set({ selectedFolder: folder, selectedEmailId: null }),

  syncEmails: async (accountId) => {
    set({ syncing: true });
    try {
      const result = await api.mail.sync(accountId, get().selectedFolder);
      // スピナーを出さずサイレントにリロード
      const f = get().selectedFolder;
      try {
        const emails = await api.mail.fetchEmails(accountId, f, 50, 0);
        set({ emails });
      } catch {}
      // 全フォルダの未読数を更新
      get().loadUnreadCounts(accountId).catch(() => {});
      return result;
    } finally {
      set({ syncing: false });
    }
  },

  sendEmail: async (data) => {
    await api.mail.send(data);
  },

  markRead: async (emailId, isRead) => {
    get().updateEmailLocally(emailId, { isRead });
    const folder = get().selectedFolder;
    const unreadCount = get().emails.filter((e) => !e.isRead).length;
    set((s) => ({
      inboxUnreadCount: folder === 'INBOX' ? unreadCount : s.inboxUnreadCount,
      folderUnreadCounts: { ...s.folderUnreadCounts, [folder]: unreadCount },
    }));
    await api.mail.markRead(emailId, isRead);
    // DBから全フォルダの未読数を再取得して同期（すべてのメール等も更新）
    const email = get().emails.find((e) => e.id === emailId)
      ?? get().searchResults?.find((e) => e.id === emailId);
    if (email?.accountId) {
      get().loadUnreadCounts(email.accountId).catch(() => {});
    }
  },

  markAllRead: async (accountId, folder) => {
    set((s) => ({
      emails: s.emails.map((e) => (e.folder === folder ? { ...e, isRead: true } : e)),
      searchResults: s.searchResults
        ? s.searchResults.map((e) => (e.folder === folder ? { ...e, isRead: true } : e))
        : null,
      inboxUnreadCount: folder === 'INBOX' ? 0 : s.inboxUnreadCount,
      folderUnreadCounts: { ...s.folderUnreadCounts, [folder]: 0 },
    }));
    await api.mail.markAllRead(accountId, folder);
    // DBから全フォルダの未読数を再取得
    get().loadUnreadCounts(accountId).catch(() => {});
  },

  starEmail: async (emailId, isStarred) => {
    get().updateEmailLocally(emailId, { isStarred });
    await api.mail.star(emailId, isStarred);
  },

  pinEmail: async (emailId, isPinned) => {
    get().updateEmailLocally(emailId, { isPinned });
    // Pinnedフォルダ表示中は解除したメールをリストから除去
    if (get().selectedFolder === 'Pinned' && !isPinned) {
      set((s) => ({ emails: s.emails.filter((e) => e.id !== emailId) }));
    }
    await api.mail.pin(emailId, isPinned);
  },

  deleteEmail: async (emailId) => {
    const target = get().emails.find((e) => e.id === emailId)
      ?? get().searchResults?.find((e) => e.id === emailId);
    set((s) => {
      const newEmails = s.emails.filter((e) => e.id !== emailId);
      // 削除時はGmail同様に既読扱いでカウントを減らす
      const folderUnreadCounts = { ...s.folderUnreadCounts };
      if (target && !target.isRead) {
        const folder = target.folder;
        folderUnreadCounts[folder] = Math.max(0, (folderUnreadCounts[folder] ?? 0) - 1);
      }
      const inboxUnreadCount = folderUnreadCounts['INBOX'] ?? s.inboxUnreadCount;
      return {
        emails: newEmails,
        selectedEmailId: s.selectedEmailId === emailId ? null : s.selectedEmailId,
        folderUnreadCounts,
        inboxUnreadCount,
      };
    });
    await api.mail.delete(emailId);
    // DBから全フォルダの未読数を再取得（すべてのメール等も更新）
    if (target?.accountId) {
      get().loadUnreadCounts(target.accountId).catch(() => {});
    }
  },

  moveEmail: async (emailId, folder) => {
    set((s) => ({
      emails: s.emails.filter((e) => e.id !== emailId),
      selectedEmailId: s.selectedEmailId === emailId ? null : s.selectedEmailId,
    }));
    await api.mail.move(emailId, folder);
  },

  search: async (accountId, query) => {
    if (!query.trim()) {
      set({ searchResults: null, searchQuery: '', isSmartSearch: false, smartSearchAnswer: '' });
      return;
    }
    set({ loading: true, searchQuery: query, isSmartSearch: false, smartSearchAnswer: '' });
    try {
      const results = await api.mail.search(accountId, query);
      set({ searchResults: results, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  clearSearch: () => set({ searchResults: null, searchQuery: '', isSmartSearch: false, smartSearchAnswer: '' }),

  smartSearch: async (accountId, query) => {
    set({ loading: true, searchQuery: query, isSmartSearch: true, smartSearchAnswer: '' });
    try {
      const result = await api.ai.smartSearch(accountId, query);
      set({ searchResults: result.emails, smartSearchAnswer: result.answer, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },
}));

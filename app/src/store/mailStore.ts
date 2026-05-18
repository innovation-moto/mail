'use client';
import { create } from 'zustand';
import { Email, Folder, ComposeData, SyncResult, ThreadSummary } from '@/types/shared';
import { api } from '@/lib/ipc';

// 削除APIが完了するまで復活させないためのセット
const pendingDeletes = new Set<string>();

interface MailState {
  emails: Email[];
  selectedEmailId: string | null;
  selectedFolder: string;
  folders: Folder[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  syncing: boolean;
  searchQuery: string;
  searchResults: Email[] | null;
  isSmartSearch: boolean;
  smartSearchAnswer: string;
  error: string | null;
  inboxUnreadCount: number;
  imapInboxCount: number;
  folderUnreadCounts: Record<string, number>;
  loadUnreadCounts: (accountId: string) => Promise<void>;
  setUnreadCounts: (counts: Record<string, number>) => void;

  // スレッド関連
  threads: ThreadSummary[];
  selectedThreadId: string | null;
  threadEmails: Email[];
  loadingThread: boolean;
  loadingMoreThreads: boolean;
  hasMoreThreads: boolean;

  loadFolders: (accountId: string) => Promise<void>;
  loadEmails: (accountId: string, folder?: string) => Promise<void>;
  loadMoreEmails: (accountId: string) => Promise<void>;
  loadThreads: (accountId: string, folder?: string, silent?: boolean) => Promise<void>;
  loadMoreThreads: (accountId: string) => Promise<void>;
  selectThread: (accountId: string, threadId: string, folder: string) => Promise<void>;
  clearThread: () => void;
  selectEmail: (id: string | null) => void;
  selectFolder: (folder: string) => void;
  syncEmails: (accountId: string) => Promise<SyncResult>;
  sendEmail: (data: ComposeData) => Promise<void>;
  markRead: (emailId: string, isRead: boolean) => Promise<void>;
  markAllRead: (accountId: string, folder: string) => Promise<void>;
  starEmail: (emailId: string, isStarred: boolean) => Promise<void>;
  pinEmail: (emailId: string, isPinned: boolean) => Promise<void>;
  deleteEmail: (emailId: string) => Promise<void>;
  deleteThread: (threadId: string, latestEmailId: string) => Promise<void>;
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
  loadingMore: false,
  hasMore: true,
  syncing: false,
  searchQuery: '',
  searchResults: null,
  isSmartSearch: false,
  smartSearchAnswer: '',
  error: null,
  inboxUnreadCount: 0,
  imapInboxCount: 0,
  folderUnreadCounts: {},
  threads: [],
  selectedThreadId: null,
  threadEmails: [],
  loadingThread: false,
  loadingMoreThreads: false,
  hasMoreThreads: true,

  selectedEmail: () => {
    const { emails, selectedEmailId, searchResults, threadEmails } = get();
    if (selectedEmailId) {
      const pool = searchResults ?? [...emails, ...threadEmails];
      return pool.find((e) => e.id === selectedEmailId) ?? null;
    }
    return null;
  },

  updateEmailLocally: (id, patch) => {
    set((s) => ({
      emails: s.emails.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      threadEmails: s.threadEmails.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      searchResults: s.searchResults
        ? s.searchResults.map((e) => (e.id === id ? { ...e, ...patch } : e))
        : null,
    }));
  },

  loadFolders: async (accountId) => {
    try {
      const folders = await api.mail.fetchFolders(accountId);
      set({ folders });
      // INBOXのIMAPからの実際の未読数を保存（loadUnreadCountsのDB値より優先）
      const inbox = folders.find((f) => f.path === 'INBOX');
      if (inbox && inbox.unreadCount > 0) {
        console.log('[loadFolders] IMAP INBOX unreadCount:', inbox.unreadCount);
        set((s) => ({
          imapInboxCount: inbox.unreadCount,
          folderUnreadCounts: { ...s.folderUnreadCounts, INBOX: inbox.unreadCount },
          inboxUnreadCount: inbox.unreadCount,
        }));
      }
    } catch (err) {
      console.error('Failed to load folders:', err);
      // エラー時はフォルダ一覧を消さない（現状維持）
    }
  },

  loadEmails: async (accountId, folder) => {
    const f = folder ?? get().selectedFolder;
    set({ loading: true, error: null, hasMore: true });
    try {
      const emails = await api.mail.fetchEmails(accountId, f, 50, 0);
      const unreadCount = f === 'INBOX' ? emails.filter((e: { isRead: boolean }) => !e.isRead).length : get().inboxUnreadCount;
      set({ emails, loading: false, selectedFolder: f, inboxUnreadCount: unreadCount, hasMore: emails.length === 50 });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  loadMoreEmails: async (accountId) => {
    const { emails, selectedFolder, loadingMore, hasMore } = get();
    if (loadingMore || !hasMore) return;
    set({ loadingMore: true });
    try {
      const more = await api.mail.fetchEmails(accountId, selectedFolder, 50, emails.length);
      set({ emails: [...emails, ...more], loadingMore: false, hasMore: more.length === 50 });
    } catch {
      set({ loadingMore: false });
    }
  },

  loadUnreadCounts: async (accountId) => {
    try {
      const counts = await api.mail.getUnreadCounts(accountId);
      // IMAPで取得済みのINBOX未読数がある場合はそちらを優先（DBの古い値で上書きしない）
      const { imapInboxCount } = get();
      const inboxCount = imapInboxCount > 0 ? imapInboxCount : (counts['INBOX'] ?? 0);
      const merged = { ...counts, INBOX: inboxCount };
      set({
        folderUnreadCounts: merged,
        inboxUnreadCount: inboxCount,
      });
    } catch {}
  },

  setUnreadCounts: (counts) => {
    const { imapInboxCount } = get();
    const inboxCount = imapInboxCount > 0 ? imapInboxCount : (counts['INBOX'] ?? 0);
    set({
      folderUnreadCounts: { ...counts, INBOX: inboxCount },
      inboxUnreadCount: inboxCount,
    });
  },

  loadThreads: async (accountId, folder, silent = false) => {
    const f = folder ?? get().selectedFolder;
    if (!silent) {
      set({ loading: true, error: null, hasMoreThreads: true, threads: [], selectedThreadId: null, threadEmails: [] });
    }
    try {
      const raw = await api.mail.fetchThreads(accountId, f, 50, 0);
      const threads = raw.filter((t) => !pendingDeletes.has(t.threadId));
      if (silent) {
        set({ threads, hasMoreThreads: raw.length === 50 });
      } else {
        set({ threads, loading: false, selectedFolder: f, hasMoreThreads: raw.length === 50 });
        const counts = await api.mail.getUnreadCounts(accountId);
        const imap1 = get().imapInboxCount;
        const inbox1 = imap1 > 0 ? imap1 : (counts['INBOX'] ?? 0);
        set({ folderUnreadCounts: { ...counts, INBOX: inbox1 }, inboxUnreadCount: inbox1 });
      }
    } catch (err) {
      if (!silent) set({ loading: false, error: (err as Error).message });
    }
  },

  loadMoreThreads: async (accountId) => {
    const { threads, selectedFolder, loadingMoreThreads, hasMoreThreads } = get();
    if (loadingMoreThreads || !hasMoreThreads) return;
    set({ loadingMoreThreads: true });
    try {
      const more = await api.mail.fetchThreads(accountId, selectedFolder, 50, threads.length);
      set({ threads: [...threads, ...more], loadingMoreThreads: false, hasMoreThreads: more.length === 50 });
    } catch {
      set({ loadingMoreThreads: false });
    }
  },

  selectThread: async (accountId, threadId, folder) => {
    set({ selectedThreadId: threadId, loadingThread: true, selectedEmailId: null, threadEmails: [] });
    try {
      const emails = await api.mail.fetchThreadEmails(accountId, threadId, folder);
      set({ threadEmails: emails, loadingThread: false });
      // スレッド内の未読メールをまとめて既読に
      const unread = emails.filter((e: Email) => !e.isRead);
      if (unread.length > 0) {
        // スレッド一覧の未読数を即時更新
        set((s) => ({
          threads: s.threads.map((t) =>
            t.threadId === threadId ? { ...t, unreadCount: 0 } : t,
          ),
          threadEmails: s.threadEmails.map((e) => ({ ...e, isRead: true })),
        }));
        // IMAP/DBへの既読反映（並列）
        await Promise.all(unread.map((e: Email) => api.mail.markRead(e.id, true).catch(() => {})));
        // バッジ更新（メール単位）
        api.mail.getUnreadCounts(accountId).then((counts) => {
          const imapN = get().imapInboxCount;
          const inboxN = imapN > 0 ? imapN : (counts['INBOX'] ?? 0);
          set({ folderUnreadCounts: { ...counts, INBOX: inboxN }, inboxUnreadCount: inboxN });
        }).catch(() => {});
      }
    } catch {
      set({ loadingThread: false });
    }
  },

  clearThread: () => set({ selectedThreadId: null, threadEmails: [], selectedEmailId: null }),

  selectEmail: (id) => set({ selectedEmailId: id }),

  selectFolder: (folder) => set({ selectedFolder: folder, selectedEmailId: null, selectedThreadId: null, threadEmails: [] }),

  syncEmails: async (accountId) => {
    set({ syncing: true });
    try {
      const result = await api.mail.sync(accountId, get().selectedFolder);
      const f = get().selectedFolder;
      // スレッドリストをサイレントにリロード
      try {
        const raw = await api.mail.fetchThreads(accountId, f, 50, 0);
        const threads = raw.filter((t) => !pendingDeletes.has(t.threadId));
        set({ threads, hasMoreThreads: raw.length === 50 });
      } catch {}
      // 全フォルダの未読数を更新（メール単位）
      api.mail.getUnreadCounts(accountId).then((counts) => {
        set({ folderUnreadCounts: counts, inboxUnreadCount: counts['INBOX'] ?? 0 });
      }).catch(() => {});
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

  deleteThread: async (threadId, latestEmailId) => {
    pendingDeletes.add(threadId);
    set((s) => ({
      threads: s.threads.filter((t) => t.threadId !== threadId),
      selectedThreadId: s.selectedThreadId === threadId ? null : s.selectedThreadId,
    }));
    try {
      await api.mail.delete(latestEmailId);
    } finally {
      pendingDeletes.delete(threadId);
    }
  },

  moveEmail: async (emailId, folder) => {
    set((s) => ({
      emails: s.emails.filter((e) => e.id !== emailId),
      threads: s.threads.filter((t) => t.latestEmailId !== emailId),
      selectedEmailId: s.selectedEmailId === emailId ? null : s.selectedEmailId,
      selectedThreadId: s.threads.find((t) => t.latestEmailId === emailId)?.threadId === s.selectedThreadId
        ? null : s.selectedThreadId,
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

import { create } from 'zustand';
import type { Email, Folder } from '@/shared/types';
import { mailApi } from '../lib/api';
import {
  listEmails,
  upsertEmail,
  markRead,
  markStar,
  markDeleted,
  getMaxUid,
  getUnreadCountsByFolder,
  applyFilterRules,
} from '../lib/db';
import { useAccountStore } from './accountStore';
import { showNewMailNotification, setBadgeCount } from '../lib/notifications';

interface MailStore {
  emails: Email[];
  folders: Folder[];
  folderUnreadCounts: Record<string, number>;
  selectedEmailId: string | null;
  selectedFolder: string;
  loading: boolean;
  syncing: boolean;
  foldersLoading: boolean;
  error: string | null;

  setFolder(folder: string): void;
  selectEmail(id: string | null): void;
  getSelectedEmail(): Email | null;

  loadFolders(accountId: string): Promise<void>;
  loadEmails(accountId: string, folder: string): Promise<void>;
  syncEmails(accountId: string, folder: string): Promise<void>;
  refreshUnreadCounts(accountId: string): Promise<void>;

  markRead(id: string, uid: number, folder: string): Promise<void>;
  starEmail(id: string, uid: number, folder: string, isStarred: boolean): Promise<void>;
  deleteEmail(id: string, uid: number, folder: string): Promise<void>;
}

export const useMailStore = create<MailStore>((set, get) => ({
  emails: [],
  folders: [],
  folderUnreadCounts: {},
  selectedEmailId: null,
  selectedFolder: 'INBOX',
  loading: false,
  syncing: false,
  foldersLoading: false,
  error: null,

  setFolder(folder: string) {
    set({ selectedFolder: folder, selectedEmailId: null, emails: [] });
  },

  selectEmail(id: string | null) {
    set({ selectedEmailId: id });
  },

  getSelectedEmail(): Email | null {
    const { emails, selectedEmailId } = get();
    return emails.find((e) => e.id === selectedEmailId) ?? null;
  },

  async refreshUnreadCounts(accountId: string) {
    try {
      const counts = await getUnreadCountsByFolder(accountId);
      set({ folderUnreadCounts: counts });
    } catch {}
  },

  async loadFolders(accountId: string) {
    const accountStore = useAccountStore.getState();
    const account = accountStore.accounts.find((a) => a.id === accountId);
    if (!account) return;
    const password = await accountStore.getPassword(accountId);
    if (!password) return;

    set({ foldersLoading: true });
    try {
      const folders = await mailApi.folders(account, password);
      set({ folders });
    } catch (err) {
      // フォルダ取得失敗は無視（ハードコードにフォールバック）
      console.warn('[loadFolders]', err);
    } finally {
      set({ foldersLoading: false });
    }
  },

  async loadEmails(accountId: string, folder: string) {
    set({ loading: true, error: null });
    try {
      const emails = await listEmails(accountId, folder);
      set({ emails });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  async syncEmails(accountId: string, folder: string) {
    const accountStore = useAccountStore.getState();
    const account = accountStore.accounts.find((a) => a.id === accountId);
    if (!account) return;

    const password = await accountStore.getPassword(accountId);
    if (!password) return;

    set({ syncing: true, error: null });
    try {
      const sinceUid = await getMaxUid(accountId, folder);
      const { emails } = await mailApi.sync(account, password, folder, sinceUid || undefined);

      // 同期前の未読数を記録（新着検知用）
      const beforeCounts = await getUnreadCountsByFolder(accountId);
      const beforeInboxUnread = beforeCounts['INBOX'] ?? 0;

      // Persist to SQLite
      for (const email of emails) {
        await upsertEmail({ ...email, accountId });
      }

      // フィルタールール適用
      await applyFilterRules(accountId);

      // Reload from DB
      const allEmails = await listEmails(accountId, folder);
      set({ emails: allEmails });

      // フォルダ別未読数を更新
      const counts = await getUnreadCountsByFolder(accountId);
      set({ folderUnreadCounts: counts });

      // 新着メール通知
      const afterInboxUnread = counts['INBOX'] ?? 0;
      const newCount = afterInboxUnread - beforeInboxUnread;
      if (newCount > 0 && folder === 'INBOX') {
        const latest = allEmails.find((e) => !e.isRead);
        await showNewMailNotification(
          newCount,
          latest?.from.name || latest?.from.address || '',
          latest?.subject || '',
        );
      }

      // バッジ更新（全フォルダの未読合計）
      const totalUnread = Object.values(counts).reduce((s, n) => s + n, 0);
      await setBadgeCount(totalUnread);
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ syncing: false });
    }
  },

  async markRead(id: string, uid: number, folder: string) {
    const accountStore = useAccountStore.getState();
    const account = accountStore.getSelectedAccount();
    if (!account) return;

    // Optimistic update
    set((state) => ({
      emails: state.emails.map((e) => (e.id === id ? { ...e, isRead: true } : e)),
    }));

    await markRead(id, true);

    // 未読バッジを即時更新
    const counts = await getUnreadCountsByFolder(account.id);
    set({ folderUnreadCounts: counts });

    const password = await accountStore.getPassword(account.id);
    if (password) {
      mailApi.action(account, password, folder, uid, 'markRead').catch(() => {});
    }
  },

  async starEmail(id: string, uid: number, folder: string, isStarred: boolean) {
    const accountStore = useAccountStore.getState();
    const account = accountStore.getSelectedAccount();
    if (!account) return;

    set((state) => ({
      emails: state.emails.map((e) => (e.id === id ? { ...e, isStarred } : e)),
    }));

    await markStar(id, isStarred);

    const password = await accountStore.getPassword(account.id);
    if (password) {
      const action = isStarred ? 'star' : 'unstar';
      mailApi.action(account, password, folder, uid, action).catch(() => {});
    }
  },

  async deleteEmail(id: string, uid: number, folder: string) {
    const accountStore = useAccountStore.getState();
    const account = accountStore.getSelectedAccount();
    if (!account) return;

    set((state) => ({
      emails: state.emails.filter((e) => e.id !== id),
    }));

    await markDeleted(id);

    const password = await accountStore.getPassword(account.id);
    if (password) {
      mailApi.action(account, password, folder, uid, 'delete').catch(() => {});
    }
  },
}));

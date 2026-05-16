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
  getUidsForFolder,
  updateEmailFlags,
  removeExpungedEmails,
} from '../lib/db';
import { useAccountStore } from './accountStore';
// notifications は動的インポートで読み込む（モジュールクラッシュ対策）

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
  syncAllFolders(accountId: string): Promise<void>;
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

  // バックグラウンドで全フォルダを同期（画面・emails状態は一切書き換えない）
  async syncAllFolders(accountId: string) {
    const accountStore = useAccountStore.getState();
    const account = accountStore.accounts.find((a) => a.id === accountId);
    if (!account) return;
    const password = await accountStore.getPassword(accountId);
    if (!password) return;

    const { folders, selectedFolder } = get();
    const SKIP = /Trash|ゴミ箱|Deleted|Spam|Junk|迷惑|Draft|下書き|Outbox|allmail|all mail|すべてのメール/i;
    const targets = folders.length > 0
      ? folders.filter(f => !SKIP.test(f.path)).map(f => f.path)
      : ['INBOX'];
    const ordered = ['INBOX', ...targets.filter(p => p !== 'INBOX')];

    const beforeCounts = await getUnreadCountsByFolder(accountId);
    const beforeInboxUnread = beforeCounts['INBOX'] ?? 0;

    for (const folder of ordered) {
      try {
        const sinceUid = await getMaxUid(accountId, folder);
        const { emails } = await mailApi.sync(account, password, folder, sinceUid || undefined);

        for (const email of emails) {
          await upsertEmail({ ...email, accountId });
        }

        // フィルタールール適用
        const filterMatches = await applyFilterRules(accountId);
        for (const m of filterMatches) {
          if (m.toFolder && m.toFolder !== m.fromFolder) {
            mailApi.action(account, password, m.fromFolder, m.uid, 'move', m.toFolder).catch(() => {});
          }
          if (m.markRead) mailApi.action(account, password, m.fromFolder, m.uid, 'markRead').catch(() => {});
          if (m.starred) mailApi.action(account, password, m.fromFolder, m.uid, 'star').catch(() => {});
        }

        // フラグ同期 + 消えたUID検出（EXPUNGE）
        try {
          const localEntries = await getUidsForFolder(accountId, folder);
          if (localEntries.length > 0) {
            const uids = localEntries.map(e => e.uid);
            // 100件ずつに分割してAPIコール
            const CHUNK = 100;
            const existingUids: number[] = [];
            for (let i = 0; i < uids.length; i += CHUNK) {
              const chunk = uids.slice(i, i + CHUNK);
              const result = await mailApi.syncFlags(account, password, folder, chunk);
              existingUids.push(...result.existingUids);
              for (const flag of result.flags) {
                const entry = localEntries.find(e => e.uid === flag.uid);
                if (entry && (entry.isRead !== flag.isRead || entry.isStarred !== flag.isStarred)) {
                  await updateEmailFlags(entry.id, flag.isRead, flag.isStarred);
                }
              }
            }
            // サーバーに存在しないメールをDB上で削除扱いに
            await removeExpungedEmails(accountId, folder, existingUids);
          }
        } catch (flagErr) {
          console.warn(`[syncAllFolders] flags ${folder}:`, (flagErr as Error).message);
        }

        // 現在表示中のフォルダなら画面も更新
        if (folder === selectedFolder) {
          const visibleEmails = await listEmails(accountId, folder);
          set({ emails: visibleEmails });
        }
      } catch (e) {
        console.warn(`[syncAllFolders] ${folder}:`, (e as Error).message);
      }
    }

    // 全フォルダ完了後に未読数・バッジをまとめて更新
    const counts = await getUnreadCountsByFolder(accountId);
    set({ folderUnreadCounts: counts });

    // 新着通知・バッジ
    try {
      const { showNewMailNotification, setBadgeCount } = await import('../lib/notifications');
      const afterInboxUnread = counts['INBOX'] ?? 0;
      const newCount = afterInboxUnread - beforeInboxUnread;
      if (newCount > 0) {
        const inboxEmails = await listEmails(accountId, 'INBOX');
        const latest = inboxEmails.find(e => !e.isRead);
        await showNewMailNotification(newCount, latest?.from.name || latest?.from.address || '', latest?.subject || '');
      }
      const totalUnread = Object.values(counts).reduce((s, n) => s + n, 0);
      await setBadgeCount(totalUnread);
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

      // フィルタールール適用（ローカルDB更新 + IMAPサーバー移動）
      const filterMatches = await applyFilterRules(accountId);
      for (const m of filterMatches) {
        if (m.toFolder && m.toFolder !== m.fromFolder) {
          // IMAPサーバー上でも移動（Gmailや他デバイスにも反映）
          mailApi.action(account, password, m.fromFolder, m.uid, 'move', m.toFolder).catch(() => {});
        }
        if (m.markRead) {
          mailApi.action(account, password, m.fromFolder, m.uid, 'markRead').catch(() => {});
        }
        if (m.starred) {
          mailApi.action(account, password, m.fromFolder, m.uid, 'star').catch(() => {});
        }
      }

      // Reload from DB
      const allEmails = await listEmails(accountId, folder);
      set({ emails: allEmails });

      // フォルダ別未読数を更新
      const counts = await getUnreadCountsByFolder(accountId);
      set({ folderUnreadCounts: counts });

      // 新着メール通知
      const afterInboxUnread = counts['INBOX'] ?? 0;
      const newCount = afterInboxUnread - beforeInboxUnread;
      try {
        const { showNewMailNotification, setBadgeCount } = await import('../lib/notifications');
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
      } catch (notifErr) {
        console.warn('[syncEmails] notification error (ignored):', notifErr);
      }
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

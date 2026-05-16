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
  replaceFilterRules,
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
    const SKIP = /Trash|ゴミ箱|Deleted|Spam|Junk|迷惑|Draft|下書き|Outbox|allmail|all mail|すべてのメール|重要|Important/i;
    const targets = folders.length > 0
      ? folders.filter(f => !SKIP.test(f.path)).map(f => f.path)
      : ['INBOX'];
    const ordered = ['INBOX', ...targets.filter(p => p !== 'INBOX')];

    // --- Macからフィルタールールを同期（IMAP経由） ---
    try {
      const { rules } = await mailApi.filterPull(account, password);
      if (rules && rules.length > 0) {
        await replaceFilterRules(accountId, rules);
        console.log(`[filterSync] pulled ${rules.length} rules from IMAP`);
      }
    } catch (syncErr) {
      console.warn('[filterSync] pull failed (ignored):', (syncErr as Error).message);
    }

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

        // フラグ同期 + EXPUNGE検出
        // ローカルの最小UIDからサーバーへ問い合わせ → 全ローカルEmailを確実にカバー
        try {
          const localEntries = await getUidsForFolder(accountId, folder);
          if (localEntries.length > 0) {
            const localUids = localEntries.map(e => e.uid);
            const minUid = Math.min(...localUids);
            const localUidSet = new Set(localUids);

            // minUid-1 をsinceUidにすることで「minUid以降のUID全件」をサーバーから取得
            const { emails: serverEmails } = await mailApi.sync(
              account, password, folder, minUid - 1, 1000,
            );
            const serverUidSet = new Set(serverEmails.map(e => e.uid));

            // 既読・スターフラグをサーバーに合わせて更新
            let readChanged = 0;
            for (const se of serverEmails) {
              const local = localEntries.find(e => e.uid === se.uid);
              if (local && (local.isRead !== se.isRead || local.isStarred !== se.isStarred)) {
                await updateEmailFlags(local.id, se.isRead, se.isStarred);
                if (local.isRead !== se.isRead) readChanged++;
              }
            }

            // ローカルにあってサーバーにないUID = 移動・削除済み
            const expungedUids = localUids.filter(u => !serverUidSet.has(u));
            console.log(`[flags] ${folder}: local=${localEntries.length} server=${serverEmails.length} expunged=${expungedUids.length} readChanged=${readChanged}`);
            if (expungedUids.length > 0 && serverEmails.length > 0) {
              await removeExpungedEmails(accountId, folder, [...serverUidSet]);
            }
          }
        } catch (flagErr) {
          console.warn(`[syncAllFolders] expunge ${folder}:`, (flagErr as Error).message);
        }

        // 現在表示中のフォルダなら画面も更新（毎回最新のselectedFolderを参照）
        if (folder === get().selectedFolder) {
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

      // Reload from DB（同期完了時点で同じフォルダを表示中の場合のみ更新）
      const allEmails = await listEmails(accountId, folder);
      if (folder === get().selectedFolder) {
        set({ emails: allEmails });
      }

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

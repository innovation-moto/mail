import { create } from 'zustand';
import type { Email, Folder, ThreadSummary } from '@/shared/types';
import { mailApi } from '../lib/api';

import {
  listEmails,
  listThreads,
  getThreadEmails,
  upsertEmail,
  markRead,
  markStar,
  markDeleted,
  getMaxUid,
  getEmailCountForFolder,
  getUnreadCountsByFolder,
  getTotalUnreadDistinct,
  applyFilterRules,
  getUidsForFolder,
  updateEmailFlags,
  removeExpungedEmails,
  replaceFilterRules,
  applyFolderState,
  deduplicateInboxByMessageId,
} from '../lib/db';
import { useAccountStore } from './accountStore';
// notifications は動的インポートで読み込む（モジュールクラッシュ対策）

// INBOXはIMAPのSTATUS値を下回らないよう保護しながらcountsをマージ
function mergeUnreadCounts(
  current: Record<string, number>,
  next: Record<string, number>,
): Record<string, number> {
  const inboxImap = current['INBOX'] ?? 0;
  const inboxLocal = next['INBOX'] ?? 0;
  return { ...next, INBOX: Math.max(inboxImap, inboxLocal) };
}

interface MailStore {
  emails: Email[];
  threads: ThreadSummary[];
  selectedThreadId: string | null;
  threadEmails: Email[];
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
  loadThreads(accountId: string, folder: string): Promise<void>;
  selectThread(accountId: string, threadId: string, folder: string): Promise<void>;
  syncEmails(accountId: string, folder: string): Promise<void>;
  syncAllFolders(accountId: string): Promise<void>;
  refreshUnreadCounts(accountId: string): Promise<void>;

  markRead(id: string, uid: number, folder: string): Promise<void>;
  starEmail(id: string, uid: number, folder: string, isStarred: boolean): Promise<void>;
  deleteEmail(id: string, uid: number, folder: string): Promise<void>;
}

export const useMailStore = create<MailStore>((set, get) => ({
  emails: [],
  threads: [],
  selectedThreadId: null,
  threadEmails: [],
  folders: [],
  folderUnreadCounts: {},
  selectedEmailId: null,
  selectedFolder: 'INBOX',
  loading: false,
  syncing: false,
  foldersLoading: false,
  error: null,

  setFolder(folder: string) {
    set({ selectedFolder: folder, selectedEmailId: null, emails: [], threads: [] });
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
      set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.folderUnreadCounts, counts) }));
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
    const SKIP = /Trash|ゴミ箱|Deleted|Spam|Junk|迷惑|Draft|下書き|Outbox|allmail|all mail|すべてのメール|重要|Important|IM-Mail-Config/i;
    // 全フォルダ同期（システムフォルダを除く）
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

    // --- Macのフォルダ状態を同期（移動済みメールをINBOXから退避） ---
    try {
      const { state } = await mailApi.folderStatePull(account, password);
      if (state && Object.keys(state).length > 0) {
        const moved = await applyFolderState(accountId, state);
        console.log(`[folderState] applied ${moved} folder moves from Mac state`);
      }
    } catch (stateErr) {
      console.warn('[folderState] pull failed (ignored):', (stateErr as Error).message);
    }

    const beforeCounts = await getUnreadCountsByFolder(accountId);
    const beforeInboxUnread = beforeCounts['INBOX'] ?? 0;

    for (const folder of ordered) {
      try {
        const sinceUid = await getMaxUid(accountId, folder);
        const localCount = await getEmailCountForFolder(accountId, folder);
        // ローカルが少ない（≤50件）INBOXは多めに取得してPC側に近いバッジ数にする
        const initialLimit = (folder === 'INBOX' && localCount <= 50) ? 150 : 50;
        let syncResult: { emails: import('@/shared/types').Email[] };
        try {
          syncResult = await mailApi.sync(account, password, folder, sinceUid || undefined, initialLimit);
        } catch {
          // sinceUidが実際のIMAPのUID空間と合わない場合（DBにINBOX UIDが混在など）、
          // 全件取り直しにフォールバック
          syncResult = await mailApi.sync(account, password, folder, undefined, initialLimit);
        }
        const { emails } = syncResult;

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
          const localUids = localEntries.map(e => e.uid);
          const minUid = localUids.length > 0 ? Math.min(...localUids) : undefined;

          // minUidがあればそこから、なければ全件取得
          const { emails: serverEmails } = await mailApi.sync(
            account, password, folder, minUid !== undefined ? minUid - 1 : undefined, 1000,
          );
          const serverUidSet = new Set(serverEmails.map(e => e.uid));

          // 既読・スターフラグ更新 + サーバーにあってローカルにない新規メール追加
          let readChanged = 0;
          let newAdded = 0;
          for (const se of serverEmails) {
            const local = localEntries.find(e => e.uid === se.uid);
            if (local && (local.isRead !== se.isRead || local.isStarred !== se.isStarred)) {
              await updateEmailFlags(local.id, se.isRead, se.isStarred);
              if (local.isRead !== se.isRead) readChanged++;
            } else if (!local) {
              await upsertEmail({ ...se, accountId });
              newAdded++;
            }
          }

          // ローカルにあってサーバーにないUID = 移動・削除済み
          const expungedUids = localUids.filter(u => !serverUidSet.has(u));
          console.log(`[flags] ${folder}: local=${localEntries.length} server=${serverEmails.length} expunged=${expungedUids.length} readChanged=${readChanged} newAdded=${newAdded}`);
          if (expungedUids.length > 0 && serverEmails.length > 0) {
            await removeExpungedEmails(accountId, folder, [...serverUidSet]);
          }
        } catch (flagErr) {
          console.warn(`[syncAllFolders] expunge ${folder}:`, (flagErr as Error).message);
        }

        // 現在表示中のフォルダなら画面も更新（毎回最新のselectedFolderを参照）
        if (folder === get().selectedFolder) {
          const visibleEmails = await listEmails(accountId, folder);
          set({ emails: visibleEmails });
          const visibleThreads = await listThreads(accountId, folder);
          set({ threads: visibleThreads });
        }
      } catch (e) {
        console.warn(`[syncAllFolders] ${folder}:`, (e as Error).message);
      }
    }

    // 全フォルダ同期後：同じメールがINBOXと他フォルダに重複している場合を排除
    // （GmailラベルはIMAPで複数フォルダに同じメールが現れる）
    try {
      const dupes = await deduplicateInboxByMessageId(accountId);
      if (dupes > 0) {
        console.log(`[dedup] removed ${dupes} duplicate INBOX emails (Gmail label dedup)`);
        // 表示中フォルダがINBOXなら再読み込み
        if (get().selectedFolder === 'INBOX') {
          const visibleEmails = await listEmails(accountId, 'INBOX');
          set({ emails: visibleEmails });
          const visibleThreads = await listThreads(accountId, 'INBOX');
          set({ threads: visibleThreads });
        }
      }
    } catch (dedupErr) {
      console.warn('[dedup] error (ignored):', (dedupErr as Error).message);
    }

    // 全フォルダ完了後に未読数・バッジをまとめて更新
    const counts = await getUnreadCountsByFolder(accountId);
    // INBOXはIMAPのSTATUS値（loadFoldersが設定）を下回らないよう保護
    const currentInbox = get().folderUnreadCounts['INBOX'] ?? 0;
    if (currentInbox > (counts['INBOX'] ?? 0)) {
      counts['INBOX'] = currentInbox;
    }
    set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.folderUnreadCounts, counts) }));

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
      const totalUnread = await getTotalUnreadDistinct(accountId);
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
      // IMAPから取得したINBOXの実際の未読数でバッジを上書き（ローカルDB未同期分を補完）
      const inbox = folders.find(f => f.path === 'INBOX');
      if (inbox && inbox.unreadCount > 0) {
        set(s => ({
          folderUnreadCounts: { ...s.folderUnreadCounts, INBOX: inbox.unreadCount },
        }));
      }
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

  async loadThreads(accountId: string, folder: string) {
    set({ loading: true, error: null });
    try {
      const threads = await listThreads(accountId, folder);
      set({ threads });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  async selectThread(accountId: string, threadId: string, folder: string) {
    set({ selectedThreadId: threadId });
    try {
      const emails = await getThreadEmails(accountId, threadId, folder);
      set({ threadEmails: emails });

      // スレッド内の未読メールを全て既読にする
      const accountStore = useAccountStore.getState();
      const account = accountStore.accounts.find((a) => a.id === accountId);
      const password = account ? await accountStore.getPassword(accountId) : null;

      for (const email of emails) {
        if (!email.isRead) {
          await markRead(email.id, true);
          if (account && password) {
            mailApi.action(account, password, email.folder || folder, email.uid, 'markRead').catch(() => {});
          }
        }
      }

      // 未読数・バッジを更新
      const counts = await getUnreadCountsByFolder(accountId);
      set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.folderUnreadCounts, counts) }));
      try {
        const { setBadgeCount } = await import('../lib/notifications');
        const totalUnread = await getTotalUnreadDistinct(accountId);
        await setBadgeCount(totalUnread);
      } catch {}

      // スレッド一覧の未読カウントも更新
      const threads = await listThreads(accountId, folder);
      set({ threads });
    } catch (err) {
      console.warn('[selectThread]', (err as Error).message);
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
        const updatedThreads = await listThreads(accountId, folder);
        set({ threads: updatedThreads });
      }

      // フォルダ別未読数を更新
      const counts = await getUnreadCountsByFolder(accountId);
      set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.folderUnreadCounts, counts) }));

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
        const totalUnread = await getTotalUnreadDistinct(account.id);
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
    set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.folderUnreadCounts, counts) }));
    try {
      const { setBadgeCount } = await import('../lib/notifications');
      const totalUnread = await getTotalUnreadDistinct(account.id);
      await setBadgeCount(totalUnread);
    } catch {}

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

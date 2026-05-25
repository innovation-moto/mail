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

// 一時的な接続エラーはUIに表示しない（自動リトライで回復するため）
function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('unexpected close') ||
    msg.includes('connection closed') ||
    msg.includes('connection refused') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('network request failed') ||
    msg.includes('socket hang up')
  );
}

// INBOXはIMAPのSTATUS値（imapInboxCount）を下回らないよう保護しながらcountsをマージ
function mergeUnreadCounts(
  imapInboxCount: number,
  next: Record<string, number>,
): Record<string, number> {
  const inboxLocal = next['INBOX'] ?? 0;
  return { ...next, INBOX: Math.max(imapInboxCount, inboxLocal) };
}

interface MailStore {
  emails: Email[];
  threads: ThreadSummary[];
  selectedThreadId: string | null;
  threadEmails: Email[];
  folders: Folder[];
  folderUnreadCounts: Record<string, number>;
  imapInboxCount: number;
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

  reapplyFiltersNow(accountId: string): Promise<number>;
  markRead(id: string, uid: number, folder: string): Promise<void>;
  starEmail(id: string, uid: number, folder: string, isStarred: boolean): Promise<void>;
  deleteEmail(id: string, uid: number, folder: string): Promise<void>;
  deleteThread(accountId: string, threadId: string, folder: string): Promise<void>;
  moveThread(accountId: string, threadId: string, folder: string, targetFolder: string): Promise<void>;
}

// ゴミ箱フォルダ判定（specialUse または パスパターン）
function isTrashFolder(folder: string, folders: import('@/shared/types').Folder[]): boolean {
  const trashPath = folders.find(f => f.specialUse === '\\Trash')?.path;
  if (trashPath && folder === trashPath) return true;
  return /^(Trash|ゴミ箱|Deleted Items?|Deleted)$/i.test(folder);
}

const syncingAccounts = new Set<string>();
const syncingFolders = new Set<string>();   // syncEmails の重複実行防止
let lastFullSyncAt = 0;                     // フォアグラウンド復帰時のクールダウン用
let fullSyncCycle = 0;                      // フラグ同期を間引くカウンター
let lastFilterPullAt = 0;                   // filterPull を30分に1回に間引く
let lastFolderStatePullAt = 0;              // folderStatePull を30分に1回に間引く

export const useMailStore = create<MailStore>((set, get) => ({
  emails: [],
  threads: [],
  selectedThreadId: null,
  threadEmails: [],
  folders: [],
  folderUnreadCounts: {},
  imapInboxCount: 0,
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
      set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.imapInboxCount, counts) }));
    } catch {}
  },

  // バックグラウンドで全フォルダを同期（画面・emails状態は一切書き換えない）
  async syncAllFolders(accountId: string) {
    if (syncingAccounts.has(accountId)) return;
    // フォアグラウンド復帰時の連続呼び出しを防ぐ（60秒以内は skip）
    // ただしフォルダが空の場合は必ず実行（初回・フォルダ取得失敗後の回復）
    const now = Date.now();
    if (get().folders.length > 0 && now - lastFullSyncAt < 60_000) return;
    lastFullSyncAt = now;
    fullSyncCycle++;
    syncingAccounts.add(accountId);

    const accountStore = useAccountStore.getState();
    const account = accountStore.accounts.find((a) => a.id === accountId);
    if (!account) { syncingAccounts.delete(accountId); return; }
    const password = await accountStore.getPassword(accountId);
    if (!password) { syncingAccounts.delete(accountId); return; }

    try {
    const { selectedFolder } = get();
    const SKIP = /Trash|ゴミ箱|Deleted|Spam|Junk|迷惑|Draft|下書き|Outbox|allmail|all mail|すべてのメール|重要|Important|IM-Mail-Config/i;

    // フォルダ一覧を毎回取得・更新（新規カスタムフォルダの反映のため）
    let storefolders = get().folders;
    try {
      const fetched = await mailApi.folders(account, password);
      if (fetched.length > 0) {
        storefolders = fetched;
        if (accountId === useAccountStore.getState().selectedAccountId) {
          set({ folders: fetched });
        }
      }
    } catch (folderErr) {
      console.warn('[syncAllFolders] folder fetch failed:', (folderErr as Error).message);
    }

    // 全フォルダ同期（システムフォルダを除く）
    const targets = storefolders.length > 0
      ? storefolders.filter(f => !SKIP.test(f.path)).map(f => f.path)
      : ['INBOX'];
    const ordered = ['INBOX', ...targets.filter(p => p !== 'INBOX')];

    // --- Macからフィルタールールを同期（IMAP経由）--- 30分に1回だけ実行 ---
    const nowForPull = Date.now();
    if (nowForPull - lastFilterPullAt >= 30 * 60_000) {
      lastFilterPullAt = nowForPull;
      try {
        const { rules } = await mailApi.filterPull(account, password);
        if (rules && rules.length > 0) {
          await replaceFilterRules(accountId, rules);
          console.log(`[filterSync] pulled ${rules.length} rules from IMAP`);
        }
      } catch (syncErr) {
        console.warn('[filterSync] pull failed (ignored):', (syncErr as Error).message);
      }
    }

    // --- Macのフォルダ状態を同期（移動済みメールをINBOXから退避）--- 30分に1回だけ実行 ---
    if (nowForPull - lastFolderStatePullAt >= 30 * 60_000) {
      lastFolderStatePullAt = nowForPull;
      try {
        const { state } = await mailApi.folderStatePull(account, password);
        if (state && Object.keys(state).length > 0) {
          const moved = await applyFolderState(accountId, state);
          console.log(`[folderState] applied ${moved} folder moves from Mac state`);
        }
      } catch (stateErr) {
        console.warn('[folderState] pull failed (ignored):', (stateErr as Error).message);
      }
    }

    const beforeCounts = await getUnreadCountsByFolder(accountId);
    const beforeInboxUnread = beforeCounts['INBOX'] ?? 0;

    for (const folder of ordered) {
      try {
        const sinceUid = await getMaxUid(accountId, folder);
        const localCount = await getEmailCountForFolder(accountId, folder);

        // INBOXのローカル件数が少ない場合、全件範囲で150件を先に取得（歴史的未読を補完）
        if (folder === 'INBOX' && localCount <= 60) {
          try {
            const { emails: bulk } = await mailApi.sync(account, password, folder, undefined, 150);
            for (const email of bulk) {
              await upsertEmail({ ...email, accountId });
            }
          } catch {}
        }

        let syncResult: { emails: import('@/shared/types').Email[] };
        try {
          syncResult = await mailApi.sync(account, password, folder, sinceUid || undefined);
        } catch {
          // sinceUidが実際のIMAPのUID空間と合わない場合（DBにINBOX UIDが混在など）、
          // 全件取り直しにフォールバック
          syncResult = await mailApi.sync(account, password, folder, undefined);
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

        // フラグ同期 + EXPUNGE検出（3サイクルに1回 = 約15分ごと）
        // syncFlags は UID+フラグのみ取得（本文なし）なので sync より大幅に軽量
        if (fullSyncCycle % 3 === 0) try {
          const localEntries = await getUidsForFolder(accountId, folder);
          if (localEntries.length === 0) continue; // eslint-disable-line no-continue

          // UID一覧のみ送信 → サーバーはフラグのみ返す（本文・件名なし）
          const localUids = localEntries.map(e => e.uid);
          const { flags: serverFlags, existingUids } = await mailApi.syncFlags(
            account, password, folder, localUids,
          );
          const serverUidSet = new Set(existingUids);

          // 既読・スターフラグ更新
          let readChanged = 0;
          for (const sf of serverFlags) {
            const local = localEntries.find(e => e.uid === sf.uid);
            if (local && (local.isRead !== sf.isRead || local.isStarred !== sf.isStarred)) {
              await updateEmailFlags(local.id, sf.isRead, sf.isStarred);
              if (local.isRead !== sf.isRead) readChanged++;
            }
          }

          // ローカルにあってサーバーにないUID = 移動・削除済み
          const expungedUids = localUids.filter(u => !serverUidSet.has(u));
          console.log(`[flags] ${folder}: local=${localEntries.length} server=${existingUids.length} expunged=${expungedUids.length} readChanged=${readChanged}`);
          if (expungedUids.length > 0 && existingUids.length > 0) {
            await removeExpungedEmails(accountId, folder, existingUids);
          }
        } catch (flagErr) {
          console.warn(`[syncAllFolders] flags ${folder}:`, (flagErr as Error).message);
        }

        // 現在表示中のアカウント・フォルダなら画面も更新
        const currentSelectedAccountId = useAccountStore.getState().selectedAccountId;
        if (folder === get().selectedFolder && accountId === currentSelectedAccountId) {
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
        // 表示中アカウント・フォルダがINBOXなら再読み込み
        const currentSelectedAccountId2 = useAccountStore.getState().selectedAccountId;
        if (get().selectedFolder === 'INBOX' && accountId === currentSelectedAccountId2) {
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
    set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.imapInboxCount, counts) }));

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

    } finally {
      syncingAccounts.delete(accountId);
    }
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
      console.log('[loadFolders] fetched', folders.length, 'folders:', folders.map(f => f.path).join(', '));
      // 取得完了時点で別アカウントに切り替わっていたら上書きしない
      if (useAccountStore.getState().selectedAccountId === accountId) {
        set({ folders });
        console.log('[loadFolders] applied to store');
      } else {
        console.warn('[loadFolders] account switched, skipped');
      }
      const inbox = folders.find(f => f.path === 'INBOX');
      if (inbox && inbox.unreadCount > 0) {
        set(s => ({
          imapInboxCount: inbox.unreadCount,
          folderUnreadCounts: { ...s.folderUnreadCounts, INBOX: inbox.unreadCount },
        }));
      }
    } catch (err) {
      console.warn('[loadFolders] error:', (err as Error).message);
    } finally {
      set({ foldersLoading: false });
    }
  },

  async loadEmails(accountId: string, folder: string) {
    set({ loading: true, error: null });
    try {
      const trash = isTrashFolder(folder, get().folders);
      const emails = await listEmails(accountId, folder, 100, 0, trash);
      set({ emails });
    } catch (err) {
      if (!isTransientError(err)) set({ error: (err as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  async loadThreads(accountId: string, folder: string) {
    set({ loading: true, error: null });
    try {
      const trash = isTrashFolder(folder, get().folders);
      const threads = await listThreads(accountId, folder, 50, 0, trash);
      set({ threads });
    } catch (err) {
      if (!isTransientError(err)) set({ error: (err as Error).message });
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
      set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.imapInboxCount, counts) }));
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
    const key = `${accountId}:${folder}`;
    if (syncingFolders.has(key)) return;
    syncingFolders.add(key);

    const accountStore = useAccountStore.getState();
    const account = accountStore.accounts.find((a) => a.id === accountId);
    if (!account) { syncingFolders.delete(key); return; }

    const password = await accountStore.getPassword(accountId);
    if (!password) { syncingFolders.delete(key); return; }

    // ゴミ箱・送信済み等は実際のIMAPフォルダパスに解決（Trash→Deleted Items 等）
    const SPECIAL_USE_MAP: Record<string, string> = {
      Trash: '\\Trash', ゴミ箱: '\\Trash', Deleted: '\\Trash',
      Sent: '\\Sent', 送信済み: '\\Sent', 'Sent Items': '\\Sent',
      Draft: '\\Drafts', 下書き: '\\Drafts',
    };
    const specialUse = Object.entries(SPECIAL_USE_MAP).find(([k]) =>
      new RegExp(`^${k}$`, 'i').test(folder)
    )?.[1];
    const imapFolder = specialUse
      ? (get().folders.find(f => f.specialUse === specialUse)?.path ?? folder)
      : folder;

    set({ syncing: true, error: null });
    try {
      // ゴミ箱等は常に最新50件を取得（UID追跡せず）、それ以外はインクリメンタル同期
      const sinceUid = specialUse ? undefined : (await getMaxUid(accountId, folder) || undefined);
      const { emails } = await mailApi.sync(account, password, imapFolder, sinceUid);

      // 同期前の未読数を記録（新着検知用）
      const beforeCounts = await getUnreadCountsByFolder(accountId);
      const beforeInboxUnread = beforeCounts['INBOX'] ?? 0;

      // Persist to SQLite（ゴミ箱等は表示フォルダ名に正規化して保存）
      for (const email of emails) {
        await upsertEmail({ ...email, folder, accountId });
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

      // Reload from DB（同期完了時点で同じアカウント・フォルダを表示中の場合のみ更新）
      const trash = isTrashFolder(folder, get().folders);
      const allEmails = await listEmails(accountId, folder, 100, 0, trash);
      const currentSelectedAccountId = useAccountStore.getState().selectedAccountId;
      if (folder === get().selectedFolder && accountId === currentSelectedAccountId) {
        set({ emails: allEmails });
        const updatedThreads = await listThreads(accountId, folder, 50, 0, trash);
        set({ threads: updatedThreads });
      }

      // フォルダ別未読数を更新
      const counts = await getUnreadCountsByFolder(accountId);
      set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.imapInboxCount, counts) }));

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
      if (!isTransientError(err)) {
        set({ error: (err as Error).message });
      }
    } finally {
      set({ syncing: false });
      syncingFolders.delete(`${accountId}:${folder}`);
    }
  },

  async reapplyFiltersNow(accountId: string): Promise<number> {
    const accountStore = useAccountStore.getState();
    const account = accountStore.accounts.find(a => a.id === accountId);
    if (!account) return 0;
    const password = await accountStore.getPassword(accountId);
    if (!password) return 0;

    // 最新のフィルタールールをMacから取得
    try {
      const { rules } = await mailApi.filterPull(account, password);
      if (rules && rules.length > 0) {
        await replaceFilterRules(accountId, rules);
      }
    } catch {}

    // 全ローカルメールにフィルターを適用
    const matches = await applyFilterRules(accountId);
    for (const m of matches) {
      if (m.toFolder && m.toFolder !== m.fromFolder) {
        try {
          await mailApi.action(account, password, m.fromFolder, m.uid, 'move', m.toFolder);
        } catch {}
      }
      if (m.markRead) mailApi.action(account, password, m.fromFolder, m.uid, 'markRead').catch(() => {});
      if (m.starred) mailApi.action(account, password, m.fromFolder, m.uid, 'star').catch(() => {});
    }

    // 表示を更新
    const folder = get().selectedFolder;
    const allEmails = await listEmails(accountId, folder);
    set({ emails: allEmails });
    const updatedThreads = await listThreads(accountId, folder);
    set({ threads: updatedThreads });

    return matches.filter(m => m.toFolder && m.toFolder !== m.fromFolder).length;
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
    set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.imapInboxCount, counts) }));
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

    // 削除前に未読かどうか確認
    const target = get().emails.find((e) => e.id === id);
    const wasUnread = target ? !target.isRead : false;

    set((state) => ({
      emails: state.emails.filter((e) => e.id !== id),
    }));

    // バッジを楽観的に即更新（imapInboxCountも同時に減らさないとmergeで戻される）
    if (wasUnread) {
      set((s) => {
        const newFolder = Math.max(0, (s.folderUnreadCounts[folder] ?? 0) - 1);
        const newImap   = folder === 'INBOX' ? Math.max(0, s.imapInboxCount - 1) : s.imapInboxCount;
        const newCounts = { ...s.folderUnreadCounts, [folder]: newFolder };
        return { folderUnreadCounts: newCounts, imapInboxCount: newImap };
      });
      const total = Object.values(get().folderUnreadCounts).reduce((a, b) => a + b, 0);
      import('../lib/notifications').then(({ setBadgeCount }) => setBadgeCount(Math.max(0, total))).catch(() => {});
    }

    // DB・IMAP はバックグラウンドで処理
    const trashPath = get().folders.find(f => f.specialUse === '\\Trash')?.path;
    markDeleted(id).then(async () => {
      const password = await accountStore.getPassword(account.id);
      if (password) {
        mailApi.action(account, password, folder, uid, 'delete', trashPath).catch(() => {});
      }
      // DB確定後に正確な値で再同期
      const counts = await getUnreadCountsByFolder(account.id);
      set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.imapInboxCount, counts) }));
      const { setBadgeCount } = await import('../lib/notifications');
      const totalUnread = await getTotalUnreadDistinct(account.id);
      setBadgeCount(totalUnread).catch(() => {});
    }).catch(() => {});
  },

  async deleteThread(accountId: string, threadId: string, folder: string) {
    const accountStore = useAccountStore.getState();
    const accounts = accountStore.accounts;
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    // stateのemailsからthreadIdで絞り込む（DBのfolder条件不一致を回避）
    const stateEmails = get().emails.filter(
      e => (e.threadId || e.id) === threadId,
    );
    // stateにない場合はDBから取得（folder条件なし）
    const threadEmails = stateEmails.length > 0
      ? stateEmails
      : await getThreadEmails(accountId, threadId, folder);

    // スレッドの未読数を把握
    const thread = get().threads.find((t) => t.threadId === threadId);
    const unreadDelta = thread?.unreadCount ?? threadEmails.filter((e) => !e.isRead).length;

    set((state) => ({
      emails: state.emails.filter((e) => (e.threadId || e.id) !== threadId),
      threads: state.threads.filter((t) => t.threadId !== threadId),
    }));

    // バッジを楽観的に即更新（imapInboxCountも同時に減らさないとmergeで戻される）
    if (unreadDelta > 0) {
      set((s) => {
        const newFolder = Math.max(0, (s.folderUnreadCounts[folder] ?? 0) - unreadDelta);
        const newImap   = folder === 'INBOX' ? Math.max(0, s.imapInboxCount - unreadDelta) : s.imapInboxCount;
        const newCounts = { ...s.folderUnreadCounts, [folder]: newFolder };
        return { folderUnreadCounts: newCounts, imapInboxCount: newImap };
      });
      const total = Object.values(get().folderUnreadCounts).reduce((a, b) => a + b, 0);
      import('../lib/notifications').then(({ setBadgeCount }) => setBadgeCount(Math.max(0, total))).catch(() => {});
    }

    // DB・IMAP はバックグラウンドで処理
    const trashPath = get().folders.find(f => f.specialUse === '\\Trash')?.path;
    (async () => {
      const password = await accountStore.getPassword(accountId);
      for (const email of threadEmails) {
        await markDeleted(email.id);
        if (password) {
          mailApi.action(account, password, email.folder || folder, email.uid, 'delete', trashPath).catch(() => {});
        }
      }
      // DB確定後に正確な値で再同期
      const counts = await getUnreadCountsByFolder(accountId);
      set((s) => ({ folderUnreadCounts: mergeUnreadCounts(s.imapInboxCount, counts) }));
      const { setBadgeCount } = await import('../lib/notifications');
      const totalUnread = await getTotalUnreadDistinct(accountId);
      setBadgeCount(totalUnread).catch(() => {});
    })().catch(() => {});
  },

  async moveThread(accountId: string, threadId: string, folder: string, targetFolder: string) {
    const accountStore = useAccountStore.getState();
    const accounts = accountStore.accounts;
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    const stateEmails = get().emails.filter(
      e => (e.threadId || e.id) === threadId,
    );
    const threadEmails = stateEmails.length > 0
      ? stateEmails
      : await getThreadEmails(accountId, threadId, folder);

    set((state) => ({
      emails: state.emails.filter((e) => (e.threadId || e.id) !== threadId),
      threads: state.threads.filter((t) => t.threadId !== threadId),
    }));

    const password = await accountStore.getPassword(accountId);
    for (const email of threadEmails) {
      if (password) {
        mailApi.action(account, password, email.folder || folder, email.uid, 'move', targetFolder).catch(() => {});
      }
    }
  },
}));

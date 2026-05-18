'use client';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { api, isElectron } from '@/lib/ipc';
import { Sidebar } from './Sidebar';
import { MailList } from '../mail/MailList';
import { MailView } from '../mail/MailView';
import { ComposeModal } from '../mail/ComposeModal';
import { AccountSetupModal } from '../settings/AccountSetupModal';
import { SettingsModal } from '../settings/SettingsModal';
import { SetupWizard } from '../settings/SetupWizard';
import { cn } from '@/lib/utils';

export function AppShell() {
  const { accounts, loadAccounts, selectedAccountId } = useAccountStore();
  const { loadThreads, loadFolders, syncEmails, loadUnreadCounts, setUnreadCounts, selectedThreadId, selectedEmailId } = useMailStore();
  const { theme, modal, applyTheme, mobilePanel, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        // Web版：未ログインならログインページへ
        if (!isElectron) {
          const { supabase } = await import('@/lib/supabase');
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            window.location.href = '/login';
            return;
          }
        }

        // Apply saved theme
        const settings = await api.settings.get();
        applyTheme(settings.theme as 'light' | 'dark' | 'system');
        useUIStore.setState({ theme: settings.theme as 'light' | 'dark' | 'system' });

        await loadAccounts();
      } catch (err) {
        console.error('Init failed:', err);
      } finally {
        setInitialized(true);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    loadFolders(selectedAccountId);
    // まずDBからスレッド一覧を即座に表示
    loadThreads(selectedAccountId, 'INBOX').then(() => {
      // その後バックグラウンドでIMAPと同期
      syncEmails(selectedAccountId).catch(() => {});
    });
  }, [selectedAccountId]);

  // mail:synced イベント：バックグラウンド同期完了時に即座に未読数・メール一覧を更新
  useEffect(() => {
    if (!isElectron) return;
    const unsubscribe = api.on('mail:synced', (data: unknown) => {
      const { accountId, unreadCounts } = data as { accountId: string; added: number; unreadCounts: Record<string, number> };
      const currentAccountId = useAccountStore.getState().selectedAccountId;
      if (accountId !== currentAccountId) return;
      console.log('[mail:synced] received, unreadCounts:', unreadCounts);
      setUnreadCounts(unreadCounts);
      // 現在のフォルダのスレッド一覧も静かに更新（選択中スレッドはリセットしない）
      const selectedFolder = useMailStore.getState().selectedFolder;
      loadThreads(accountId, selectedFolder, true).catch(() => {});
    });
    return () => { unsubscribe?.(); };
  }, []);

  // ポーリング：30秒ごとに未読数・現在フォルダを更新（IPC イベントが届かない場合のフォールバック）
  useEffect(() => {
    if (!selectedAccountId) return;
    const timer = setInterval(async () => {
      console.log('[poll] loadUnreadCounts start, accountId:', selectedAccountId);
      await loadUnreadCounts(selectedAccountId);
      const counts = useMailStore.getState().folderUnreadCounts;
      console.log('[poll] folderUnreadCounts:', counts);
      const selectedFolder = useMailStore.getState().selectedFolder;
      loadThreads(selectedAccountId, selectedFolder, true).catch(() => {});
    }, 30 * 1000);
    return () => clearInterval(timer);
  }, [selectedAccountId]);

  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return <SetupWizard />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-900 relative">
      {/* モバイル：サイドバーのバックドロップ */}
      {mobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* デスクトップ：常に表示されるサイドバー */}
      <div className="hidden md:flex flex-shrink-0">
        <Sidebar />
      </div>

      {/* モバイル：ドロワーサイドバー */}
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-y-0 left-0 z-50 flex shadow-2xl">
          <Sidebar onMobileClose={() => setMobileSidebarOpen(false)} />
        </div>
      )}

      {/* メールリストパネル（モバイルは1画面ずつ） */}
      <div className={cn(
        'flex-col',
        mobilePanel === 'list' ? 'flex' : 'hidden',
        'md:flex',
      )}>
        <MailList />
      </div>

      {/* メール本文パネル（モバイルは1画面ずつ） */}
      <div className={cn(
        'flex-1 flex-col min-w-0',
        mobilePanel === 'mail' ? 'flex' : 'hidden',
        'md:flex',
      )}>
        <MailView />
      </div>

      {/* 新規メール FAB */}
      <button
        onClick={() => useUIStore.getState().openCompose()}
        className={cn('fixed right-6 z-30 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white shadow-lg shadow-blue-500/30 flex items-center justify-center transition-all', (selectedThreadId || selectedEmailId) ? 'bottom-16' : 'bottom-6')}
        title="新規メール"
      >
        <Pencil size={22} />
      </button>

      {modal === 'compose' && <ComposeModal />}
      {modal === 'accountSetup' && <AccountSetupModal />}
      {modal === 'settings' && <SettingsModal />}
    </div>
  );
}

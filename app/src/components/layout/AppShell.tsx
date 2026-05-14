'use client';
import { useEffect, useState } from 'react';
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

export function AppShell() {
  const { accounts, loadAccounts, selectedAccountId } = useAccountStore();
  const { loadEmails, loadFolders, syncEmails, loadUnreadCounts, setUnreadCounts } = useMailStore();
  const { theme, modal, applyTheme, mobilePanel, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const [initialized, setInitialized] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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
    loadUnreadCounts(selectedAccountId);
    // まずDBから即座に表示
    loadEmails(selectedAccountId, 'INBOX').then(() => {
      // その後バックグラウンドでIMAPと同期して最新メールを取得
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
      // 現在のフォルダのメール一覧も静かに更新
      const selectedFolder = useMailStore.getState().selectedFolder;
      loadEmails(accountId, selectedFolder).catch(() => {});
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
      loadEmails(selectedAccountId, undefined);
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
      {!isDesktop && mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* デスクトップ：常に表示されるサイドバー */}
      {isDesktop && (
        <div className="flex flex-shrink-0">
          <Sidebar />
        </div>
      )}

      {/* モバイル：ドロワーサイドバー */}
      {!isDesktop && mobileSidebarOpen && (
        <div className="fixed inset-y-0 left-0 z-50 flex shadow-2xl">
          <Sidebar onMobileClose={() => setMobileSidebarOpen(false)} />
        </div>
      )}

      {/* モバイル：アクティブパネルのみレンダリング */}
      {!isDesktop && mobilePanel === 'list' && (
        <div className="flex flex-col flex-1 min-w-0">
          <MailList />
        </div>
      )}
      {!isDesktop && mobilePanel === 'mail' && (
        <div className="flex flex-col flex-1 min-w-0">
          <MailView />
        </div>
      )}

      {/* デスクトップ：両パネルを並べて表示 */}
      {isDesktop && (
        <>
          <div className="flex flex-col flex-none" style={{ width: '320px' }}>
            <MailList />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <MailView />
          </div>
        </>
      )}

      {modal === 'compose' && <ComposeModal />}
      {modal === 'accountSetup' && <AccountSetupModal />}
      {modal === 'settings' && <SettingsModal />}
    </div>
  );
}

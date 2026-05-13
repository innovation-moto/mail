'use client';
import { useEffect, useState } from 'react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/ipc';
import { Sidebar } from './Sidebar';
import { MailList } from '../mail/MailList';
import { MailView } from '../mail/MailView';
import { ComposeModal } from '../mail/ComposeModal';
import { AccountSetupModal } from '../settings/AccountSetupModal';
import { SettingsModal } from '../settings/SettingsModal';
import { SetupWizard } from '../settings/SetupWizard';

export function AppShell() {
  const { accounts, loadAccounts, selectedAccountId } = useAccountStore();
  const { loadEmails, loadFolders, syncEmails, loadUnreadCounts } = useMailStore();
  const { theme, modal, applyTheme } = useUIStore();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
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

  useEffect(() => {
    // Listen for sync events from main process
    const unsub = api.on('mail:synced', (data: unknown) => {
      const { accountId } = data as { accountId: string };
      if (accountId === selectedAccountId) {
        loadEmails(selectedAccountId, undefined);
      }
    });
    return unsub;
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
    <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-900">
      <Sidebar />
      <MailList />
      <MailView />

      {modal === 'compose' && <ComposeModal />}
      {modal === 'accountSetup' && <AccountSetupModal />}
      {modal === 'settings' && <SettingsModal />}
    </div>
  );
}

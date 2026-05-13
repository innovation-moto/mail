'use client';
import { useEffect } from 'react';
import {
  Inbox, Send, FileText, Trash2, Star, Tag, ChevronDown,
  Plus, Settings, RefreshCw, Search, PanelLeftClose, PanelLeft,
} from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { cn, getInitials, getAvatarColor } from '@/lib/utils';

const SPECIAL_FOLDERS = [
  { path: 'INBOX', name: '受信トレイ', icon: Inbox },
  { path: 'Sent', name: '送信済み', icon: Send },
  { path: 'Drafts', name: '下書き', icon: FileText },
  { path: 'Starred', name: 'スター付き', icon: Star },
  { path: 'Trash', name: 'ゴミ箱', icon: Trash2 },
];

export function Sidebar() {
  const { accounts, selectedAccountId, selectAccount } = useAccountStore();
  const { selectedFolder, folders, selectFolder, syncEmails, syncing, loadEmails } = useMailStore();
  const { openCompose, openSettings, sidebarCollapsed, toggleSidebar } = useUIStore();

  const account = accounts.find((a) => a.id === selectedAccountId);

  async function handleSync() {
    if (!selectedAccountId) return;
    await syncEmails(selectedAccountId);
  }

  return (
    <aside
      className={cn(
        'flex flex-col h-screen border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 transition-all duration-200 flex-shrink-0',
        sidebarCollapsed ? 'w-14' : 'w-60',
      )}
    >
      {/* macOS titlebar drag area */}
      <div className="drag h-8 flex items-center justify-end px-2 flex-shrink-0">
        <button
          onClick={toggleSidebar}
          className="no-drag p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
        >
          {sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* Account switcher */}
      {!sidebarCollapsed && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer">
            {account ? (
              <>
                <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0', getAvatarColor(account.email))}>
                  {getInitials(account.name, account.email)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate dark:text-white">{account.name}</div>
                  <div className="text-xs text-gray-500 truncate">{account.email}</div>
                </div>
                <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
              </>
            ) : (
              <div className="text-sm text-gray-500">アカウントなし</div>
            )}
          </div>

          {/* Account list */}
          {accounts.length > 1 && (
            <div className="mt-1 space-y-0.5">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => selectAccount(a.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
                    selectedAccountId === a.id
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300',
                  )}
                >
                  <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0', getAvatarColor(a.email))}>
                    {getInitials(a.name, a.email)[0]}
                  </div>
                  <span className="truncate">{a.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compose button */}
      <div className={cn('px-3 pb-3', sidebarCollapsed && 'px-2')}>
        <button
          onClick={() => openCompose()}
          className={cn(
            'flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors',
            sidebarCollapsed ? 'w-10 h-10 justify-center' : 'w-full px-4 py-2 text-sm',
          )}
        >
          <Plus size={16} />
          {!sidebarCollapsed && '新規メール'}
        </button>
      </div>

      {/* Folder list */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 space-y-0.5">
        {SPECIAL_FOLDERS.map(({ path, name, icon: Icon }) => (
          <FolderItem
            key={path}
            path={path}
            name={name}
            icon={<Icon size={16} />}
            selected={selectedFolder === path}
            collapsed={sidebarCollapsed}
            onClick={() => {
              selectFolder(path);
              if (selectedAccountId) loadEmails(selectedAccountId, path);
            }}
          />
        ))}

        {/* Custom folders */}
        {folders.length > 0 && !sidebarCollapsed && (
          <>
            <div className="pt-3 pb-1 px-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">フォルダ</span>
            </div>
            {folders
              .filter((f) => !SPECIAL_FOLDERS.some((sf) => sf.path === f.path))
              .map((f) => (
                <FolderItem
                  key={f.path}
                  path={f.path}
                  name={f.name}
                  icon={<Tag size={16} />}
                  selected={selectedFolder === f.path}
                  collapsed={sidebarCollapsed}
                  onClick={() => {
                    selectFolder(f.path);
                    if (selectedAccountId) loadEmails(selectedAccountId, f.path);
                  }}
                />
              ))}
          </>
        )}
      </nav>

      {/* Bottom actions */}
      <div className={cn('px-2 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-1', sidebarCollapsed ? 'flex-col items-center' : 'items-center justify-between')}>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-50"
          title="同期"
        >
          <RefreshCw size={16} className={cn(syncing && 'animate-spin')} />
        </button>
        <button
          onClick={openSettings}
          className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          title="設定"
        >
          <Settings size={16} />
        </button>
      </div>
    </aside>
  );
}

function FolderItem({
  path, name, icon, selected, collapsed, onClick,
}: {
  path: string;
  name: string;
  icon: React.ReactNode;
  selected: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors',
        selected
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800',
        collapsed && 'justify-center px-0',
      )}
      title={collapsed ? name : undefined}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{name}</span>}
    </button>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Inbox, Send, FileText, Trash2, Star, Folder, ChevronDown,
  Plus, Settings, RefreshCw, PanelLeftClose, PanelLeft, GripVertical,
} from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { cn, getInitials, getAvatarColor } from '@/lib/utils';

const SPECIAL_FOLDERS = [
  { path: 'INBOX',   name: '受信トレイ',  icon: Inbox,    color: 'text-blue-500' },
  { path: 'Sent',    name: '送信済み',    icon: Send,     color: 'text-green-500' },
  { path: 'Drafts',  name: '下書き',      icon: FileText, color: 'text-yellow-500' },
  { path: 'Starred', name: 'スター付き',  icon: Star,     color: 'text-orange-400' },
  { path: 'Trash',   name: 'ゴミ箱',      icon: Trash2,   color: 'text-red-400' },
];

const FOLDER_ORDER_KEY = 'mail:folderOrder';

function loadFolderOrder(): string[] {
  try {
    const raw = localStorage.getItem(FOLDER_ORDER_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveFolderOrder(order: string[]) {
  localStorage.setItem(FOLDER_ORDER_KEY, JSON.stringify(order));
}

export function Sidebar() {
  const { accounts, selectedAccountId, selectAccount } = useAccountStore();
  const { selectedFolder, folders, selectFolder, syncEmails, syncing, loadEmails, folderUnreadCounts } = useMailStore();
  const { openCompose, openSettings, sidebarCollapsed, toggleSidebar } = useUIStore();

  const account = accounts.find((a) => a.id === selectedAccountId);

  // 全フォルダ（SPECIAL + カスタム）を結合して順番管理
  const allFolders = [
    ...SPECIAL_FOLDERS.map((f) => ({ ...f, isSpecial: true, iconComponent: f.icon, color: f.color })),
    ...folders
      .filter((f) => !SPECIAL_FOLDERS.some((sf) => sf.path === f.path))
      .map((f) => ({ path: f.path, name: f.name, icon: Folder, iconComponent: Folder, isSpecial: false, color: 'text-indigo-400' })),
  ];

  const [orderedPaths, setOrderedPaths] = useState<string[]>([]);

  useEffect(() => {
    const saved = loadFolderOrder();
    if (saved.length > 0) {
      setOrderedPaths(saved);
    } else {
      setOrderedPaths(allFolders.map((f) => f.path));
    }
  }, [folders.length]);

  // 保存済み順 + 新規フォルダを末尾に追加
  const sortedFolders = [
    ...orderedPaths
      .map((p) => allFolders.find((f) => f.path === p))
      .filter(Boolean),
    ...allFolders.filter((f) => !orderedPaths.includes(f.path)),
  ] as typeof allFolders;

  // ドラッグ状態
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOver(index);
  }

  function handleDrop(index: number) {
    if (dragIndex.current === null || dragIndex.current === index) {
      setDragOver(null);
      return;
    }
    const newOrder = [...sortedFolders.map((f) => f.path)];
    const [moved] = newOrder.splice(dragIndex.current, 1);
    newOrder.splice(index, 0, moved);
    setOrderedPaths(newOrder);
    saveFolderOrder(newOrder);
    dragIndex.current = null;
    setDragOver(null);
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDragOver(null);
  }

  async function handleFolderClick(path: string) {
    if (!selectedAccountId) return;
    selectFolder(path);
    await loadEmails(selectedAccountId, path);
    syncEmails(selectedAccountId).catch(() => {});
  }

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
        {sortedFolders.map((folder, index) => {
          const IconComponent = folder.iconComponent;
          const unread = folderUnreadCounts[folder.path] ?? 0;
          const isDraggingOver = dragOver === index;

          return (
            <div
              key={folder.path}
              draggable={!sidebarCollapsed}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
              className={cn(
                'rounded-lg transition-all',
                isDraggingOver && 'ring-2 ring-blue-400 ring-offset-1 bg-blue-50 dark:bg-blue-900/20',
              )}
            >
              <FolderItem
                path={folder.path}
                name={folder.name}
                icon={<IconComponent size={16} className={folder.color} />}
                selected={selectedFolder === folder.path}
                collapsed={sidebarCollapsed}
                badge={unread > 0 ? unread : undefined}
                syncing={syncing && selectedFolder === folder.path}
                onClick={() => handleFolderClick(folder.path)}
                showDragHandle={!sidebarCollapsed}
              />
            </div>
          );
        })}
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
  path, name, icon, selected, collapsed, badge, syncing, onClick, showDragHandle,
}: {
  path: string;
  name: string;
  icon: React.ReactNode;
  selected: boolean;
  collapsed: boolean;
  badge?: number;
  syncing?: boolean;
  onClick: () => void;
  showDragHandle?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors group',
        selected
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800',
        collapsed && 'justify-center px-0',
      )}
      title={collapsed ? name : undefined}
    >
      {/* ドラッグハンドル */}
      {showDragHandle && (
        <span className={cn(
          'flex-shrink-0 text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing transition-opacity',
          hovered ? 'opacity-100' : 'opacity-0',
        )}>
          <GripVertical size={13} />
        </span>
      )}

      <span className={cn('relative flex-shrink-0 [&>svg]:flex-shrink-0', syncing && 'animate-spin')}>
        {icon}
        {badge !== undefined && collapsed && !syncing && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-blue-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      {!collapsed && <span className="truncate flex-1 text-left">{name}</span>}
      {!collapsed && !syncing && badge !== undefined && (
        <span className="ml-auto min-w-[20px] h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold px-1">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {!collapsed && syncing && (
        <RefreshCw size={12} className="ml-auto text-blue-400 animate-spin flex-shrink-0" />
      )}
    </button>
  );
}

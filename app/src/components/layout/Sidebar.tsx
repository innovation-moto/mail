'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Inbox, Send, FileText, Trash2, Star, Pin, Folder, ChevronDown,
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
  { path: 'Pinned',  name: 'ピン留め',    icon: Pin,      color: 'text-blue-400' },
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
  const { selectedFolder, folders, selectFolder, syncEmails, syncing, loadEmails, folderUnreadCounts, moveEmail } = useMailStore();
  const { openCompose, openSettings, sidebarCollapsed, toggleSidebar } = useUIStore();

  const account = accounts.find((a) => a.id === selectedAccountId);

  // SPECIALフォルダと重複するGmailフォルダを除外するパターン
  const DUPLICATE_PATTERNS = [
    /ゴミ箱/i, /trash/i, /deleted/i,
    /スター/i, /starred/i,
    /送信済み/i, /sent/i,
    /下書き/i, /draft/i,
    /迷惑/i, /spam/i, /junk/i,
    /重要/i, /important/i,
    /すべてのメール/i, /all\s*mail/i,
    /^\[gmail\]$/i,
  ];

  function isDuplicateFolder(path: string, name: string): boolean {
    // SPECIALフォルダのpathと完全一致は除外済みなので、名前・パスパターンで重複を検出
    return DUPLICATE_PATTERNS.some((re) => re.test(path) || re.test(name));
  }

  // 全フォルダ（SPECIAL + カスタム）を結合して順番管理
  const allFolders = [
    ...SPECIAL_FOLDERS.map((f) => ({ ...f, isSpecial: true, iconComponent: f.icon, color: f.color })),
    ...folders
      .filter((f) => !SPECIAL_FOLDERS.some((sf) => sf.path === f.path))
      .filter((f) => !isDuplicateFolder(f.path, f.name))
      .map((f) => ({ path: f.path, name: f.name, icon: Folder, iconComponent: Folder, isSpecial: false, color: 'text-indigo-400' })),
  ];

  const [orderedPaths, setOrderedPaths] = useState<string[]>([]);
  const [accountListOpen, setAccountListOpen] = useState(false);

  useEffect(() => {
    const saved = loadFolderOrder();
    if (saved.length > 0) {
      // 保存済み順に新しいSPECIALフォルダが欠けている場合、正しい位置に挿入する
      const specialPaths = SPECIAL_FOLDERS.map((f) => f.path);
      let order = [...saved];
      for (let i = 0; i < specialPaths.length; i++) {
        if (!order.includes(specialPaths[i])) {
          const prevSpecial = i > 0 ? specialPaths[i - 1] : null;
          const insertAfter = prevSpecial ? order.indexOf(prevSpecial) : -1;
          order.splice(insertAfter + 1, 0, specialPaths[i]);
        }
      }
      setOrderedPaths(order);
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

  // サイドバーに表示されているフォルダのみ合計（非表示フォルダの二重計算を防ぐ）
  const totalUnread = sortedFolders.reduce((sum, f) => sum + (folderUnreadCounts[f.path] ?? 0), 0);

  // ドラッグ状態（フォルダ並び替え用）
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  // メールドロップ用ハイライト
  const [emailDropTarget, setEmailDropTarget] = useState<number | null>(null);

  function isEmailDrag(e: React.DragEvent) {
    return e.dataTransfer.types.includes('application/email-id');
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (isEmailDrag(e)) {
      e.dataTransfer.dropEffect = 'move';
      setEmailDropTarget(index);
    } else {
      setDragOver(index);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    if (isEmailDrag(e)) {
      setEmailDropTarget(null);
    }
  }

  async function handleDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    const emailId = e.dataTransfer.getData('application/email-id');
    if (emailId) {
      // メールをフォルダに移動
      const targetFolder = sortedFolders[index]?.path;
      if (targetFolder) {
        await moveEmail(emailId, targetFolder);
      }
      setEmailDropTarget(null);
      return;
    }
    // フォルダ並び替え
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
    setEmailDropTarget(null);
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
      <div className={cn(
        'drag flex items-center justify-end px-2 flex-shrink-0',
        sidebarCollapsed ? 'h-16 items-end pb-1' : 'h-8',
      )}>
        <button
          onClick={toggleSidebar}
          className="no-drag p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
        >
          {sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* ロゴ */}
      {!sidebarCollapsed && (
        <div className="px-5 py-3 flex-shrink-0">
          <img
            src="logo.png"
            alt="INNOVATION MUSIC"
            className="w-full max-w-[160px] h-auto object-contain dark:hidden"
          />
          <img
            src="logo_white.png"
            alt="INNOVATION MUSIC"
            className="w-full max-w-[160px] h-auto object-contain hidden dark:block"
          />
        </div>
      )}

      {/* Account switcher (collapsed) */}
      {sidebarCollapsed && account && (
        <div className="px-2 pb-2 flex justify-center">
          <div className="relative">
            <div className={cn('w-8 h-8 rounded-full flex-shrink-0 overflow-hidden', !account.avatar && getAvatarColor(account.email))}>
              {account.avatar ? (
                <img src={account.avatar} alt={account.name} className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                  {getInitials(account.name, account.email)}
                </span>
              )}
            </div>
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold leading-none">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Account switcher */}
      {!sidebarCollapsed && (
        <div className="px-3 pb-2">
          <div
            className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer"
            onClick={() => accounts.length > 1 && setAccountListOpen((o) => !o)}
          >
            {account ? (
              <>
                <div className={cn('w-7 h-7 rounded-full flex-shrink-0 overflow-hidden', !account.avatar && getAvatarColor(account.email))}>
                  {account.avatar ? (
                    <img src={account.avatar} alt={account.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                      {getInitials(account.name, account.email)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate dark:text-white">{account.name}</div>
                  <div className="text-xs text-gray-500 truncate">{account.email}</div>
                </div>
                {totalUnread > 0 && (
                  <span className="min-w-[20px] h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold px-1 flex-shrink-0">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
                {accounts.length > 1 && (
                  <ChevronDown
                    size={14}
                    className={cn('text-gray-400 flex-shrink-0 transition-transform', accountListOpen && 'rotate-180')}
                  />
                )}
              </>
            ) : (
              <div className="text-sm text-gray-500">アカウントなし</div>
            )}
          </div>

          {accounts.length > 1 && accountListOpen && (
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
                  <div className={cn('w-5 h-5 rounded-full flex-shrink-0 overflow-hidden', !a.avatar && getAvatarColor(a.email))}>
                    {a.avatar ? (
                      <img src={a.avatar} alt={a.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                        {getInitials(a.name, a.email)[0]}
                      </span>
                    )}
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
          const isEmailOver = emailDropTarget === index;

          return (
            <div
              key={folder.path}
              draggable={!sidebarCollapsed}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={cn(
                'rounded-lg transition-all',
                isDraggingOver && 'ring-2 ring-blue-400 ring-offset-1 bg-blue-50 dark:bg-blue-900/20',
                isEmailOver && 'ring-2 ring-green-400 ring-offset-1 bg-green-50 dark:bg-green-900/20 scale-[1.02]',
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

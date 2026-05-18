'use client';
import { useState, useCallback, useRef } from 'react';
import { Search, Sparkles, X, RefreshCw, Paperclip, ShieldBan, Trash2, CheckCheck, Menu, PenSquare, MessageSquare } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { Email, ThreadSummary } from '@/types/shared';
import { cn, formatEmailDate, truncate, getInitials, getAvatarColor, PRIORITY_COLORS } from '@/lib/utils';
import { api } from '@/lib/ipc';

export function MailList() {
  const { selectedAccountId } = useAccountStore();
  const {
    threads, selectedThreadId, selectedFolder, loading, loadingMoreThreads, hasMoreThreads, syncing,
    selectThread, markAllRead, searchResults, searchQuery, isSmartSearch,
    smartSearchAnswer, clearSearch, search, smartSearch, syncEmails, loadMoreThreads, loadThreads,
    emails, selectedEmailId, selectEmail, markRead, loadingMore, hasMore, loadMoreEmails, clearThread,
    deleteThread,
  } = useMailStore();
  const { openCompose, setMobileSidebarOpen, setMobilePanel } = useUIStore();
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'normal' | 'smart'>('normal');

  // スレッド用無限スクロール
  const threadObserverRef = useRef<IntersectionObserver | null>(null);
  const threadBottomRef = useCallback((node: HTMLDivElement | null) => {
    if (threadObserverRef.current) threadObserverRef.current.disconnect();
    if (!node) return;
    threadObserverRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && selectedAccountId && !loadingMoreThreads && hasMoreThreads) {
        loadMoreThreads(selectedAccountId);
      }
    }, { threshold: 0.1 });
    threadObserverRef.current.observe(node);
  }, [selectedAccountId, loadingMoreThreads, hasMoreThreads, loadMoreThreads]);

  // 検索結果（個別メール）用無限スクロール
  const searchObserverRef = useRef<IntersectionObserver | null>(null);
  const searchBottomRef = useCallback((node: HTMLDivElement | null) => {
    if (searchObserverRef.current) searchObserverRef.current.disconnect();
    if (!node) return;
    searchObserverRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && selectedAccountId && !loadingMore && hasMore) {
        loadMoreEmails(selectedAccountId);
      }
    }, { threshold: 0.1 });
    searchObserverRef.current.observe(node);
  }, [selectedAccountId, loadingMore, hasMore, loadMoreEmails]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAccountId || !query.trim()) { clearSearch(); return; }
    if (searchMode === 'smart') {
      await smartSearch(selectedAccountId, query);
    } else {
      await search(selectedAccountId, query);
    }
  }

  async function handleSelectEmail(email: Email) {
    clearThread();
    selectEmail(email.id);
    setMobilePanel('mail');
    if (!email.isRead) {
      await markRead(email.id, true);
    }
  }

  async function handleSelectThread(thread: ThreadSummary) {
    if (!selectedAccountId) return;
    setMobilePanel('mail');
    await selectThread(selectedAccountId, thread.threadId, thread.folder);
  }

  const title = searchResults !== null
    ? `検索結果 (${(searchResults as Email[]).length}件)`
    : selectedFolder === 'INBOX' ? '受信トレイ'
    : selectedFolder === 'Sent' ? '送信済み'
    : selectedFolder === 'Drafts' ? '下書き'
    : selectedFolder === 'Trash' ? 'ゴミ箱'
    : selectedFolder === 'Starred' ? 'スター付き'
    : selectedFolder === 'Pinned' ? 'ピン留め'
    : selectedFolder;

  return (
    <div className="flex flex-col w-full md:w-80 flex-shrink-0 h-screen border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-3 md:px-4 pt-4 md:pt-8 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3 gap-2">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 flex-shrink-0"
          >
            <Menu size={20} />
          </button>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex-1 truncate">{title}</h2>
          <div className="flex items-center gap-0.5">
            {searchResults === null && threads.some((t) => t.unreadCount > 0) && (
              <button
                onClick={() => selectedAccountId && markAllRead(selectedAccountId, selectedFolder)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                title="すべて既読にする"
              >
                <CheckCheck size={15} />
              </button>
            )}
            <button
              onClick={() => selectedAccountId && syncEmails(selectedAccountId)}
              disabled={syncing || loading}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40 transition-colors"
              title="メールを更新"
            >
              <RefreshCw size={15} className={cn(syncing && 'animate-spin')} />
            </button>
            <button
              onClick={() => openCompose()}
              className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
              title="新規メール"
            >
              <PenSquare size={15} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="relative">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-1.5">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value) clearSearch();
              }}
              placeholder={searchMode === 'smart' ? '自然言語で検索…' : '検索…'}
              className="flex-1 bg-transparent text-sm outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); clearSearch(); }}>
                <X size={12} className="text-gray-400" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSearchMode(searchMode === 'smart' ? 'normal' : 'smart')}
              className={cn('p-0.5 rounded', searchMode === 'smart' ? 'text-blue-500' : 'text-gray-400 hover:text-gray-600')}
              title="AIスマート検索"
            >
              <Sparkles size={14} />
            </button>
          </div>
        </form>
      </div>

      {/* Smart search answer */}
      {isSmartSearch && smartSearchAnswer && (
        <div className="mx-3 mb-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-gray-700 dark:text-gray-300">{smartSearchAnswer}</p>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
          </div>
        ) : searchResults !== null ? (
          /* 検索結果：個別メール表示 */
          <>
            {(searchResults as Email[]).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                <Search size={24} className="mb-2 opacity-50" />
                <p className="text-sm">該当なし</p>
              </div>
            ) : (
              <>
                {(searchResults as Email[]).map((email) => (
                  <EmailItem
                    key={email.id}
                    email={email}
                    selected={selectedEmailId === email.id}
                    onClick={() => handleSelectEmail(email)}
                  />
                ))}
                <div ref={searchBottomRef} className="h-8 flex items-center justify-center">
                  {loadingMore && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />}
                </div>
              </>
            )}
          </>
        ) : (
          /* スレッド表示 */
          <>
            {threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                <Search size={24} className="mb-2 opacity-50" />
                <p className="text-sm">メールなし</p>
              </div>
            ) : (
              <>
                {threads.map((thread) => (
                  <ThreadItem
                    key={thread.threadId}
                    thread={thread}
                    selected={selectedThreadId === thread.threadId}
                    onClick={() => handleSelectThread(thread)}
                    onDelete={() => deleteThread(thread.threadId, thread.latestEmailId)}
                    onBlock={async () => {
                      if (!selectedAccountId) return;
                      if (!confirm(`${thread.latestFrom.address} をブロックしますか？`)) return;
                      await api.blocklist.add(selectedAccountId, thread.latestFrom.address, 'address');
                    }}
                  />
                ))}
                <div ref={threadBottomRef} className="h-8 flex items-center justify-center">
                  {loadingMoreThreads && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ThreadItem({
  thread, selected, onClick, onDelete, onBlock,
}: {
  thread: ThreadSummary;
  selected: boolean;
  onClick: () => void;
  onDelete?: () => Promise<void>;
  onBlock?: () => Promise<void>;
}) {
  const isUnread = thread.unreadCount > 0;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/email-id', thread.latestEmailId);
        e.dataTransfer.effectAllowed = 'move';
        const ghost = document.createElement('div');
        ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;background:#3b82f6;color:white;padding:4px 12px;border-radius:20px;font-size:12px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
        ghost.textContent = thread.subject || thread.latestFrom.name || 'メール';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, 30);
        setTimeout(() => document.body.removeChild(ghost), 100);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onClick}
        className={cn(
          'w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
          selected && 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500',
          isUnread && !selected && 'bg-blue-50/50 dark:bg-gray-800/60',
        )}
      >
        <div className="flex items-start gap-2.5">
          {/* Avatar */}
          <div className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5',
            getAvatarColor(thread.latestFrom.address),
          )}>
            {getInitials(thread.latestFrom.name, thread.latestFrom.address)}
          </div>

          <div className="min-w-0 flex-1">
            {/* From + date */}
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <span className={cn('text-sm truncate', isUnread ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>
                {thread.latestFrom.name || thread.latestFrom.address}
              </span>
              <span className="text-xs text-gray-400 flex-shrink-0">{formatEmailDate(thread.latestDate)}</span>
            </div>

            {/* Subject */}
            <div className={cn('text-xs truncate mb-0.5', isUnread ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400')}>
              {thread.subject}
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1.5">
              {thread.emailCount > 1 && (
                <span className={cn(
                  'flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full',
                  isUnread
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
                )}>
                  <MessageSquare size={10} />
                  {thread.emailCount}
                </span>
              )}
              {thread.hasAttachments && (
                <Paperclip size={11} className="text-gray-400 flex-shrink-0" />
              )}
              {isUnread && (
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              )}
              {thread.aiPriority === 'high' && (
                <span className={cn('text-xs flex-shrink-0', PRIORITY_COLORS.high)}>●</span>
              )}
            </div>
          </div>
        </div>
      </button>

      {hovered && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="削除"
              className="p-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-red-500 hover:border-red-300 shadow-sm transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
          {onBlock && (
            <button
              onClick={(e) => { e.stopPropagation(); onBlock(); }}
              title="このアドレスをブロック"
              className="p-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-orange-500 hover:border-orange-300 shadow-sm transition-colors"
            >
              <ShieldBan size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EmailItem({
  email, selected, onClick,
}: {
  email: Email;
  selected: boolean;
  onClick: () => void;
}) {
  const { selectedAccountId } = useAccountStore();
  const { deleteEmail } = useMailStore();
  const [hovered, setHovered] = useState(false);

  async function handleQuickDelete(e: React.MouseEvent) {
    e.stopPropagation();
    await deleteEmail(email.id);
  }

  async function handleQuickBlock(e: React.MouseEvent) {
    e.stopPropagation();
    if (!selectedAccountId) return;
    if (!confirm(`${email.from.address} をブロックしますか？`)) return;
    await api.blocklist.add(selectedAccountId, email.from.address, 'address');
  }

  return (
    <div
      className="relative group"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/email-id', email.id);
        e.dataTransfer.effectAllowed = 'move';
        const ghost = document.createElement('div');
        ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;background:#3b82f6;color:white;padding:4px 12px;border-radius:20px;font-size:12px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
        ghost.textContent = email.subject || email.from.name || 'メール';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, 30);
        setTimeout(() => document.body.removeChild(ghost), 100);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
        selected && 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500',
        !email.isRead && 'bg-blue-50/50 dark:bg-gray-800/60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5',
          getAvatarColor(email.from.address),
        )}>
          {getInitials(email.from.name, email.from.address)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={cn('text-sm truncate', !email.isRead ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>
              {email.from.name || email.from.address}
            </span>
            <span className="text-xs text-gray-400 flex-shrink-0">{formatEmailDate(email.date)}</span>
          </div>
          <div className={cn('text-xs truncate mb-0.5', !email.isRead ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400')}>
            {email.subject}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400 truncate flex-1">
              {truncate(email.bodyText.replace(/\s+/g, ' '), 60)}
            </span>
            {email.hasAttachments && <Paperclip size={11} className="text-gray-400 flex-shrink-0" />}
            {!email.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
            {email.isStarred && <span className="text-yellow-400 flex-shrink-0 text-xs">★</span>}
            {email.aiPriority === 'high' && <span className={cn('text-xs flex-shrink-0', PRIORITY_COLORS.high)}>●</span>}
          </div>
        </div>
      </div>
    </button>

    {hovered && (
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        <button
          onClick={handleQuickDelete}
          title="削除"
          className="p-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-red-500 hover:border-red-300 shadow-sm transition-colors"
        >
          <Trash2 size={13} />
        </button>
        <button
          onClick={handleQuickBlock}
          title="このアドレスをブロック"
          className="p-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-orange-500 hover:border-orange-300 shadow-sm transition-colors"
        >
          <ShieldBan size={13} />
        </button>
      </div>
    )}
    </div>
  );
}

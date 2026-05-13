'use client';
import { useState } from 'react';
import { Search, Sparkles, X, RefreshCw, Paperclip, ShieldBan } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { Email } from '@/types/shared';
import { cn, formatEmailDate, truncate, getInitials, getAvatarColor, PRIORITY_COLORS } from '@/lib/utils';
import { api } from '@/lib/ipc';

export function MailList() {
  const { selectedAccountId } = useAccountStore();
  const {
    emails, selectedEmailId, selectedFolder, loading, syncing,
    selectEmail, markRead, searchResults, searchQuery, isSmartSearch,
    smartSearchAnswer, clearSearch, search, smartSearch, syncEmails,
  } = useMailStore();
  const [query, setQuery] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [searchMode, setSearchMode] = useState<'normal' | 'smart'>('normal');

  const displayEmails = searchResults ?? emails;

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
    selectEmail(email.id);
    if (!email.isRead) {
      await markRead(email.id, true);
    }
  }

  const title = searchResults !== null
    ? `検索結果 (${displayEmails.length}件)`
    : selectedFolder === 'INBOX' ? '受信トレイ'
    : selectedFolder === 'Sent' ? '送信済み'
    : selectedFolder === 'Drafts' ? '下書き'
    : selectedFolder === 'Trash' ? 'ゴミ箱'
    : selectedFolder === 'Starred' ? 'スター付き'
    : selectedFolder;

  return (
    <div className="flex flex-col w-80 flex-shrink-0 h-screen border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-4 pt-8 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button
            onClick={() => selectedAccountId && syncEmails(selectedAccountId)}
            disabled={syncing || loading}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40 transition-colors"
            title="メールを更新"
          >
            <RefreshCw size={15} className={cn(syncing && 'animate-spin')} />
          </button>
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

      {/* Email list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
          </div>
        ) : displayEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm">{searchResults !== null ? '該当なし' : 'メールなし'}</p>
          </div>
        ) : (
          displayEmails.map((email) => (
            <EmailItem
              key={email.id}
              email={email}
              selected={selectedEmailId === email.id}
              onClick={() => handleSelectEmail(email)}
            />
          ))
        )}
      </div>
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
  const [hovered, setHovered] = useState(false);

  async function handleQuickBlock(e: React.MouseEvent) {
    e.stopPropagation();
    if (!selectedAccountId) return;
    if (!confirm(`${email.from.address} をブロックしますか？`)) return;
    await api.blocklist.add(selectedAccountId, email.from.address, 'address');
  }

  return (
    <div
      className="relative group"
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
        {/* Avatar */}
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5',
          getAvatarColor(email.from.address),
        )}>
          {getInitials(email.from.name, email.from.address)}
        </div>

        <div className="min-w-0 flex-1">
          {/* From + date */}
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={cn('text-sm truncate', !email.isRead ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>
              {email.from.name || email.from.address}
            </span>
            <span className="text-xs text-gray-400 flex-shrink-0">{formatEmailDate(email.date)}</span>
          </div>

          {/* Subject */}
          <div className={cn('text-xs truncate mb-0.5', !email.isRead ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400')}>
            {email.subject}
          </div>

          {/* Preview + badges */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400 truncate flex-1">
              {truncate(email.bodyText.replace(/\s+/g, ' '), 60)}
            </span>
            {email.hasAttachments && (
              <Paperclip size={11} className="text-gray-400 flex-shrink-0" />
            )}
            {!email.isRead && (
              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            )}
            {email.isStarred && (
              <span className="text-yellow-400 flex-shrink-0 text-xs">★</span>
            )}
            {email.aiPriority === 'high' && (
              <span className={cn('text-xs flex-shrink-0', PRIORITY_COLORS.high)}>●</span>
            )}
          </div>
        </div>
      </div>
    </button>

    {/* クイックブロックボタン（ホバー時に表示） */}
    {hovered && (
      <button
        onClick={handleQuickBlock}
        title="このアドレスをブロック"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-red-500 hover:border-red-300 shadow-sm transition-colors"
      >
        <ShieldBan size={13} />
      </button>
    )}
    </div>
  );
}

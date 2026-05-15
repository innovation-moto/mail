'use client';
import { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, X, RefreshCw, Paperclip, ShieldBan, Trash2, CheckCheck, Pin, PinOff } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { Email } from '@/types/shared';
import { cn, formatEmailDate, truncate, getInitials, getAvatarColor, PRIORITY_COLORS } from '@/lib/utils';
import { api } from '@/lib/ipc';

const FAVICON_SOURCES = (domain: string) => [
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  `https://${domain}/favicon.ico`,
];

function SenderAvatar({ email, name }: { email: string; name?: string }) {
  const domain = email.split('@')[1] ?? '';
  const [srcIndex, setSrcIndex] = useState(0);
  const sources = FAVICON_SOURCES(domain);

  const handleError = () => setSrcIndex((i) => i + 1);

  if (domain && srcIndex < sources.length) {
    return (
      <div className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5 overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
        <img
          src={sources[srcIndex]}
          alt={name || email}
          className="w-5 h-5 object-contain"
          onError={handleError}
        />
      </div>
    );
  }
  return (
    <div className={cn(
      'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5',
      getAvatarColor(email),
    )}>
      {getInitials(name, email)}
    </div>
  );
}

export function MailList() {
  const { selectedAccountId } = useAccountStore();
  const {
    emails, selectedEmailId, selectedFolder, loading, syncing,
    selectEmail, markRead, markAllRead, searchResults, searchQuery, isSmartSearch,
    smartSearchAnswer, clearSearch, search, smartSearch, syncEmails,
  } = useMailStore();
  const [query, setQuery] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [searchMode, setSearchMode] = useState<'normal' | 'smart'>('normal');
  const [newMailThreshold, setNewMailThreshold] = useState<number>(0);
  const prevFolderKey = useRef('');

  // フォルダ切り替え時に「最後に見た時刻」を記録し、新着区切りのしきい値を設定
  useEffect(() => {
    if (!selectedAccountId) return;
    const key = `lastSeen:${selectedAccountId}:${selectedFolder}`;
    if (prevFolderKey.current === key) return;
    prevFolderKey.current = key;
    const last = Number(localStorage.getItem(key) ?? 0);
    setNewMailThreshold(last);
    localStorage.setItem(key, String(Date.now()));
  }, [selectedAccountId, selectedFolder]);

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
    : selectedFolder === 'Pinned' ? 'ピン留め'
    : selectedFolder;

  return (
    <div className="flex flex-col w-80 flex-shrink-0 h-screen border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-4 pt-8 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <div className="flex items-center gap-0.5">
            {searchResults === null && emails.some((e) => !e.isRead) && (
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
          (() => {
            // 新着区切り線を挿入する位置を探す（threshold より新しい最初のメール）
            const dividerIndex = newMailThreshold > 0
              ? displayEmails.findIndex((e) => e.date > newMailThreshold)
              : -1;
            return displayEmails.map((email, i) => (
              <>
                {dividerIndex === i && (
                  <div key={`divider-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                    <div className="flex-1 h-px bg-blue-400/50" />
                    <span className="text-[10px] font-medium text-blue-400 whitespace-nowrap">新着メール</span>
                    <div className="flex-1 h-px bg-blue-400/50" />
                  </div>
                )}
                <EmailItem
                  key={email.id}
                  email={email}
                  selected={selectedEmailId === email.id}
                  onClick={() => handleSelectEmail(email)}
                />
              </>
            ));
          })()
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
  const { deleteEmail, pinEmail } = useMailStore();
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

  async function handleQuickPin(e: React.MouseEvent) {
    e.stopPropagation();
    await pinEmail(email.id, !email.isPinned);
  }

  return (
    <div
      className="relative group"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/email-id', email.id);
        e.dataTransfer.effectAllowed = 'move';
        // ドラッグ画像をコンパクトなラベルにしてカーソル上部に表示
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
        {/* Avatar */}
        <SenderAvatar email={email.from.address} name={email.from.name} />

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
            {email.isPinned && (
              <Pin size={11} className="text-blue-400 flex-shrink-0" />
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

    {/* クイックアクションボタン（ホバー時に表示） */}
    {hovered && (
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        <button
          onClick={handleQuickPin}
          title={email.isPinned ? 'ピン留めを外す' : 'ピン留め'}
          className={cn(
            'p-1.5 rounded-lg bg-white dark:bg-gray-800 border shadow-sm transition-colors',
            email.isPinned
              ? 'border-blue-300 text-blue-500 hover:text-blue-600'
              : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:text-blue-500 hover:border-blue-300',
          )}
        >
          {email.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
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

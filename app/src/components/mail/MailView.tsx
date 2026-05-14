'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Reply, Forward, Trash2, Star, StarOff, Pin, PinOff, MoreHorizontal,
  Sparkles, ChevronDown, Paperclip, X, Copy, Check,
  FolderInput, ShieldBan, Filter, Plus, Loader2, Download, AlertTriangle, CalendarPlus, ChevronLeft,
  Circle, Clock, UserPlus,
} from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/ipc';
import { AiSummarizeResult, AiTone, CalendarEvent, Email, FilterCondition } from '@/types/shared';
import { cn, formatFullDate, formatShortDate, CATEGORY_LABELS, PRIORITY_LABELS, PRIORITY_COLORS } from '@/lib/utils';

export function MailView() {
  const { selectedAccountId } = useAccountStore();
  const { selectedEmail, starEmail, pinEmail, deleteEmail, updateEmailLocally } = useMailStore();
  const { openCompose, setMobilePanel } = useUIStore();
  const email = selectedEmail();

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-[#0f1623] relative overflow-hidden">
        {/* 背景グラデーション装飾 */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-500/5 dark:bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/3 left-1/3 w-64 h-64 bg-indigo-500/5 dark:bg-indigo-500/8 rounded-full blur-3xl" />
        </div>

        <div className="relative text-center space-y-5 px-8">
          {/* アイコン */}
          <div className="flex items-center justify-center mx-auto w-20 h-20 rounded-2xl bg-white dark:bg-gray-800 shadow-lg dark:shadow-black/30 border border-gray-100 dark:border-gray-700">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-blue-500 dark:text-blue-400">
              <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2 8l10 6 10-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>

          <div className="space-y-1.5">
            <p className="text-base font-semibold text-gray-700 dark:text-gray-200">メールを選択</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
              左のリストからメールを選ぶと<br />ここに内容が表示されます
            </p>
          </div>

          {/* ショートカットヒント */}
          <div className="flex items-center justify-center gap-3 pt-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
              <kbd className="text-[10px] font-medium text-gray-400 dark:text-gray-500">↑</kbd>
              <kbd className="text-[10px] font-medium text-gray-400 dark:text-gray-500">↓</kbd>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">で移動</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
              <kbd className="text-[10px] font-medium text-gray-400 dark:text-gray-500">Enter</kbd>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">で開く</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-white dark:bg-gray-900">
      <MailViewContent
        key={email.id}
        email={email}
        accountId={selectedAccountId ?? ''}
        onStar={(starred) => starEmail(email.id, starred)}
        onPin={(pinned) => pinEmail(email.id, pinned)}
        onDelete={() => deleteEmail(email.id)}
        onReply={() => openCompose({ replyTo: email })}
        onReplyAll={() => openCompose({ replyTo: email, replyAll: true })}
        onForward={() => openCompose({ forwardFrom: email })}
        onUpdateAi={(patch) => updateEmailLocally(email.id, patch as Partial<Email>)}
        onBack={() => setMobilePanel('list')}
      />
    </div>
  );
}

function useMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

function MailViewContent({
  email, accountId, onStar, onPin, onDelete, onReply, onReplyAll, onForward, onUpdateAi, onBack,
}: {
  email: Email;
  accountId: string;
  onStar: (starred: boolean) => void;
  onPin: (pinned: boolean) => void;
  onDelete: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onUpdateAi: (patch: Partial<Email>) => void;
  onBack?: () => void;
}) {
  const isMobile = useMobile();
  const { updateEmailLocally } = useMailStore();
  const [bodyLoading, setBodyLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [summaryResult, setSummaryResult] = useState<AiSummarizeResult | null>(
    email.aiSummary ? { summary: email.aiSummary, actions: email.aiActions ?? [] } : null,
  );
  const [showSummary, setShowSummary] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [showQuickFilter, setShowQuickFilter] = useState(false);
  const [fetchingAttachments, setFetchingAttachments] = useState(false);
  const [detectingCalendar, setDetectingCalendar] = useState(false);
  const [calendarEvent, setCalendarEvent] = useState<CalendarEvent | null>(null);
  const [calendarAdded, setCalendarAdded] = useState(false);
  // 添付ファイルはローカル状態で保持（同期によるリセットを防ぐ）
  const [localAttachments, setLocalAttachments] = useState(email.attachments ?? []);

  // メールが切り替わったら添付・カレンダーをリセット
  useEffect(() => {
    setLocalAttachments(email.attachments ?? []);
    setCalendarEvent(null);
    setCalendarAdded(false);
  }, [email.id]);

  // メール選択時に本文をIMAPからオンデマンド取得（Web版）
  useEffect(() => {
    if (!email.bodyText && !email.bodyHtml && !bodyLoading) {
      setBodyLoading(true);
      api.mail.fetchEmail(email.id)
        .then((fullEmail) => {
          if (fullEmail?.bodyText || fullEmail?.bodyHtml) {
            updateEmailLocally(email.id, {
              bodyText: fullEmail.bodyText,
              bodyHtml: fullEmail.bodyHtml,
            });
          }
        })
        .catch(console.error)
        .finally(() => setBodyLoading(false));
    }
  }, [email.id]);

  // 添付ファイルがあるはずなのにDBに保存されていない場合、自動取得
  useEffect(() => {
    if (email.hasAttachments && localAttachments.length === 0 && !fetchingAttachments) {
      setFetchingAttachments(true);
      api.mail.fetchAttachments(email.id)
        .then((updated) => {
          if (updated?.attachments && updated.attachments.length > 0) {
            setLocalAttachments(updated.attachments);
          }
        })
        .catch(console.error)
        .finally(() => setFetchingAttachments(false));
    }
  }, [email.id]);

  async function handleSummarize() {
    setSummarizing(true);
    try {
      const result = await api.ai.summarize(email.id);
      setSummaryResult(result);
      setShowSummary(true);
      onUpdateAi({ aiSummary: result.summary, aiActions: result.actions });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSummarizing(false);
    }
  }

  async function handleClassify() {
    setClassifying(true);
    try {
      const result = await api.ai.classify(email.id);
      onUpdateAi({ aiCategory: result.category, aiPriority: result.priority });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setClassifying(false);
    }
  }

  async function handleDetectCalendar() {
    setDetectingCalendar(true);
    setCalendarEvent(null);
    try {
      const event = await api.ai.detectCalendarEvent(email.id);
      if (event) {
        setCalendarEvent(event);
      } else {
        alert('このメールに予定情報が見つかりませんでした。');
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDetectingCalendar(false);
    }
  }

  async function handleAddToCalendar() {
    if (!calendarEvent) return;
    try {
      await api.ai.openCalendarEvent(calendarEvent);
      setCalendarAdded(true);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleMarkSpam() {
    setBlockMenuOpen(false);
    if (!confirm(`このメールを迷惑メールとして報告しますか？\n送信者: ${email.from.address}`)) return;
    try {
      await api.mail.markSpam(email.id);
      onDelete(); // メール一覧から削除
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleBlock(type: 'address' | 'domain') {
    const pattern = type === 'address' ? email.from.address : email.from.address.split('@')[1];
    if (!pattern) return;
    await api.blocklist.add(accountId, pattern, type);
    setBlockMenuOpen(false);
    alert(`${pattern} をブロックしました。次回の同期から自動でゴミ箱に移動します。`);
  }

  const bodyLength = email.bodyText.length;

  // ─── モバイル専用レイアウト ───────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-gray-100 dark:bg-gray-950">
        {/* Top navbar */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          {onBack ? (
            <button
              onClick={onBack}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 shadow-sm"
            >
              <ChevronLeft size={20} strokeWidth={2.5} className="text-gray-700 dark:text-gray-300" />
            </button>
          ) : <div className="w-10" />}

          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-full px-4 py-2 shadow-sm">
            <button
              onClick={() => onPin(!email.isPinned)}
              className={cn('p-1.5 transition-colors', email.isPinned ? 'text-blue-500' : 'text-gray-500 dark:text-gray-400')}
            >
              <Pin size={19} />
            </button>
            <button
              onClick={handleSummarize}
              disabled={summarizing}
              className="p-1.5 text-gray-500 dark:text-gray-400 disabled:opacity-40"
            >
              <Sparkles size={19} />
            </button>
            <button
              onClick={() => setShowQuickFilter(true)}
              className="p-1.5 text-gray-500 dark:text-gray-400"
            >
              <UserPlus size={19} />
            </button>
          </div>
        </div>

        {/* Subject */}
        <div className="px-4 pb-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">
            {email.subject}
          </h1>
        </div>

        {/* Email card(s) */}
        <div className="flex-1 overflow-y-auto space-y-2 pb-2">
          <div className="bg-white dark:bg-gray-900">
            {/* Card header */}
            <div className="px-4 pt-4 pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white truncate">
                    {email.from.name || email.from.address}
                  </div>
                  <div className="text-sm text-blue-500 truncate">
                    宛先: {email.to.map((t) => t.name || t.address).join(', ')}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-400">{formatShortDate(email.date)}</span>
                  <button className="text-gray-400" onClick={() => setShowMobileMore(true)}>
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* AI Summary */}
            {showSummary && summaryResult && (
              <div className="mx-4 mb-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-200 dark:border-purple-800">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400">
                    <Sparkles size={12} /> AI 要約
                  </div>
                  <button onClick={() => setShowSummary(false)}><X size={13} className="text-gray-400" /></button>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">{summaryResult.summary}</p>
              </div>
            )}

            {/* Body */}
            <div className="px-4 pb-4 min-h-16">
              {bodyLoading ? (
                <div className="flex items-center justify-center h-16">
                  <Loader2 size={20} className="animate-spin text-blue-400" />
                </div>
              ) : email.bodyHtml ? (
                <EmailHtmlView html={email.bodyHtml} />
              ) : email.bodyText ? (
                <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {email.bodyText}
                </pre>
              ) : null}
            </div>

            {/* Attachments */}
            {email.hasAttachments && localAttachments.length > 0 && (
              <div className="px-4 pb-3 border-t border-gray-100 dark:border-gray-800 pt-3">
                <div className="flex flex-wrap gap-2">
                  {localAttachments.map((att) => (
                    <AttachmentChip key={att.id} attachment={att} />
                  ))}
                </div>
              </div>
            )}

            {/* Card footer: reply / forward */}
            <div className="flex justify-end gap-5 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
              <button onClick={onReply} className="text-gray-300 dark:text-gray-600 active:text-blue-500 transition-colors">
                <Reply size={21} strokeWidth={1.5} />
              </button>
              <button onClick={onForward} className="text-gray-300 dark:text-gray-600 active:text-blue-500 transition-colors">
                <Forward size={21} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom footer */}
        <div className="flex items-center justify-around px-4 py-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onReply} className="p-2 text-gray-500 dark:text-gray-400">
            <Reply size={24} strokeWidth={1.5} />
          </button>
          <button onClick={onReplyAll} className="p-2 text-gray-500 dark:text-gray-400">
            <Reply size={24} strokeWidth={1.5} className="-scale-x-100" />
          </button>
          <button onClick={onForward} className="p-2 text-gray-500 dark:text-gray-400">
            <Forward size={24} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => onStar(!email.isStarred)}
            className={cn('p-2', email.isStarred ? 'text-yellow-400' : 'text-gray-400')}
          >
            <Star size={24} strokeWidth={1.5} />
          </button>
          <button onClick={onDelete} className="p-2 text-red-400">
            <Trash2 size={24} strokeWidth={1.5} />
          </button>
          <button onClick={() => setShowMobileMore(true)} className="p-2 text-gray-500 dark:text-gray-400">
            <MoreHorizontal size={24} strokeWidth={1.5} />
          </button>
        </div>

        {/* Mobile More Bottom Sheet */}
        {showMobileMore && (
          <>
            <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowMobileMore(false)} />
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl pb-10">
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mt-3 mb-4" />
              <div className="grid grid-cols-4 gap-1 px-4">
                {[
                  { icon: <Pin size={22} />, label: email.isPinned ? 'ピン解除' : 'ピン留め', action: () => { onPin(!email.isPinned); setShowMobileMore(false); }, color: email.isPinned ? 'text-blue-500' : 'text-gray-600 dark:text-gray-400' },
                  { icon: <Sparkles size={22} />, label: summarizing ? '要約中…' : '要約', action: () => { handleSummarize(); setShowMobileMore(false); }, color: 'text-purple-500' },
                  { icon: <Sparkles size={22} />, label: classifying ? '分類中…' : 'AI分類', action: () => { handleClassify(); setShowMobileMore(false); }, color: 'text-blue-500' },
                  { icon: <CalendarPlus size={22} />, label: 'カレンダー', action: () => { handleDetectCalendar(); setShowMobileMore(false); }, color: 'text-green-500' },
                  { icon: <AlertTriangle size={22} />, label: '迷惑メール', action: () => { handleMarkSpam(); setShowMobileMore(false); }, color: 'text-orange-500' },
                  { icon: <ShieldBan size={22} />, label: 'アドレスブロック', action: () => { handleBlock('address'); setShowMobileMore(false); }, color: 'text-red-500' },
                  { icon: <ShieldBan size={22} />, label: 'ドメインブロック', action: () => { handleBlock('domain'); setShowMobileMore(false); }, color: 'text-red-400' },
                  { icon: <Filter size={22} />, label: 'フィルター作成', action: () => { setShowQuickFilter(true); setShowMobileMore(false); }, color: 'text-gray-500' },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <span className={item.color}>{item.icon}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 text-center leading-tight">{item.label}</span>
                  </button>
                ))}
              </div>

              {/* AI返信生成 */}
              <div className="mt-3 mx-4 border-t border-gray-100 dark:border-gray-800 pt-3">
                <AiReplyBar email={email} onReply={onReply} onReplyAll={onReplyAll} onForward={onForward} />
              </div>
            </div>
          </>
        )}

        {/* Quick Filter Modal */}
        {showQuickFilter && (
          <QuickFilterModal
            email={email}
            accountId={accountId}
            onClose={() => setShowQuickFilter(false)}
          />
        )}
      </div>
    );
  }

  // ─── デスクトップレイアウト ────────────────────────────────────────────────────
  void bodyLength;

  return (
    <>
      {/* Header */}
      <div className="px-4 md:px-6 pt-3 md:pt-8 pb-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* モバイル：戻るボタン */}
        {onBack && (
          <button
            onClick={onBack}
            className="md:hidden flex items-center justify-center w-9 h-9 mb-3 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 active:scale-95 transition-transform"
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
          </button>
        )}
        {/* Subject */}
        <h1 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-3 leading-tight">
          {email.subject}
        </h1>

        {/* From / To / Date */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 min-w-0">
              <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {email.from.name || email.from.address}
              </span>
              {email.from.name && (
                <span className="hidden md:inline text-xs text-gray-400 truncate">&lt;{email.from.address}&gt;</span>
              )}
              <button
                onClick={() => setShowQuickFilter(true)}
                title="このアドレスでフィルターを作成"
                className="flex-shrink-0 p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
              >
                <Filter size={12} />
              </button>
            </div>
            <div className="text-xs text-gray-400 truncate">
              宛先: {email.to.map((t) => t.name || t.address).join(', ')}
            </div>
          </div>
          <div className="text-xs text-gray-400 flex-shrink-0 pt-0.5 text-right">
            {formatFullDate(email.date)}
          </div>
        </div>

        {/* AI badges */}
        {(email.aiCategory || email.aiPriority) && (
          <div className="flex items-center gap-2 mt-2">
            {email.aiCategory && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-600 dark:text-gray-400">
                {CATEGORY_LABELS[email.aiCategory] ?? email.aiCategory}
              </span>
            )}
            {email.aiPriority && (
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', {
                'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400': email.aiPriority === 'high',
                'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400': email.aiPriority === 'medium',
                'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400': email.aiPriority === 'low',
              })}>
                優先度: {PRIORITY_LABELS[email.aiPriority]}
              </span>
            )}
          </div>
        )}

        {/* Action bar - 2段組 */}
        <div className="flex flex-col gap-1.5 mt-3">
          {/* 1段目：基本操作 */}
          <div className="flex items-center gap-1">
            <ActionButton
              icon={email.isStarred ? <StarOff size={15} /> : <Star size={15} />}
              label={email.isStarred ? 'スター解除' : 'スター'}
              onClick={() => onStar(!email.isStarred)}
            />
            <ActionButton
              icon={email.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
              label={email.isPinned ? 'ピン解除' : 'ピン留め'}
              onClick={() => onPin(!email.isPinned)}
              active={email.isPinned}
            />
            <ActionButton icon={<Trash2 size={15} />} label="削除" onClick={onDelete} variant="danger" />
          </div>

          {/* 2段目：AI操作 */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleSummarize}
              disabled={summarizing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Sparkles size={13} />
              {summarizing ? '要約中…' : '要約'}
            </button>

            <button
              onClick={handleClassify}
              disabled={classifying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Sparkles size={13} />
              {classifying ? '分類中…' : 'AI分類'}
            </button>

            <button
              onClick={handleDetectCalendar}
              disabled={detectingCalendar}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <CalendarPlus size={13} />
              {detectingCalendar ? '検出中…' : 'カレンダー'}
            </button>

            {/* Spam / Block menu */}
            <div className="relative">
              <button
                onClick={() => setBlockMenuOpen(!blockMenuOpen)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                title="迷惑メール・ブロック"
              >
                <ShieldBan size={15} />
              </button>
              {blockMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBlockMenuOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1">
                    <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">迷惑メール</div>
                    <button
                      onClick={handleMarkSpam}
                      className="w-full text-left px-4 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <AlertTriangle size={14} />
                      迷惑メールとして報告
                    </button>
                    <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                    <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">ブロック</div>
                    <button
                      onClick={() => handleBlock('address')}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <ShieldBan size={14} />
                      このアドレスをブロック
                    </button>
                    <button
                      onClick={() => handleBlock('domain')}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <ShieldBan size={14} />
                      このドメインをブロック
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Event Card */}
      {calendarEvent && (
        <div className="mx-6 mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 flex-shrink-0">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <CalendarPlus size={14} className="text-green-500" />
              <span className="text-sm font-medium text-green-700 dark:text-green-300">予定を検出しました</span>
            </div>
            <button onClick={() => setCalendarEvent(null)} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
          <div className="space-y-1.5 mb-3">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{calendarEvent.title}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {new Date(calendarEvent.startDate).toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}
              {' 〜 '}
              {new Date(calendarEvent.endDate).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            </div>
            {calendarEvent.location && (
              <div className="text-xs text-gray-500 dark:text-gray-400">📍 {calendarEvent.location}</div>
            )}
            {calendarEvent.description && (
              <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{calendarEvent.description}</div>
            )}
          </div>
          <button
            onClick={handleAddToCalendar}
            disabled={calendarAdded}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
          >
            {calendarAdded ? <Check size={13} /> : <CalendarPlus size={13} />}
            {calendarAdded ? 'カレンダーに追加しました' : 'カレンダーに追加'}
          </button>
        </div>
      )}

      {/* AI Summary */}
      {showSummary && summaryResult && (
        <div className="mx-6 mt-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800 flex-shrink-0">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-purple-500" />
              <span className="text-sm font-medium text-purple-700 dark:text-purple-300">AI 要約</span>
            </div>
            <button onClick={() => setShowSummary(false)} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{summaryResult.summary}</p>
          {summaryResult.actions.length > 0 && (
            <div>
              <div className="text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">要アクション:</div>
              <ul className="space-y-0.5">
                {summaryResult.actions.map((action, i) => (
                  <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5">
                    <span className="text-purple-400 flex-shrink-0">•</span>
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Email body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-6 py-4">
        {bodyLoading ? (
          <div className="flex items-center justify-center h-24 gap-2 text-gray-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">本文を読み込み中…</span>
          </div>
        ) : email.bodyHtml ? (
          <EmailHtmlView html={email.bodyHtml} />
        ) : email.bodyText ? (
          <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
            {email.bodyText}
          </pre>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">本文がありません</p>
        )}
      </div>

      {/* Attachments */}
      {email.hasAttachments && (
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            <Paperclip size={13} />
            添付ファイル
            {fetchingAttachments && <Loader2 size={12} className="animate-spin ml-1" />}
          </div>
          {fetchingAttachments ? (
            <p className="text-xs text-gray-400">取得中...</p>
          ) : localAttachments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {localAttachments.map((att) => (
                <AttachmentChip key={att.id} attachment={att} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">添付ファイルを読み込めませんでした</p>
          )}
        </div>
      )}

      {/* Reply bar */}
      <div className="px-4 md:px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <AiReplyBar email={email} onReply={onReply} onReplyAll={onReplyAll} onForward={onForward} />
      </div>

      {/* Quick Filter Modal */}
      {showQuickFilter && (
        <QuickFilterModal
          email={email}
          accountId={accountId}
          onClose={() => setShowQuickFilter(false)}
        />
      )}
    </>
  );
}

function EmailHtmlView({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<style>
  :root { color-scheme: light; }
  html { background: #ffffff; }
  body { background: #ffffff; margin: 8px; font-family: -apple-system, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }
</style>
</head>
<body>${html}</body>
</html>`;

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const body = iframe.contentDocument?.body;
      if (body) {
        iframe.style.height = `${body.scrollHeight + 32}px`;
      }
    } catch { /* cross-origin guard */ }
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      onLoad={handleLoad}
      sandbox="allow-same-origin allow-popups"
      className="w-full border-0 block"
      style={{ minHeight: '100px' }}
      title="email-body"
    />
  );
}

function AiReplyBar({ email, onReply, onReplyAll, onForward }: {
  email: Email;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}) {
  const { openCompose } = useUIStore();
  const [tone, setTone] = useState<AiTone>('polite');
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const tones: { value: AiTone; label: string }[] = [
    { value: 'polite', label: '丁寧' },
    { value: 'casual', label: 'カジュアル' },
    { value: 'brief', label: '簡潔' },
  ];

  async function handleGenerate() {
    setGenerating(true);
    setDraft('');
    try {
      const result = await api.ai.generateReply(email.id, tone);
      setDraft(result);
      setExpanded(true);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleUseReply() {
    openCompose({ replyTo: { ...email, bodyText: draft } });
  }

  return (
    <div className="space-y-2">
      {/* Row 1: 返信・転送ボタン */}
      <div className="flex items-center gap-2">
        <button
          onClick={onReply}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <Reply size={14} />
          返信
        </button>
        <button
          onClick={onReplyAll}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <Reply size={14} />
          <span className="hidden sm:inline">全員に</span>返信
        </button>
        <button
          onClick={onForward}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Forward size={14} />
          転送
        </button>
      </div>

      {/* Row 2: AIトーン + 生成ボタン */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* AI reply generation */}
        <div className="flex items-center gap-1">
          {tones.map((t) => (
            <button
              key={t.value}
              onClick={() => setTone(t.value)}
              className={cn(
                'px-2.5 py-1.5 text-xs rounded-md transition-colors',
                tone === t.value
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50 transition-colors"
        >
          <Sparkles size={13} />
          {generating ? 'AI生成中…' : 'AIで返信生成'}
        </button>
      </div>

      {/* Generated draft */}
      {draft && expanded && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">AI生成の下書き</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title="コピー"
              >
                {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              </button>
              <button
                onClick={() => setExpanded(false)}
                className="p-1 rounded text-gray-400 hover:text-gray-600"
              >
                <X size={13} />
              </button>
            </div>
          </div>
          <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto scrollbar-thin">
            {draft}
          </pre>
          <button
            onClick={handleUseReply}
            className="mt-2 w-full text-xs py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            この下書きを使って返信
          </button>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon, label, onClick, variant = 'default', active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap',
        variant === 'danger'
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
          : active
            ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Attachment Chip ──────────────────────────────────────────────────────────

function AttachmentChip({ attachment }: { attachment: { id: string; filename: string; contentType: string; size: number } }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      await api.mail.downloadAttachment(attachment.id);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 text-left"
    >
      <Paperclip size={13} className="text-gray-400 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate max-w-40">{attachment.filename}</div>
        <div className="text-xs text-gray-400">{formatSize(attachment.size)}</div>
      </div>
      {downloading
        ? <Loader2 size={13} className="animate-spin text-blue-500 flex-shrink-0" />
        : <Download size={13} className="text-gray-400 flex-shrink-0" />
      }
    </button>
  );
}

// ─── Quick Filter Modal ───────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  from: '送信者', to: '宛先', subject: '件名', body: '本文',
};
const OP_LABELS: Record<string, string> = {
  contains: '含む', equals: '等しい', startsWith: '始まる', endsWith: '終わる',
};

function QuickFilterModal({ email, accountId, onClose }: {
  email: Email;
  accountId: string;
  onClose: () => void;
}) {
  const { folders } = useMailStore();
  const [name, setName] = useState(`${email.from.address} からのメール`);
  const [conditions, setConditions] = useState<FilterCondition[]>([
    { field: 'from', operator: 'contains', value: email.from.address },
  ]);
  const [conditionType, setConditionType] = useState<'all' | 'any'>('any');
  const [actionFolder, setActionFolder] = useState('');
  const [actionMarkRead, setActionMarkRead] = useState(false);
  const [actionStarred, setActionStarred] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateCondition(i: number, patch: Partial<FilterCondition>) {
    setConditions((prev) => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  async function handleSave() {
    if (!accountId || conditions.some((c) => !c.value.trim())) return;
    setSaving(true);
    try {
      await api.filters.create(accountId, {
        name,
        conditions,
        conditionType,
        actionFolder: actionFolder || null,
        actionMarkRead,
        actionStarred,
        active: true,
      });
      setSaved(true);
      setTimeout(() => onClose(), 1000);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-blue-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">フィルターを作成</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Rule name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">ルール名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500"
            />
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">条件</label>
              <select
                value={conditionType}
                onChange={(e) => setConditionType(e.target.value as 'all' | 'any')}
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="any">いずれか (OR)</option>
                <option value="all">すべて (AND)</option>
              </select>
            </div>
            <div className="space-y-2">
              {conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={c.field}
                    onChange={(e) => updateCondition(i, { field: e.target.value as FilterCondition['field'] })}
                    className="text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <select
                    value={c.operator}
                    onChange={(e) => updateCondition(i, { operator: e.target.value as FilterCondition['operator'] })}
                    className="text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {Object.entries(OP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input
                    value={c.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500"
                  />
                  {conditions.length > 1 && (
                    <button
                      onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-red-400 hover:text-red-600"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setConditions((prev) => [...prev, { field: 'from', operator: 'contains', value: '' }])}
                className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
              >
                <Plus size={12} /> 条件を追加
              </button>
            </div>
          </div>

          {/* Actions */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">アクション</label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 dark:text-gray-400 w-20 flex-shrink-0">フォルダへ移動</span>
                <select
                  value={actionFolder}
                  onChange={(e) => setActionFolder(e.target.value)}
                  className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">移動しない</option>
                  {folders.map((f) => <option key={f.path} value={f.path}>{f.name || f.path}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={actionMarkRead} onChange={(e) => setActionMarkRead(e.target.checked)} className="rounded" />
                既読にする
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={actionStarred} onChange={(e) => setActionStarred(e.target.checked)} className="rounded" />
                スターを付ける
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saved ? '✓ 保存しました' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

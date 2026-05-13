'use client';
import { useState, useEffect } from 'react';
import {
  Reply, Forward, Trash2, Star, StarOff, MoreHorizontal,
  Sparkles, ChevronDown, Paperclip, X, Copy, Check,
  FolderInput, ShieldBan, Filter, Plus, Loader2, Download, AlertTriangle,
} from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/ipc';
import { AiSummarizeResult, AiTone, Email, FilterCondition } from '@/types/shared';
import { cn, formatFullDate, CATEGORY_LABELS, PRIORITY_LABELS, PRIORITY_COLORS } from '@/lib/utils';

export function MailView() {
  const { selectedAccountId } = useAccountStore();
  const { selectedEmail, starEmail, deleteEmail, updateEmailLocally } = useMailStore();
  const { openCompose } = useUIStore();
  const email = selectedEmail();

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-gray-400">
          <div className="text-4xl mb-3">✉️</div>
          <p className="text-sm">メールを選択してください</p>
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
        onDelete={() => deleteEmail(email.id)}
        onReply={() => openCompose({ replyTo: email })}
        onForward={() => openCompose({ forwardFrom: email })}
        onUpdateAi={(patch) => updateEmailLocally(email.id, patch as Partial<Email>)}
      />
    </div>
  );
}

function MailViewContent({
  email, accountId, onStar, onDelete, onReply, onForward, onUpdateAi,
}: {
  email: Email;
  accountId: string;
  onStar: (starred: boolean) => void;
  onDelete: () => void;
  onReply: () => void;
  onForward: () => void;
  onUpdateAi: (patch: Partial<Email>) => void;
}) {
  const { updateEmailLocally } = useMailStore();
  const [summarizing, setSummarizing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [summaryResult, setSummaryResult] = useState<AiSummarizeResult | null>(
    email.aiSummary ? { summary: email.aiSummary, actions: email.aiActions ?? [] } : null,
  );
  const [showSummary, setShowSummary] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [showQuickFilter, setShowQuickFilter] = useState(false);
  const [fetchingAttachments, setFetchingAttachments] = useState(false);
  // 添付ファイルはローカル状態で保持（同期によるリセットを防ぐ）
  const [localAttachments, setLocalAttachments] = useState(email.attachments ?? []);

  // メールが切り替わったら添付をリセット
  useEffect(() => {
    setLocalAttachments(email.attachments ?? []);
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

  return (
    <>
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* Subject */}
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-3 leading-tight">
          {email.subject}
        </h1>

        {/* From / To / Date */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {email.from.name || email.from.address}
              </span>
              {email.from.name && (
                <span className="text-xs text-gray-400">&lt;{email.from.address}&gt;</span>
              )}
              <button
                onClick={() => setShowQuickFilter(true)}
                title="このアドレスでフィルターを作成"
                className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
              >
                <Filter size={12} />
              </button>
            </div>
            <div className="text-xs text-gray-400">
              宛先: {email.to.map((t) => t.name || t.address).join(', ')}
            </div>
          </div>
          <div className="text-xs text-gray-400 flex-shrink-0 pt-0.5">
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

        {/* Action bar */}
        <div className="flex items-center gap-1 mt-3">
          <ActionButton icon={<Reply size={15} />} label="返信" onClick={onReply} />
          <ActionButton icon={<Forward size={15} />} label="転送" onClick={onForward} />
          <ActionButton
            icon={email.isStarred ? <StarOff size={15} /> : <Star size={15} />}
            label={email.isStarred ? 'スター解除' : 'スター'}
            onClick={() => onStar(!email.isStarred)}
          />
          <ActionButton icon={<Trash2 size={15} />} label="削除" onClick={onDelete} variant="danger" />

          <div className="flex-1" />

          {/* AI actions */}
          <button
            onClick={handleSummarize}
            disabled={summarizing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 disabled:opacity-50 transition-colors"
          >
            <Sparkles size={13} />
            {summarizing ? '要約中…' : '要約'}
          </button>

          <button
            onClick={handleClassify}
            disabled={classifying}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors"
          >
            <Sparkles size={13} />
            {classifying ? '分類中…' : 'AI分類'}
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
                <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1">
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
      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
        {email.bodyHtml ? (
          <div
            className="email-body"
            dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
          />
        ) : (
          <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
            {email.bodyText}
          </pre>
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
      <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <AiReplyBar email={email} onReply={onReply} />
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

function AiReplyBar({ email, onReply }: {
  email: Email;
  onReply: () => void;
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
      <div className="flex items-center gap-2">
        <button
          onClick={onReply}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <Reply size={14} />
          返信
        </button>

        <div className="flex-1" />

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
  icon, label, onClick, variant = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors',
        variant === 'danger'
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
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

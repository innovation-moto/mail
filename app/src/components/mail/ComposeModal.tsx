'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Minimize2, Maximize2, Send, Paperclip, Sparkles, ChevronDown, PenLine, ChevronRight } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { ComposeData, Signature, EmailAddress } from '@/types/shared';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ipc';

/**
 * 宛先入力（カンマ区切り）。最後のトークンを過去の送受信履歴から補完する。
 * ↑↓で選択 / Enter・Tab・クリックで確定 / Escで閉じる。
 */
function RecipientInput({
  value,
  onChange,
  accountId,
  placeholder,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  accountId: string;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<EmailAddress[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastToken = (v: string) => {
    const idx = v.lastIndexOf(',');
    return (idx === -1 ? v : v.slice(idx + 1)).trim();
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const token = lastToken(value);
    if (!accountId || token.length < 1) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      api.mail.contactSuggestions(accountId, token, 8).then((list) => {
        const used = new Set(
          value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
        );
        const filtered = list.filter((c) => !used.has(c.address.toLowerCase()));
        setSuggestions(filtered);
        setActive(0);
        setOpen(filtered.length > 0);
      }).catch(() => {});
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, accountId]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function applySuggestion(c: EmailAddress) {
    const idx = value.lastIndexOf(',');
    const prefix = idx === -1 ? '' : `${value.slice(0, idx + 1)} `;
    onChange(`${prefix}${c.address}, `);
    setOpen(false);
    setSuggestions([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applySuggestion(suggestions[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn('w-full', className)}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          {suggestions.map((c, i) => (
            <button
              key={c.address}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); applySuggestion(c); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'w-full text-left px-3 py-1.5 flex flex-col',
                i === active ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
              )}
            >
              {c.name && <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{c.name}</span>}
              <span className={cn('truncate', c.name ? 'text-xs text-gray-500' : 'text-sm text-gray-800 dark:text-gray-200')}>
                {c.address}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComposeModal() {
  const { selectedAccountId, accounts } = useAccountStore();
  const { sendEmail } = useMailStore();
  const { closeModal, composeState } = useUIStore();

  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [fromAccountId, setFromAccountId] = useState(selectedAccountId ?? '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [showSignatureMenu, setShowSignatureMenu] = useState(false);
  const [quotedContent, setQuotedContent] = useState<string | null>(null);
  const [showQuoted, setShowQuoted] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ filename: string; content: string; contentType: string; size: number }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const { replyTo, replyAll, forwardFrom } = composeState;

  const SIGNATURE_SEPARATOR = '\n\n';

  function buildBodyWithSignature(baseBody: string, sig: Signature | null): string {
    const stripped = baseBody.includes(SIGNATURE_SEPARATOR)
      ? baseBody.slice(0, baseBody.lastIndexOf(SIGNATURE_SEPARATOR))
      : baseBody;
    return sig ? `${stripped}${SIGNATURE_SEPARATOR}${sig.content}` : stripped;
  }

  useEffect(() => {
    // 返信・転送の内容をまず設定
    if (replyTo) {
      const myEmail = accounts.find((a) => a.id === fromAccountId)?.email ?? '';
      // 返信先アドレスの決定:
      // 1. Reply-To ヘッダーがあればそれを優先
      // 2. 自分が送ったメール（from が自分）への返信は、To の最初のアドレスを使用
      // 3. それ以外は From アドレス
      const replyAddress =
        replyTo.replyToAddress ||
        (replyTo.from.address === myEmail
          ? (replyTo.to.find((t) => t.address !== myEmail)?.address ?? replyTo.from.address)
          : replyTo.from.address);
      setTo(replyAddress);
      setSubject(`Re: ${replyTo.subject.replace(/^Re:\s*/i, '')}`);
      if (replyAll) {
        const ccAddrs = [...replyTo.to, ...(replyTo.cc ?? [])]
          .map((a) => a.address)
          .filter((addr) => addr !== myEmail && addr !== replyAddress);
        if (ccAddrs.length > 0) {
          setCc(ccAddrs.join(', '));
          setShowCcBcc(true);
        }
      }
      if (replyTo.bodyText) {
        const date = new Date(replyTo.date).toLocaleString('ja-JP');
        const header = `${date}, ${replyTo.from.name || replyTo.from.address} <${replyTo.from.address}>:`;
        const quotedBody = replyTo.bodyText.split('\n').map((l) => `> ${l}`).join('\n');
        setQuotedContent(`${header}\n${quotedBody}`);
      }
    } else if (forwardFrom) {
      setSubject(`Fwd: ${forwardFrom.subject.replace(/^Fwd:\s*/i, '')}`);
      const date = new Date(forwardFrom.date).toLocaleString('ja-JP');
      const header = `---------- 転送メッセージ ----------\n差出人: ${forwardFrom.from.address}\n件名: ${forwardFrom.subject}\n日時: ${date}`;
      setQuotedContent(`${header}\n${forwardFrom.bodyText}`);
    }
    setBody('');

    // 署名を非同期で読み込んで追記
    api.signatures.list(fromAccountId || undefined).then((sigs) => {
      setSignatures(sigs);
      const def = sigs.find((s) => s.isDefault) ?? null;
      setSelectedSignatureId(def?.id ?? null);
      if (def) setBody(buildBodyWithSignature('', def));
    }).catch(() => {});
  }, []);

  // 返信・転送時は本文にフォーカス（宛先は入力済みのため）
  useEffect(() => {
    if (replyTo || replyAll || forwardFrom) {
      // DOM描画後にフォーカス
      const id = setTimeout(() => {
        if (bodyRef.current) {
          bodyRef.current.focus();
          bodyRef.current.setSelectionRange(0, 0);
          bodyRef.current.scrollTop = 0;
        }
      }, 50);
      return () => clearTimeout(id);
    }
  }, [!!replyTo, !!replyAll, !!forwardFrom]);

  function handleSignatureChange(sigId: string | null) {
    const sig = sigId ? signatures.find((s) => s.id === sigId) ?? null : null;
    setSelectedSignatureId(sigId);
    setBody((prev) => buildBodyWithSignature(prev, sig));
    setShowSignatureMenu(false);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const results = await Promise.all(files.map((file) => new Promise<{ filename: string; content: string; contentType: string; size: number }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve({ filename: file.name, content: base64, contentType: file.type || 'application/octet-stream', size: file.size });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    })));
    setAttachments((prev) => [...prev, ...results]);
    e.target.value = '';
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  async function handleSend() {
    const toAddresses = to.split(',').map((s) => s.trim()).filter(Boolean);
    if (toAddresses.length === 0 || !fromAccountId) return;
    setSending(true);
    try {
      const quotedText = quotedContent && quotedContent.trim() !== ''
        ? `\n\n${quotedContent}`
        : '';
      const data: ComposeData = {
        accountId: fromAccountId,
        to: toAddresses,
        cc: cc ? cc.split(',').map((s) => s.trim()).filter(Boolean) : [],
        bcc: bcc ? bcc.split(',').map((s) => s.trim()).filter(Boolean) : [],
        subject,
        bodyText: body + quotedText,
        replyToMessageId: replyTo?.messageId,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
      await sendEmail(data);
      closeModal();
    } catch (err) {
      alert(`送信エラー: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cn(
      'fixed z-50 shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col',
      expanded
        ? 'inset-0 rounded-none'
        : 'bottom-0 right-0 w-full md:bottom-4 md:right-4 md:w-[560px] rounded-t-2xl md:rounded-xl border-t md:border',
    )}>
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-100 dark:bg-gray-700 cursor-move flex-shrink-0">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {replyTo ? '返信' : forwardFrom ? '転送' : '新規メール'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500"
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={closeModal}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {(
        <>
          {/* Fields */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            {/* From */}
            {accounts.length > 1 && (
              <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-xs text-gray-500 w-12 flex-shrink-0">差出人</span>
                <select
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.email}</option>
                  ))}
                </select>
              </div>
            )}

            {/* To */}
            <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-xs text-gray-500 w-12 flex-shrink-0">宛先</span>
              <RecipientInput
                value={to}
                onChange={setTo}
                accountId={fromAccountId}
                placeholder="メールアドレス"
                autoFocus={!replyTo && !replyAll && !forwardFrom}
                className="text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
              />
              <button
                onClick={() => setShowCcBcc(!showCcBcc)}
                className="text-xs text-gray-400 hover:text-gray-600 px-1"
              >
                Cc/Bcc
              </button>
            </div>

            {showCcBcc && (
              <>
                <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-xs text-gray-500 w-12 flex-shrink-0">Cc</span>
                  <RecipientInput
                    value={cc}
                    onChange={setCc}
                    accountId={fromAccountId}
                    placeholder="Cc"
                    className="text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
                  />
                </div>
                <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-xs text-gray-500 w-12 flex-shrink-0">Bcc</span>
                  <RecipientInput
                    value={bcc}
                    onChange={setBcc}
                    accountId={fromAccountId}
                    placeholder="Bcc"
                    className="text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
                  />
                </div>
              </>
            )}

            {/* Subject */}
            <div className="flex items-center px-4 py-2">
              <span className="text-xs text-gray-500 w-12 flex-shrink-0">件名</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="件名"
                className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Body */}
          <div className={cn('flex flex-col', expanded && 'flex-1')}>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="本文を入力…"
              rows={expanded ? undefined : (quotedContent ? 6 : 12)}
              className={cn('w-full px-4 py-3 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400 resize-none', expanded && 'flex-1')}
            />
            {quotedContent && quotedContent.trim() !== '' && (
              <div className="px-4 pb-3">
                <button
                  onClick={() => setShowQuoted((v) => !v)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-2 transition-colors"
                >
                  <ChevronRight
                    size={13}
                    className={cn('transition-transform', showQuoted && 'rotate-90')}
                  />
                  {showQuoted ? '元のメッセージを隠す' : '元のメッセージを表示'}
                </button>
                {showQuoted && (
                  <div className="rounded-r-md border-l-[3px] border-blue-400 dark:border-blue-500 bg-blue-50/40 dark:bg-blue-900/10 pl-3 pr-2 py-2">
                    <textarea
                      value={quotedContent}
                      onChange={(e) => setQuotedContent(e.target.value)}
                      rows={Math.min(14, Math.max(3, quotedContent.split('\n').length))}
                      className="w-full max-h-56 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap leading-relaxed bg-transparent outline-none resize-y"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 添付ファイル一覧 */}
          {attachments.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-1.5">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-xs">
                  <Paperclip size={11} className="text-blue-500 flex-shrink-0" />
                  <span className="text-blue-700 dark:text-blue-300 max-w-32 truncate">{att.filename}</span>
                  <span className="text-blue-400">{formatSize(att.size)}</span>
                  <button onClick={() => removeAttachment(i)} className="text-blue-400 hover:text-blue-600 ml-0.5">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
            <button
              onClick={handleSend}
              disabled={sending || !to.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Send size={14} />
              {sending ? '送信中…' : '送信'}
            </button>
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
                title="添付ファイル"
              >
                <Paperclip size={15} />
              </button>
              {signatures.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowSignatureMenu((v) => !v)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1.5 rounded text-xs hover:bg-gray-200 dark:hover:bg-gray-700',
                      selectedSignatureId ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500',
                    )}
                    title="署名"
                  >
                    <PenLine size={13} />
                    <span className="hidden sm:inline">{selectedSignatureId ? signatures.find((s) => s.id === selectedSignatureId)?.name : '署名なし'}</span>
                    <ChevronDown size={11} />
                  </button>
                  {showSignatureMenu && (
                    <div className="absolute bottom-full right-0 mb-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-10">
                      <button
                        onClick={() => handleSignatureChange(null)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-700',
                          !selectedSignatureId ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300',
                        )}
                      >
                        署名なし
                      </button>
                      {signatures.map((sig) => (
                        <button
                          key={sig.id}
                          onClick={() => handleSignatureChange(sig.id)}
                          className={cn(
                            'w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-700',
                            selectedSignatureId === sig.id ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300',
                          )}
                        >
                          {sig.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

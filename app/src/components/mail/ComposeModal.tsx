'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Minimize2, Maximize2, Send, Paperclip, Sparkles, ChevronDown, PenLine, ChevronRight } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { ComposeData, Signature } from '@/types/shared';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ipc';

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
  const [quotedContent, setQuotedContent] = useState<{ header: string; body: string } | null>(null);
  const [showQuoted, setShowQuoted] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ filename: string; content: string; contentType: string; size: number }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setTo(replyTo.from.address);
      setSubject(`Re: ${replyTo.subject.replace(/^Re:\s*/i, '')}`);
      if (replyAll) {
        const myEmail = accounts.find((a) => a.id === fromAccountId)?.email ?? '';
        const ccAddrs = [...replyTo.to, ...(replyTo.cc ?? [])]
          .map((a) => a.address)
          .filter((addr) => addr !== myEmail && addr !== replyTo.from.address);
        if (ccAddrs.length > 0) {
          setCc(ccAddrs.join(', '));
          setShowCcBcc(true);
        }
      }
      if (replyTo.bodyText) {
        const date = new Date(replyTo.date).toLocaleString('ja-JP');
        setQuotedContent({
          header: `${date}, ${replyTo.from.name || replyTo.from.address} <${replyTo.from.address}>:`,
          body: replyTo.bodyText,
        });
      }
    } else if (forwardFrom) {
      setSubject(`Fwd: ${forwardFrom.subject.replace(/^Fwd:\s*/i, '')}`);
      const date = new Date(forwardFrom.date).toLocaleString('ja-JP');
      setQuotedContent({
        header: `---------- 転送メッセージ ----------\n差出人: ${forwardFrom.from.address}\n件名: ${forwardFrom.subject}\n日時: ${date}`,
        body: forwardFrom.bodyText,
      });
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
      const quotedText = quotedContent
        ? `\n\n${quotedContent.header}\n${quotedContent.body.split('\n').map((l) => `> ${l}`).join('\n')}`
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
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="メールアドレス"
                className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
                autoFocus
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
                  <input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="Cc"
                    className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
                  />
                </div>
                <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-xs text-gray-500 w-12 flex-shrink-0">Bcc</span>
                  <input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="Bcc"
                    className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400"
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
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="本文を入力…"
              rows={expanded ? undefined : (quotedContent ? 6 : 12)}
              className={cn('w-full px-4 py-3 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400 resize-none', expanded && 'flex-1')}
            />
            {quotedContent && (
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
                  <div className="max-h-48 overflow-y-auto border-l-2 border-gray-300 dark:border-gray-600 pl-3">
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 whitespace-pre-wrap">{quotedContent.header}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">{quotedContent.body}</p>
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

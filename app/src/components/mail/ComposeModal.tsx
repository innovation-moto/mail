'use client';
import { useState, useEffect } from 'react';
import { X, Minimize2, Maximize2, Send, Paperclip, Sparkles, ChevronDown } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { ComposeData } from '@/types/shared';
import { cn } from '@/lib/utils';

export function ComposeModal() {
  const { selectedAccountId, accounts } = useAccountStore();
  const { sendEmail } = useMailStore();
  const { closeModal, composeState } = useUIStore();

  const [minimized, setMinimized] = useState(false);
  const [sending, setSending] = useState(false);
  const [fromAccountId, setFromAccountId] = useState(selectedAccountId ?? '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);

  const { replyTo, forwardFrom } = composeState;

  useEffect(() => {
    if (replyTo) {
      setTo(replyTo.from.address);
      setSubject(`Re: ${replyTo.subject.replace(/^Re:\s*/i, '')}`);
      setBody(replyTo.bodyText
        ? `\n\n---\n${replyTo.from.name || replyTo.from.address} の返信:\n${replyTo.bodyText}`
        : '');
    }
    if (forwardFrom) {
      setSubject(`Fwd: ${forwardFrom.subject.replace(/^Fwd:\s*/i, '')}`);
      setBody(
        `\n\n---------- 転送メッセージ ----------\n差出人: ${forwardFrom.from.address}\n件名: ${forwardFrom.subject}\n\n${forwardFrom.bodyText}`,
      );
    }
  }, []);

  async function handleSend() {
    if (!to.trim() || !fromAccountId) return;
    setSending(true);
    try {
      const data: ComposeData = {
        accountId: fromAccountId,
        to: to.split(',').map((s) => s.trim()).filter(Boolean),
        cc: cc ? cc.split(',').map((s) => s.trim()).filter(Boolean) : [],
        bcc: bcc ? bcc.split(',').map((s) => s.trim()).filter(Boolean) : [],
        subject,
        bodyText: body,
        replyToMessageId: replyTo?.messageId,
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
    <div className="fixed bottom-4 right-4 z-50 w-[560px] shadow-2xl rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-100 dark:bg-gray-700 cursor-move">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {replyTo ? '返信' : forwardFrom ? '転送' : '新規メール'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(!minimized)}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500"
          >
            {minimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
          <button
            onClick={closeModal}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {!minimized && (
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
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="本文を入力…"
            rows={12}
            className="w-full px-4 py-3 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder:text-gray-400 resize-none"
          />

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
              <button className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" title="添付ファイル">
                <Paperclip size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

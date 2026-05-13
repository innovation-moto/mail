'use client';
import { useState } from 'react';
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useUIStore } from '@/store/uiStore';
import { AccountConfig, PROVIDER_PRESETS, TestConnectionResult } from '@shared/types';

const PROVIDERS = [
  { id: 'gmail', name: 'Gmail' },
  { id: 'outlook', name: 'Outlook' },
  { id: 'yahoo', name: 'Yahoo! Mail' },
  { id: 'custom', name: 'カスタム' },
];

export function AccountSetupModal() {
  const { createAccount, testConnection } = useAccountStore();
  const { closeModal } = useUIStore();
  const [provider, setProvider] = useState('gmail');
  const [form, setForm] = useState<Partial<AccountConfig>>({ ...PROVIDER_PRESETS.gmail, provider: 'gmail' });
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [tested, setTested] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(key: keyof AccountConfig, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTested(false);
    setTestResult(null);
  }

  function handleProviderChange(id: string) {
    setProvider(id);
    const preset = PROVIDER_PRESETS[id] ?? {};
    setForm((prev) => ({ ...prev, provider: id, ...preset }));
    setTested(false);
    setTestResult(null);
  }

  async function handleTest() {
    setLoading(true);
    setError('');
    try {
      const result = await testConnection(form as AccountConfig);
      setTestResult(result);
      setTested(true);
      if (!result.imap || !result.smtp) {
        setError([
          !result.imap && `IMAP: ${result.imapError}`,
          !result.smtp && `SMTP: ${result.smtpError}`,
        ].filter(Boolean).join(' / '));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setLoading(true);
    setError('');
    try {
      await createAccount(form as AccountConfig);
      closeModal();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">アカウントを追加</h2>
          <button onClick={closeModal} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Provider */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">プロバイダ</label>
            <div className="grid grid-cols-4 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id)}
                  className={`py-2 px-2 text-xs rounded-lg border-2 font-medium transition-colors ${
                    provider === p.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <Field label="名前" value={form.name ?? ''} onChange={(v) => update('name', v)} placeholder="表示名" />
          <Field label="メールアドレス" value={form.email ?? ''} onChange={(v) => update('email', v)} placeholder="you@gmail.com" type="email" />
          <Field label="パスワード" value={form.password ?? ''} onChange={(v) => update('password', v)} placeholder="アプリパスワード" type="password" />

          {provider === 'custom' && (
            <>
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-3">
                  <Field label="IMAPホスト" value={form.imapHost ?? ''} onChange={(v) => update('imapHost', v)} placeholder="imap.example.com" />
                </div>
                <Field label="ポート" value={String(form.imapPort ?? 993)} onChange={(v) => update('imapPort', parseInt(v))} placeholder="993" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-3">
                  <Field label="SMTPホスト" value={form.smtpHost ?? ''} onChange={(v) => update('smtpHost', v)} placeholder="smtp.example.com" />
                </div>
                <Field label="ポート" value={String(form.smtpPort ?? 587)} onChange={(v) => update('smtpPort', parseInt(v))} placeholder="587" />
              </div>
            </>
          )}

          {error && (
            <div className="flex gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {tested && testResult?.imap && testResult?.smtp && (
            <div className="flex gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <CheckCircle size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-green-600 dark:text-green-400">接続成功！アカウントを保存できます。</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleTest}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && !tested ? <Loader2 size={14} className="animate-spin" /> : null}
            接続テスト
          </button>
          <button
            onClick={handleSave}
            disabled={loading || (!tested && !(testResult?.imap && testResult?.smtp))}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2"
          >
            {loading && tested ? <Loader2 size={14} className="animate-spin" /> : null}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
      />
    </div>
  );
}

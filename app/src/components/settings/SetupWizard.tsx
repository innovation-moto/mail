'use client';
import { useState } from 'react';
import { Mail, CheckCircle, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useUIStore } from '@/store/uiStore';
import { AccountConfig, PROVIDER_PRESETS, TestConnectionResult } from '@/types/shared';
import { cn } from '@/lib/utils';

const PROVIDERS = [
  { id: 'gmail', name: 'Gmail', logo: '🟥', color: 'border-red-200 hover:border-red-400' },
  { id: 'outlook', name: 'Outlook', logo: '🟦', color: 'border-blue-200 hover:border-blue-400' },
  { id: 'yahoo', name: 'Yahoo! Mail', logo: '🟪', color: 'border-purple-200 hover:border-purple-400' },
  { id: 'custom', name: 'その他 (カスタム)', logo: '⚙️', color: 'border-gray-200 hover:border-gray-400' },
];

export function SetupWizard() {
  const { createAccount } = useAccountStore();
  const { applyTheme } = useUIStore();
  const [step, setStep] = useState<'provider' | 'credentials' | 'testing' | 'done'>('provider');
  const [provider, setProvider] = useState('');
  const [form, setForm] = useState<Partial<AccountConfig>>({});
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function selectProvider(id: string) {
    setProvider(id);
    const preset = PROVIDER_PRESETS[id] ?? {};
    setForm({ provider: id, ...preset });
    setStep('credentials');
  }

  async function handleTest() {
    if (!form.email || !form.password || !form.imapHost || !form.smtpHost) {
      setError('必須項目をすべて入力してください');
      return;
    }
    setLoading(true);
    setError('');
    setStep('testing');
    try {
      const { testConnection } = useAccountStore.getState();
      const result = await testConnection(form as AccountConfig);
      setTestResult(result);
      if (result.imap && result.smtp) {
        setStep('done');
      } else {
        setStep('credentials');
        setError([
          !result.imap && `IMAP: ${result.imapError ?? '接続失敗'}`,
          !result.smtp && `SMTP: ${result.smtpError ?? '接続失敗'}`,
        ].filter(Boolean).join(' / '));
      }
    } catch (err) {
      setStep('credentials');
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!form.name) {
      setError('名前を入力してください');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await createAccount(form as AccountConfig);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function update(key: keyof AccountConfig, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900 items-center justify-center p-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Mail className="text-white" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Mail へようこそ</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">メールアカウントを追加して始めましょう</p>
        </div>

        {/* Step: provider selection */}
        {step === 'provider' && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">メールプロバイダを選択</h2>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProvider(p.id)}
                className={cn(
                  'w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 transition-all text-left bg-white dark:bg-gray-800',
                  p.color,
                  'dark:border-gray-700 dark:hover:border-gray-500',
                )}
              >
                <span className="text-2xl">{p.logo}</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">{p.name}</span>
                <ChevronRight size={16} className="ml-auto text-gray-400" />
              </button>
            ))}
          </div>
        )}

        {/* Step: credentials */}
        {(step === 'credentials' || step === 'done') && (
          <div className="space-y-3">
            <button
              onClick={() => setStep('provider')}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2"
            >
              ← プロバイダ選択に戻る
            </button>

            <Input label="名前" value={form.name ?? ''} onChange={(v) => update('name', v)} placeholder="山田 太郎" />
            <Input label="メールアドレス" value={form.email ?? ''} onChange={(v) => update('email', v)} placeholder="you@gmail.com" type="email" />
            <Input label="パスワード" value={form.password ?? ''} onChange={(v) => update('password', v)} placeholder="アプリパスワード" type="password" />

            {provider === 'custom' && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Input label="IMAPサーバー" value={form.imapHost ?? ''} onChange={(v) => update('imapHost', v)} placeholder="imap.example.com" />
                  </div>
                  <Input label="ポート" value={String(form.imapPort ?? 993)} onChange={(v) => update('imapPort', parseInt(v))} placeholder="993" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Input label="SMTPサーバー" value={form.smtpHost ?? ''} onChange={(v) => update('smtpHost', v)} placeholder="smtp.example.com" />
                  </div>
                  <Input label="ポート" value={String(form.smtpPort ?? 587)} onChange={(v) => update('smtpPort', parseInt(v))} placeholder="587" />
                </div>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {step === 'done' && testResult && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                  <CheckCircle size={16} />
                  <span className="text-sm font-medium">接続に成功しました！</span>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              {step !== 'done' ? (
                <button
                  onClick={handleTest}
                  disabled={loading}
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                  接続テスト
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                  アカウントを追加
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step: testing */}
        {step === 'testing' && (
          <div className="text-center py-8 space-y-4">
            <Loader2 size={40} className="animate-spin text-blue-500 mx-auto" />
            <p className="text-gray-600 dark:text-gray-400">サーバーに接続中…</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Input({
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
        className="w-full px-3 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/20"
      />
    </div>
  );
}

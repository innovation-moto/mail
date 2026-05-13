'use client';
import { useState, useEffect } from 'react';
import {
  X, User, Shield, Sparkles, Bell, Trash2, Plus,
  CheckCircle, AlertCircle, Loader2, Moon, Sun, Monitor,
} from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/ipc';
import { BlockEntry, Settings } from '@shared/types';
import { cn } from '@/lib/utils';

type Tab = 'accounts' | 'ai' | 'blocklist' | 'notifications' | 'appearance';

export function SettingsModal() {
  const { closeModal } = useUIStore();
  const [tab, setTab] = useState<Tab>('accounts');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'accounts', label: 'アカウント', icon: <User size={15} /> },
    { id: 'ai', label: 'AI設定', icon: <Sparkles size={15} /> },
    { id: 'blocklist', label: 'ブロックリスト', icon: <Shield size={15} /> },
    { id: 'notifications', label: '通知', icon: <Bell size={15} /> },
    { id: 'appearance', label: '外観', icon: <Sun size={15} /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl flex overflow-hidden" style={{ height: '560px' }}>
        {/* Sidebar */}
        <div className="w-48 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="flex items-center justify-between px-4 py-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">設定</h2>
            <button onClick={closeModal} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500">
              <X size={15} />
            </button>
          </div>
          <nav className="flex-1 px-2 space-y-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  tab === t.id
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {tab === 'accounts' && <AccountsTab />}
          {tab === 'ai' && <AiTab />}
          {tab === 'blocklist' && <BlocklistTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'appearance' && <AppearanceTab />}
        </div>
      </div>
    </div>
  );
}

function AccountsTab() {
  const { accounts, deleteAccount } = useAccountStore();
  const { openAccountSetup } = useUIStore();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">アカウント管理</h3>
        <button
          onClick={openAccountSetup}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus size={13} />
          追加
        </button>
      </div>
      <div className="space-y-2">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">{a.name}</div>
              <div className="text-xs text-gray-500">{a.email}</div>
              <div className="text-xs text-gray-400">{a.provider} · IMAP: {a.imapHost}:{a.imapPort}</div>
            </div>
            <button
              onClick={() => confirm(`${a.email} を削除しますか？`) && deleteAccount(a.id)}
              className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {accounts.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">アカウントがありません</p>
        )}
      </div>
    </div>
  );
}

function AiTab() {
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.ai.getApiKey().then(setApiKey);
    api.ai.isEnabled().then(setEnabled);
  }, []);

  async function handleSave() {
    if (!apiKey.trim()) { setError('APIキーを入力してください'); return; }
    setSaving(true);
    setError('');
    try {
      await api.ai.setApiKey(apiKey);
      setEnabled(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">AI設定</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Google Gemini 1.5 Flash APIを使用します。<br />
        APIキーは <a href="https://aistudio.google.com" className="text-blue-500 underline" target="_blank" rel="noreferrer">Google AI Studio</a> で無料取得できます（1日100万トークン無料）。
      </p>

      <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          ⚠️ AI機能を有効にすると、メール本文がGoogle APIに送信されます。プライバシーポリシーをご確認ください。
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Gemini APIキー</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIzaSy..."
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle size={14} /> : null}
          {saved ? '保存済み' : 'APIキーを保存'}
        </button>

        {enabled && (
          <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <CheckCircle size={14} className="text-green-500" />
            <span className="text-xs text-green-700 dark:text-green-300">AI機能が有効です</span>
          </div>
        )}
      </div>
    </div>
  );
}

function BlocklistTab() {
  const { selectedAccountId } = useAccountStore();
  const [blocklist, setBlocklist] = useState<BlockEntry[]>([]);
  const [pattern, setPattern] = useState('');
  const [type, setType] = useState<'address' | 'domain'>('address');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedAccountId) return;
    api.blocklist.list(selectedAccountId).then(setBlocklist);
  }, [selectedAccountId]);

  async function handleAdd() {
    if (!pattern.trim() || !selectedAccountId) return;
    setLoading(true);
    try {
      const result = await api.blocklist.add(selectedAccountId, pattern.trim(), type);
      setBlocklist(result);
      setPattern('');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(id: string) {
    if (!selectedAccountId) return;
    const result = await api.blocklist.remove(id, selectedAccountId);
    setBlocklist(result);
  }

  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">ブロックリスト</h3>

      <div className="flex gap-2 mb-4">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="アドレスまたはドメイン"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'address' | 'domain')}
          className="px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
        >
          <option value="address">アドレス</option>
          <option value="domain">ドメイン</option>
        </select>
        <button
          onClick={handleAdd}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="space-y-1">
        {blocklist.map((b) => (
          <div key={b.id} className="flex items-center justify-between p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">
            <div>
              <span className="text-gray-800 dark:text-gray-200">{b.pattern}</span>
              <span className="ml-2 text-xs text-gray-400">({b.type === 'address' ? 'アドレス' : 'ドメイン'})</span>
            </div>
            <button onClick={() => handleRemove(b.id)} className="p-1 text-red-400 hover:text-red-600">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {blocklist.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">ブロックリストは空です</p>
        )}
      </div>
    </div>
  );
}

function NotificationsTab() {
  const [settings, setSettings] = useState<Partial<Settings>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings.get().then(setSettings);
  }, []);

  async function update(key: keyof Settings, value: unknown) {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    setSaving(true);
    try {
      await api.settings.setAll(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">通知設定</h3>
      <div className="space-y-4">
        <Toggle
          label="新着メール通知"
          description="新しいメールを受信したときにOS通知を表示"
          checked={!!settings.notificationsEnabled}
          onChange={(v) => update('notificationsEnabled', v)}
        />
        <Toggle
          label="重要メールのみ通知"
          description="AIが「高」優先度と判断したメールのみ通知する"
          checked={!!settings.notifyHighOnly}
          onChange={(v) => update('notifyHighOnly', v)}
          disabled={!settings.notificationsEnabled}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">同期間隔</label>
          <select
            value={settings.syncIntervalSec ?? 30}
            onChange={(e) => update('syncIntervalSec', parseInt(e.target.value))}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
          >
            <option value={15}>15秒</option>
            <option value={30}>30秒</option>
            <option value={60}>1分</option>
            <option value={300}>5分</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useUIStore();
  const [settings, setSettings] = useState<Partial<Settings>>({});

  useEffect(() => {
    api.settings.get().then(setSettings);
  }, []);

  async function handleTheme(t: 'light' | 'dark' | 'system') {
    setTheme(t);
    await api.settings.set('theme', t);
  }

  const themes: { value: 'light' | 'dark' | 'system'; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'ライト', icon: <Sun size={16} /> },
    { value: 'dark', label: 'ダーク', icon: <Moon size={16} /> },
    { value: 'system', label: 'システム', icon: <Monitor size={16} /> },
  ];

  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">外観</h3>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">テーマ</label>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => handleTheme(t.value)}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
                theme === t.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300',
              )}
            >
              {t.icon}
              <span className="text-xs font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label, description, checked, onChange, disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn('flex items-start justify-between', disabled && 'opacity-50')}>
      <div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</div>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ml-4',
          checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

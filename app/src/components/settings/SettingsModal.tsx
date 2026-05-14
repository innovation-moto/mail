'use client';
import { useState, useEffect } from 'react';
import {
  X, User, Shield, Sparkles, Bell, Trash2, Plus, Pencil, Check,
  CheckCircle, Loader2, Moon, Sun, Monitor,
  Filter, FolderPlus, FolderOpen, ChevronDown, ChevronUp, Camera, PenLine, Star,
} from 'lucide-react';
import { useAccountStore } from '@/store/accountStore';
import { useMailStore } from '@/store/mailStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/ipc';
import { BlockEntry, Settings, FilterRule, FilterCondition, Signature } from '@/types/shared';
import { cn } from '@/lib/utils';

type Tab = 'accounts' | 'signatures' | 'ai' | 'blocklist' | 'filters' | 'folders' | 'notifications' | 'appearance';

export function SettingsModal() {
  const { closeModal } = useUIStore();
  const [tab, setTab] = useState<Tab>('accounts');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'accounts', label: 'アカウント', icon: <User size={15} /> },
    { id: 'signatures', label: '署名', icon: <PenLine size={15} /> },
    { id: 'filters', label: 'フィルター', icon: <Filter size={15} /> },
    { id: 'folders', label: 'フォルダ管理', icon: <FolderOpen size={15} /> },
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
          {tab === 'signatures' && <SignaturesTab />}
          {tab === 'filters' && <FiltersTab />}
          {tab === 'folders' && <FoldersTab />}
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
  const { accounts, deleteAccount, updateAccount } = useAccountStore();
  const { openAccountSetup } = useUIStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  function startEdit(id: string, currentName: string) {
    setEditingId(id);
    setEditingName(currentName);
  }

  async function saveEdit(id: string) {
    if (!editingName.trim()) return;
    await updateAccount(id, { name: editingName.trim() });
    setEditingId(null);
  }

  async function handleAvatarChange(id: string, file: File) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      // リサイズ: 最大128x128
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
        const resized = canvas.toDataURL('image/jpeg', 0.85);
        await updateAccount(id, { avatar: resized } as never);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

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
          <div key={a.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              {/* アバター */}
              <label className="relative flex-shrink-0 cursor-pointer group">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  {a.avatar ? (
                    <img src={a.avatar} alt={a.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-gray-500 dark:text-gray-400">
                      {a.name?.[0]?.toUpperCase() ?? a.email[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera size={14} className="text-white" />
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleAvatarChange(a.id, e.target.files[0])}
                />
              </label>

              <div className="flex-1 min-w-0">
                {editingId === a.id ? (
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(a.id); if (e.key === 'Escape') setEditingId(null); }}
                      className="flex-1 text-sm px-2 py-1 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none"
                      placeholder="表示名"
                    />
                    <button
                      onClick={() => saveEdit(a.id)}
                      className="p-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Check size={13} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{a.name}</div>
                )}
                <div className="text-xs text-gray-500">{a.email}</div>
                <div className="text-xs text-gray-400">{a.provider} · IMAP: {a.imapHost}:{a.imapPort}</div>
              </div>
              {editingId !== a.id && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(a.id, a.name)}
                    className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
                    title="表示名を編集"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => confirm(`${a.email} を削除しますか？`) && deleteAccount(a.id)}
                    className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                    title="削除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {accounts.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">アカウントがありません</p>
        )}
      </div>
    </div>
  );
}

function SignaturesTab() {
  const { accounts } = useAccountStore();
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', content: '', accountId: null as string | null, isDefault: false });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    api.signatures.list().then(setSignatures);
  }, []);

  async function handleCreate() {
    if (!form.name.trim() || !form.content.trim()) return;
    const updated = await api.signatures.create({ ...form, isDefault: form.isDefault });
    if (updated) setSignatures(updated);
    setShowForm(false);
    setForm({ name: '', content: '', accountId: null, isDefault: false });
  }

  async function handleUpdate() {
    if (!editingId || !form.name.trim() || !form.content.trim()) return;
    const updated = await api.signatures.update(editingId, { ...form });
    if (updated) setSignatures(updated);
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm('この署名を削除しますか？')) return;
    const updated = await api.signatures.delete(id);
    if (updated) setSignatures(updated);
  }

  function startEdit(sig: Signature) {
    setEditingId(sig.id);
    setForm({ name: sig.name, content: sig.content, accountId: sig.accountId, isDefault: sig.isDefault });
    setShowForm(false);
  }

  const signatureFormJsx = (onSave: () => void, onCancel: () => void) => (
    <div className="space-y-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">署名名</label>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="例：会社署名"
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">アカウント</label>
        <select
          value={form.accountId ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value || null }))}
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none"
        >
          <option value="">すべてのアカウント</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">署名内容</label>
        <textarea
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          placeholder={'--\n佐渡 元樹\n株式会社INNOVATION MUSIC\ntel: 000-0000-0000'}
          rows={6}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500 resize-none font-mono"
        />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
          className="rounded"
        />
        <span className="text-xs text-gray-600 dark:text-gray-400">デフォルト署名に設定</span>
      </label>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
          キャンセル
        </button>
        <button onClick={onSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
          保存
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">署名管理</h3>
        {!showForm && !editingId && (
          <button
            onClick={() => { setShowForm(true); setForm({ name: '', content: '', accountId: null, isDefault: false }); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus size={13} />
            追加
          </button>
        )}
      </div>

      <div className="space-y-3">
        {showForm && signatureFormJsx(handleCreate, () => setShowForm(false))}

        {signatures.map((sig) => (
          <div key={sig.id}>
            {editingId === sig.id ? (
              signatureFormJsx(handleUpdate, () => setEditingId(null))
            ) : (
              <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{sig.name}</span>
                      {sig.isDefault && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                          <Star size={9} />
                          デフォルト
                        </span>
                      )}
                      {sig.accountId && (
                        <span className="text-[10px] text-gray-400">{accounts.find((a) => a.id === sig.accountId)?.email}</span>
                      )}
                    </div>
                    <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-mono line-clamp-3">{sig.content}</pre>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(sig)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDelete(sig.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {signatures.length === 0 && !showForm && (
          <p className="text-sm text-gray-400 text-center py-8">署名がありません</p>
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
        OpenAI (gpt-4o-mini) を使用します。<br />
        APIキーは <a href="https://platform.openai.com/api-keys" className="text-blue-500 underline" target="_blank" rel="noreferrer">OpenAI Platform</a> で取得できます。新規登録で $5 の無料クレジットがあります。
      </p>

      <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          ⚠️ AI機能を有効にすると、メール本文がOpenAI APIに送信されます。プライバシーポリシーをご確認ください。
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">OpenAI APIキー</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
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
      if (result) setBlocklist(result);
      setPattern('');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(id: string) {
    if (!selectedAccountId) return;
    const result = await api.blocklist.remove(id, selectedAccountId);
    if (result) setBlocklist(result);
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

// ─── Filters Tab ────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = { from: '差出人', to: '宛先', subject: '件名', body: '本文' };
const OP_LABELS: Record<string, string> = { contains: 'を含む', equals: '完全一致', startsWith: 'で始まる', endsWith: 'で終わる' };

function FiltersTab() {
  const { selectedAccountId } = useAccountStore();
  const { folders } = useMailStore();
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [editing, setEditing] = useState<FilterRule | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (selectedAccountId) api.filters.list(selectedAccountId).then((r: FilterRule[]) => setFilters(r));
  }, [selectedAccountId]);

  async function handleDelete(id: string) {
    if (!confirm('このフィルターを削除しますか？')) return;
    await api.filters.delete(id);
    setFilters((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleToggle(f: FilterRule) {
    await api.filters.update(f.id, { active: !f.active });
    setFilters((prev) => prev.map((x) => x.id === f.id ? { ...x, active: !f.active } : x));
  }

  async function handleSave(data: Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>) {
    if (!selectedAccountId) return;
    if (editing) {
      await api.filters.update(editing.id, data);
      setFilters((prev) => prev.map((x) => x.id === editing.id ? { ...x, ...data } : x));
      setEditing(null);
    } else {
      const created = await api.filters.create(selectedAccountId, data) as FilterRule;
      setFilters((prev) => [...prev, created]);
      setCreating(false);
    }
  }

  const DUPLICATE_PATTERNS = [
    /ゴミ箱/i, /trash/i, /deleted/i,
    /スター/i, /starred/i,
    /送信済み/i, /sent/i,
    /下書き/i, /draft/i,
    /迷惑/i, /spam/i, /junk/i,
    /重要/i, /important/i,
    /すべてのメール/i, /all\s*mail/i,
    /^\[gmail\]$/i,
  ];
  const allFolders = folders
    .filter((f) => !DUPLICATE_PATTERNS.some((re) => re.test(f.path) || re.test(f.name)))
    .map((f) => f.path);

  if (creating || editing) {
    return (
      <FilterForm
        initial={editing ?? undefined}
        folders={allFolders}
        onSave={handleSave}
        onCancel={() => { setCreating(false); setEditing(null); }}
      />
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">フィルタールール</h3>
          <p className="text-xs text-gray-500 mt-0.5">条件に一致する受信メールを自動振り分け・既読化します</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus size={13} /> 新規ルール
        </button>
      </div>

      {filters.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <Filter size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">フィルタールールがありません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filters.map((f) => (
            <div key={f.id} className={cn('p-3 rounded-lg border transition-colors', f.active ? 'border-gray-200 dark:border-gray-700' : 'border-dashed border-gray-300 dark:border-gray-600 opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{f.name || 'ルール'}</span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded-full', f.active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700')}>
                      {f.active ? '有効' : '無効'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                    {f.conditions.map((c, i) => (
                      <span key={i} className="mr-2">{FIELD_LABELS[c.field]} {OP_LABELS[c.operator]} 「{c.value}」</span>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    {f.actionFolder && <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">→ {f.actionFolder}</span>}
                    {f.actionMarkRead && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">既読</span>}
                    {f.actionStarred && <span className="text-xs bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded-full">★スター</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleToggle(f)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 text-xs">{f.active ? '無効化' : '有効化'}</button>
                  <button onClick={() => setEditing(f)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 text-xs">編集</button>
                  <button onClick={() => handleDelete(f.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterForm({ initial, folders, onSave, onCancel }: {
  initial?: FilterRule;
  folders: string[];
  onSave: (data: Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [conditionType, setConditionType] = useState<'all' | 'any'>(initial?.conditionType ?? 'any');
  const [conditions, setConditions] = useState<FilterCondition[]>(
    initial?.conditions.length ? initial.conditions : [{ field: 'from', operator: 'contains', value: '' }]
  );
  const [actionFolder, setActionFolder] = useState(initial?.actionFolder ?? '');
  const [actionMarkRead, setActionMarkRead] = useState(initial?.actionMarkRead ?? false);
  const [actionStarred, setActionStarred] = useState(initial?.actionStarred ?? false);
  const [saving, setSaving] = useState(false);

  function updateCondition(i: number, patch: Partial<FilterCondition>) {
    setConditions((prev) => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  async function handleSubmit() {
    if (conditions.some((c) => !c.value.trim())) return;
    setSaving(true);
    await onSave({ name, conditionType, conditions, actionFolder: actionFolder || null, actionMarkRead, actionStarred, active: true });
    setSaving(false);
  }

  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">{initial ? 'フィルター編集' : '新規フィルター'}</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">ルール名（任意）</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: ニュースレター" className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">条件</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">マッチ:</span>
              <select value={conditionType} onChange={(e) => setConditionType(e.target.value as 'all' | 'any')} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="any">いずれか (OR)</option>
                <option value="all">すべて (AND)</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value as FilterCondition['field'] })} className="text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                  {Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={c.operator} onChange={(e) => updateCondition(i, { operator: e.target.value as FilterCondition['operator'] })} className="text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                  {Object.entries(OP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="値" className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500" />
                {conditions.length > 1 && <button onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>}
              </div>
            ))}
            <button onClick={() => setConditions((prev) => [...prev, { field: 'from', operator: 'contains', value: '' }])} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1">
              <Plus size={12} /> 条件を追加
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">アクション</label>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600 dark:text-gray-400 w-24">フォルダに移動</span>
              <select value={actionFolder} onChange={(e) => setActionFolder(e.target.value)} className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">移動しない</option>
                {folders.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={actionMarkRead} onChange={(e) => setActionMarkRead(e.target.checked)} className="rounded" /> 既読にする
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={actionStarred} onChange={(e) => setActionStarred(e.target.checked)} className="rounded" /> スターを付ける
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm">
            {saving && <Loader2 size={13} className="animate-spin" />} 保存
          </button>
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">キャンセル</button>
        </div>
      </div>
    </div>
  );
}

// ─── Folders Tab ─────────────────────────────────────────────────────────────

function FoldersTab() {
  const { selectedAccountId } = useAccountStore();
  const { folders, loadFolders } = useMailStore();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  const customFolders = folders.filter((f) =>
    !['INBOX', 'Sent', 'Drafts', 'Trash', 'Starred', 'Spam', 'Junk'].includes(f.path) &&
    !f.path.startsWith('[Gmail]')
  );
  const systemFolders = folders.filter((f) =>
    ['INBOX', 'Sent', 'Drafts', 'Trash', 'Spam', 'Junk'].includes(f.path) ||
    f.path.startsWith('[Gmail]')
  );

  async function handleCreate() {
    if (!newName.trim() || !selectedAccountId) return;
    setCreating(true);
    setError('');
    try {
      await api.folders.create(selectedAccountId, newName.trim());
      await loadFolders(selectedAccountId);
      setNewName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(path: string) {
    if (!selectedAccountId) return;
    if (!confirm(`「${path}」を削除しますか？メールボックス内のメールも削除されます。`)) return;
    setDeleting(path);
    try {
      await api.folders.delete(selectedAccountId, path);
      await loadFolders(selectedAccountId);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">フォルダ管理</h3>
      <p className="text-xs text-gray-500 mb-4">Gmail ラベルとして作成されます</p>

      <div className="flex gap-2 mb-5">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} placeholder="新しいフォルダ名" className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:border-blue-500" />
        <button onClick={handleCreate} disabled={creating || !newName.trim()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm">
          {creating ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />} 作成
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {customFolders.length > 0 && (
        <>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">カスタムフォルダ</p>
          <div className="space-y-1 mb-4">
            {customFolders.map((f) => (
              <div key={f.path} className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">
                <span className="text-sm text-gray-800 dark:text-gray-200">{f.name}</span>
                <button onClick={() => handleDelete(f.path)} disabled={deleting === f.path} className="p-1 text-red-400 hover:text-red-600 disabled:opacity-40">
                  {deleting === f.path ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">システムフォルダ</p>
      <div className="space-y-1">
        {systemFolders.map((f) => (
          <div key={f.path} className="flex items-center px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800">
            <span className="text-sm text-gray-500 dark:text-gray-400">{f.path}</span>
          </div>
        ))}
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

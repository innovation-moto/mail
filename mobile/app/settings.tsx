import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, TextInput,
  ScrollView, Switch, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../store/accountStore';
import { useMailStore } from '../store/mailStore';
import { mailApi } from '../lib/api';
import {
  listFilterRules, deleteFilterRule,
  listSignatures, createSignature, updateSignature, deleteSignature,
  listBlockList, addToBlockList, removeFromBlockList,
} from '../lib/db';
import { QuickFilterSheet } from '../components/QuickFilterSheet';
import type { Account, FilterRule, Signature } from '@/shared/types';

type Tab = 'accounts' | 'signatures' | 'filters' | 'folders' | 'ai' | 'blocklist';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'accounts',   label: 'アカウント',   icon: 'person-outline' },
  { id: 'signatures', label: '署名',         icon: 'pencil-outline' },
  { id: 'filters',    label: 'フィルター',   icon: 'funnel-outline' },
  { id: 'folders',    label: 'フォルダ管理', icon: 'folder-outline' },
  { id: 'ai',         label: 'AI設定',       icon: 'flash-outline' },
  { id: 'blocklist',  label: 'ブロックリスト', icon: 'shield-outline' },
];

function avatarColor(email: string): string {
  const colors = ['#007AFF','#34C759','#FF9500','#FF3B30','#AF52DE','#5856D6','#FF2D55','#00C7BE'];
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % colors.length;
  return colors[h];
}

export default function SettingsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('accounts');

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* ヘッダー */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#007AFF" />
        </TouchableOpacity>
        <Text style={s.title}>設定</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* タブナビ（横スクロール） */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabBarContent}
      >
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[s.tab, activeTab === t.id && s.tabActive]}
            onPress={() => setActiveTab(t.id)}
          >
            <Ionicons
              name={t.icon as any}
              size={15}
              color={activeTab === t.id ? '#007AFF' : '#8E8E93'}
              style={{ marginRight: 5 }}
            />
            <Text style={[s.tabText, activeTab === t.id && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* コンテンツ */}
      {activeTab === 'accounts'   && <AccountsTab router={router} />}
      {activeTab === 'signatures' && <SignaturesTab />}
      {activeTab === 'filters'    && <FiltersTab />}
      {activeTab === 'folders'    && <FoldersTab />}
      {activeTab === 'ai'         && <AiTab />}
      {activeTab === 'blocklist'  && <BlockListTab />}
    </SafeAreaView>
  );
}

// ─── アカウント ────────────────────────────────────────────────────────────────
function AccountsTab({ router }: { router: any }) {
  const { accounts, selectedAccountId, removeAccount, selectAccount } = useAccountStore();

  const handleRemove = (account: Account) => {
    Alert.alert('アカウントを削除', `${account.email} を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => removeAccount(account.id) },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.sectionLabel}>アカウント一覧</Text>
      {accounts.map((account, index) => (
        <View key={account.id}>
          <View style={s.accountCard}>
            <View style={[s.avatar, { backgroundColor: avatarColor(account.email) }]}>
              <Text style={s.avatarText}>{(account.name || account.email).charAt(0).toUpperCase()}</Text>
            </View>
            <View style={s.info}>
              <Text style={s.name}>{account.name || account.email}</Text>
              <Text style={s.email}>{account.email}</Text>
              <Text style={s.provider}>{account.imapHost}</Text>
            </View>
            <View style={s.actions}>
              {account.id !== selectedAccountId ? (
                <TouchableOpacity onPress={() => selectAccount(account.id)} style={s.iconBtn}>
                  <Ionicons name="checkmark-circle-outline" size={22} color="#007AFF" />
                </TouchableOpacity>
              ) : (
                <View style={s.activeBadge}><Text style={s.activeBadgeText}>使用中</Text></View>
              )}
              <TouchableOpacity onPress={() => handleRemove(account)} style={s.iconBtn}>
                <Ionicons name="trash-outline" size={22} color="#FF3B30" />
              </TouchableOpacity>
            </View>
          </View>
          {index < accounts.length - 1 && <View style={s.sep} />}
        </View>
      ))}
      <TouchableOpacity style={s.addBtn} onPress={() => router.push('/setup')}>
        <Ionicons name="add-circle" size={20} color="#007AFF" style={{ marginRight: 8 }} />
        <Text style={s.addBtnText}>アカウントを追加</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── 署名 ─────────────────────────────────────────────────────────────────────
type SigFormValues = { name: string; content: string; isDefault: boolean };
type SigFormProps = {
  form: SigFormValues;
  setForm: React.Dispatch<React.SetStateAction<SigFormValues>>;
  onSave: () => void;
  onCancel: () => void;
};
function SigForm({ form, setForm, onSave, onCancel }: SigFormProps) {
  return (
    <View style={s.formCard}>
      <Text style={s.formLabel}>署名名</Text>
      <TextInput
        style={s.formInput}
        value={form.name}
        onChangeText={v => setForm(f => ({ ...f, name: v }))}
        placeholder="例: 仕事用"
        placeholderTextColor="#C7C7CC"
      />
      <Text style={s.formLabel}>内容</Text>
      <TextInput
        style={[s.formInput, { height: 100, textAlignVertical: 'top' }]}
        value={form.content}
        onChangeText={v => setForm(f => ({ ...f, content: v }))}
        placeholder="署名のテキストを入力..."
        placeholderTextColor="#C7C7CC"
        multiline
      />
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>デフォルトに設定</Text>
        <Switch
          value={form.isDefault}
          onValueChange={v => setForm(f => ({ ...f, isDefault: v }))}
          trackColor={{ true: '#007AFF' }}
        />
      </View>
      <View style={s.formActions}>
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
          <Text style={s.cancelBtnText}>キャンセル</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.saveBtn} onPress={onSave}>
          <Text style={s.saveBtnText}>保存</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SignaturesTab() {
  const { selectedAccountId } = useAccountStore();
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SigFormValues>({ name: '', content: '', isDefault: false });

  useEffect(() => {
    listSignatures(selectedAccountId ?? undefined).then(setSignatures);
  }, [selectedAccountId]);

  async function handleCreate() {
    if (!form.name.trim() && !form.content.trim()) return;
    await createSignature({ ...form, accountId: selectedAccountId ?? null });
    const updated = await listSignatures(selectedAccountId ?? undefined);
    setSignatures(updated);
    setForm({ name: '', content: '', isDefault: false });
    setShowForm(false);
  }

  async function handleUpdate() {
    if (!editingId) return;
    await updateSignature(editingId, form);
    const updated = await listSignatures(selectedAccountId ?? undefined);
    setSignatures(updated);
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    Alert.alert('署名を削除', '削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        await deleteSignature(id);
        setSignatures(await listSignatures(selectedAccountId ?? undefined));
      }},
    ]);
  }


  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionLabel}>署名一覧</Text>
        <TouchableOpacity style={s.addRowBtn} onPress={() => { setForm({ name: '', content: '', isDefault: false }); setShowForm(true); }}>
          <Ionicons name="add" size={20} color="#007AFF" />
        </TouchableOpacity>
      </View>

      {showForm && <SigForm form={form} setForm={setForm} onSave={handleCreate} onCancel={() => setShowForm(false)} />}

      {signatures.length === 0 && !showForm && (
        <View style={s.emptyBox}>
          <Ionicons name="pencil-outline" size={36} color="#C7C7CC" />
          <Text style={s.emptyText}>署名がありません</Text>
        </View>
      )}

      {signatures.map(sig => (
        <View key={sig.id}>
          {editingId === sig.id ? (
            <SigForm form={form} setForm={setForm} onSave={handleUpdate} onCancel={() => setEditingId(null)} />
          ) : (
            <View style={s.itemCard}>
              <View style={{ flex: 1 }}>
                <View style={s.itemRow}>
                  <Text style={s.itemTitle}>{sig.name || '（無題）'}</Text>
                  {sig.isDefault && <View style={s.defaultBadge}><Text style={s.defaultBadgeText}>デフォルト</Text></View>}
                </View>
                <Text style={s.itemSub} numberOfLines={2}>{sig.content}</Text>
              </View>
              <View style={s.itemActions}>
                <TouchableOpacity style={s.iconBtn} onPress={() => { setForm({ name: sig.name, content: sig.content, isDefault: sig.isDefault }); setEditingId(sig.id); }}>
                  <Ionicons name="create-outline" size={20} color="#007AFF" />
                </TouchableOpacity>
                <TouchableOpacity style={s.iconBtn} onPress={() => handleDelete(sig.id)}>
                  <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── フィルター ────────────────────────────────────────────────────────────────
function FiltersTab() {
  const { selectedAccountId, accounts, getPassword } = useAccountStore();
  const { folders, reapplyFiltersNow } = useMailStore();
  const [rules, setRules] = useState<FilterRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (selectedAccountId) listFilterRules(selectedAccountId).then(setRules);
  }, [selectedAccountId]);

  async function pushRulesToImap(updatedRules: FilterRule[]) {
    if (!selectedAccountId) return;
    const account = accounts.find(a => a.id === selectedAccountId);
    if (!account) return;
    const password = await getPassword(selectedAccountId);
    if (!password) return;
    mailApi.filterPush(account, password, updatedRules).catch(() => {});
  }

  async function handleReapply() {
    if (!selectedAccountId) return;
    setApplying(true);
    try {
      const moved = await reapplyFiltersNow(selectedAccountId);
      Alert.alert('完了', moved > 0 ? `${moved}件のメールを移動しました` : '移動対象のメールはありませんでした');
      setRules(await listFilterRules(selectedAccountId));
    } catch {
      Alert.alert('エラー', 'フィルターの再適用に失敗しました');
    } finally {
      setApplying(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    Alert.alert('フィルターを削除', `「${name || 'このルール'}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        await deleteFilterRule(id);
        const updated = selectedAccountId ? await listFilterRules(selectedAccountId) : [];
        setRules(updated);
        pushRulesToImap(updated);
      }},
    ]);
  }

  const FIELD: Record<string, string> = { from: '差出人', to: '宛先', subject: '件名', body: '本文' };
  const OP: Record<string, string> = { contains: 'を含む', equals: '完全一致', startsWith: 'で始まる', endsWith: 'で終わる' };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionLabel}>フィルタールール</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={[s.addRowBtn, { paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4 }]}
            onPress={handleReapply}
            disabled={applying}
          >
            {applying
              ? <ActivityIndicator size="small" color="#007AFF" />
              : <><Ionicons name="refresh" size={15} color="#007AFF" /><Text style={{ color: '#007AFF', fontSize: 13 }}>再適用</Text></>
            }
          </TouchableOpacity>
          <TouchableOpacity style={s.addRowBtn} onPress={() => setShowForm(true)}>
            <Ionicons name="add" size={20} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </View>

      {showForm && (
        <QuickFilterSheet
          accountId={selectedAccountId ?? ''}
          folders={folders}
          onClose={async () => {
            setShowForm(false);
            const updated = selectedAccountId ? await listFilterRules(selectedAccountId) : [];
            setRules(updated);
            pushRulesToImap(updated);
          }}
        />
      )}

      {rules.length === 0 && !showForm && (
        <View style={s.emptyBox}>
          <Ionicons name="funnel-outline" size={36} color="#C7C7CC" />
          <Text style={s.emptyText}>フィルタールールがありません</Text>
        </View>
      )}

      {rules.map(rule => (
        <View key={rule.id} style={s.itemCard}>
          <View style={{ flex: 1 }}>
            <View style={s.itemRow}>
              <Text style={s.itemTitle}>{rule.name || '（無名ルール）'}</Text>
              <View style={[s.defaultBadge, { backgroundColor: rule.active ? '#E3F2FD' : '#F2F2F7' }]}>
                <Text style={[s.defaultBadgeText, { color: rule.active ? '#007AFF' : '#8E8E93' }]}>
                  {rule.active ? '有効' : '無効'}
                </Text>
              </View>
            </View>
            {rule.conditions.map((c, i) => (
              <Text key={i} style={s.itemSub}>{FIELD[c.field]} {OP[c.operator]} "{c.value}"</Text>
            ))}
            <View style={s.actionBadges}>
              {rule.actionMarkRead && <View style={s.aBadge}><Text style={s.aBadgeText}>既読にする</Text></View>}
              {rule.actionStarred && <View style={s.aBadge}><Text style={s.aBadgeText}>スター</Text></View>}
              {rule.actionFolder && <View style={s.aBadge}><Text style={s.aBadgeText}>→ {rule.actionFolder}</Text></View>}
            </View>
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={() => handleDelete(rule.id, rule.name)}>
            <Ionicons name="trash-outline" size={20} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── フォルダ管理 ──────────────────────────────────────────────────────────────
function FoldersTab() {
  const { accounts, selectedAccountId, getPassword } = useAccountStore();
  const { folders, loadFolders } = useMailStore();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (selectedAccountId) loadFolders(selectedAccountId);
  }, [selectedAccountId]);

  const SYSTEM = ['INBOX', 'Sent', 'Drafts', 'Trash', 'Starred', 'Spam', 'Junk', '[Gmail]'];
  const isSystem = (path: string) =>
    SYSTEM.some(s => path === s || path.toLowerCase().startsWith('[gmail]'));

  const customFolders = folders.filter(f => !isSystem(f.path));
  const systemFolders = folders.filter(f => isSystem(f.path) && f.path !== '[Gmail]');

  async function handleCreate() {
    if (!newName.trim() || !selectedAccountId) return;
    const account = accounts.find(a => a.id === selectedAccountId);
    if (!account) return;
    const password = await getPassword(selectedAccountId);
    if (!password) { Alert.alert('エラー', 'パスワードが見つかりません'); return; }
    setCreating(true); setError('');
    try {
      await mailApi.folderCreate(account, password, newName.trim());
      await loadFolders(selectedAccountId);
      setNewName('');
    } catch (err) {
      setError((err as Error).message);
    } finally { setCreating(false); }
  }

  async function handleDelete(path: string) {
    if (!selectedAccountId) return;
    Alert.alert('フォルダを削除', `「${path}」を削除しますか？\nフォルダ内のメールも削除されます。`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        const account = accounts.find(a => a.id === selectedAccountId);
        if (!account) return;
        const password = await getPassword(selectedAccountId);
        if (!password) return;
        setDeleting(path);
        try {
          await mailApi.folderDelete(account, password, path);
          await loadFolders(selectedAccountId);
        } catch (err) {
          Alert.alert('エラー', (err as Error).message);
        } finally { setDeleting(null); }
      }},
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.sectionLabel}>新規フォルダを作成</Text>
      <Text style={s.sectionNote}>Gmailの場合はラベルとして作成されます</Text>
      <View style={s.createRow}>
        <TextInput
          style={[s.formInput, { flex: 1, marginBottom: 0 }]}
          value={newName}
          onChangeText={setNewName}
          placeholder="新しいフォルダ名"
          placeholderTextColor="#C7C7CC"
          returnKeyType="done"
          onSubmitEditing={handleCreate}
        />
        <TouchableOpacity
          style={[s.createBtn, (!newName.trim() || creating) && { opacity: 0.5 }]}
          onPress={handleCreate}
          disabled={!newName.trim() || creating}
        >
          {creating
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="add" size={20} color="#fff" />}
          <Text style={s.createBtnText}>作成</Text>
        </TouchableOpacity>
      </View>
      {!!error && <Text style={s.errorText}>{error}</Text>}

      {customFolders.length > 0 && (
        <>
          <Text style={s.sectionLabel}>カスタムフォルダ</Text>
          {customFolders.map(f => (
            <View key={f.path} style={s.itemCard}>
              <Ionicons name="folder-outline" size={18} color="#6366f1" style={{ marginRight: 10 }} />
              <Text style={[s.itemTitle, { flex: 1 }]}>{f.name || f.path}</Text>
              <TouchableOpacity
                style={s.iconBtn}
                onPress={() => handleDelete(f.path)}
                disabled={deleting === f.path}
              >
                {deleting === f.path
                  ? <ActivityIndicator size="small" color="#FF3B30" />
                  : <Ionicons name="trash-outline" size={20} color="#FF3B30" />}
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {systemFolders.length > 0 && (
        <>
          <Text style={s.sectionLabel}>システムフォルダ</Text>
          {systemFolders.map(f => (
            <View key={f.path} style={[s.itemCard, { opacity: 0.6 }]}>
              <Ionicons name="folder-outline" size={18} color="#8E8E93" style={{ marginRight: 10 }} />
              <Text style={[s.itemTitle, { flex: 1, color: '#8E8E93' }]}>{f.name || f.path}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ─── AI設定 ────────────────────────────────────────────────────────────────────
function AiTab() {
  const { openAiKey, saveOpenAiKey, clearOpenAiKey } = useAccountStore();
  const [keyInput, setKeyInput] = useState(openAiKey ?? '');
  const [keyVisible, setKeyVisible] = useState(false);
  const [keySaved, setKeySaved] = useState(!!openAiKey);

  const handleSave = async () => {
    const t = keyInput.trim();
    if (!t) { Alert.alert('エラー', 'APIキーを入力してください'); return; }
    await saveOpenAiKey(t);
    setKeySaved(true);
    Alert.alert('保存しました', 'OpenAI APIキーを保存しました');
  };

  const handleClear = () => {
    Alert.alert('APIキーを削除', '削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        await clearOpenAiKey();
        setKeyInput(''); setKeySaved(false);
      }},
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.sectionLabel}>AI設定</Text>
      <View style={s.aiWarnBox}>
        <Ionicons name="warning-outline" size={15} color="#f59e0b" style={{ marginRight: 6, marginTop: 1 }} />
        <Text style={s.aiWarnText}>
          AI機能を有効にすると、メール本文がOpenAI APIに送信されます。プライバシーポリシーをご確認ください。
        </Text>
      </View>
      <View style={s.formCard}>
        <View style={s.aiHeader}>
          <Text style={s.formLabel}>OpenAI APIキー</Text>
          {keySaved && <View style={s.enabledBadge}><Text style={s.enabledBadgeText}>有効</Text></View>}
        </View>
        <Text style={s.sectionNote}>gpt-4o-mini を使用します。OpenAI Platformで取得できます。</Text>
        <View style={s.keyRow}>
          <TextInput
            style={s.keyInput}
            value={keyInput}
            onChangeText={setKeyInput}
            placeholder="sk-..."
            placeholderTextColor="#C7C7CC"
            secureTextEntry={!keyVisible}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={s.eyeBtn} onPress={() => setKeyVisible(v => !v)}>
            <Ionicons name={keyVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color="#8E8E93" />
          </TouchableOpacity>
        </View>
        <View style={s.keyActions}>
          <TouchableOpacity style={s.saveBtn} onPress={handleSave}>
            <Text style={s.saveBtnText}>APIキーを保存</Text>
          </TouchableOpacity>
          {keySaved && (
            <TouchableOpacity style={s.clearBtn} onPress={handleClear}>
              <Text style={s.clearBtnText}>削除</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {keySaved && (
        <View style={s.aiActiveBox}>
          <Ionicons name="checkmark-circle" size={16} color="#34C759" style={{ marginRight: 6 }} />
          <Text style={s.aiActiveText}>AI機能が有効です</Text>
        </View>
      )}
      <Text style={s.sectionNote} style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        APIキーはデバイス内のセキュアストレージに保存されます。
      </Text>
    </ScrollView>
  );
}

// ─── ブロックリスト ────────────────────────────────────────────────────────────
function BlockListTab() {
  const { selectedAccountId } = useAccountStore();
  const [list, setList] = useState<{ id: string; email: string; createdAt: number }[]>([]);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (selectedAccountId) listBlockList(selectedAccountId).then(setList);
  }, [selectedAccountId]);

  async function handleAdd() {
    const email = input.trim().toLowerCase();
    if (!email || !selectedAccountId) return;
    setAdding(true);
    try {
      await addToBlockList(selectedAccountId, email);
      setList(await listBlockList(selectedAccountId));
      setInput('');
    } catch (err) {
      Alert.alert('エラー', (err as Error).message);
    } finally { setAdding(false); }
  }

  async function handleRemove(id: string, email: string) {
    Alert.alert('ブロック解除', `${email} のブロックを解除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '解除', style: 'destructive', onPress: async () => {
        await removeFromBlockList(id);
        if (selectedAccountId) setList(await listBlockList(selectedAccountId));
      }},
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={s.sectionLabel}>ブロックリスト</Text>
      <Text style={s.sectionNote}>ブロックしたメールアドレスからのメールは受信時に自動削除されます</Text>
      <View style={s.createRow}>
        <TextInput
          style={[s.formInput, { flex: 1, marginBottom: 0 }]}
          value={input}
          onChangeText={setInput}
          placeholder="メールアドレス"
          placeholderTextColor="#C7C7CC"
          autoCapitalize="none"
          keyboardType="email-address"
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
        <TouchableOpacity
          style={[s.createBtn, (!input.trim() || adding) && { opacity: 0.5 }]}
          onPress={handleAdd}
          disabled={!input.trim() || adding}
        >
          {adding
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="add" size={20} color="#fff" />}
          <Text style={s.createBtnText}>追加</Text>
        </TouchableOpacity>
      </View>

      {list.length === 0 && (
        <View style={s.emptyBox}>
          <Ionicons name="shield-outline" size={36} color="#C7C7CC" />
          <Text style={s.emptyText}>ブロック中のアドレスはありません</Text>
        </View>
      )}

      {list.map(item => (
        <View key={item.id} style={s.itemCard}>
          <Ionicons name="ban-outline" size={18} color="#FF3B30" style={{ marginRight: 10 }} />
          <Text style={[s.itemTitle, { flex: 1 }]}>{item.email}</Text>
          <TouchableOpacity style={s.iconBtn} onPress={() => handleRemove(item.id, item.email)}>
            <Ionicons name="close-circle-outline" size={20} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── スタイル ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA',
  },
  backBtn: { padding: 4 },
  title: { fontSize: 17, fontWeight: '600', color: '#000' },

  // タブバー
  tabBar: { backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA', flexGrow: 0 },
  tabBarContent: { paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  tab: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, backgroundColor: '#F2F2F7',
  },
  tabActive: { backgroundColor: '#EFF6FF' },
  tabText: { fontSize: 13, color: '#8E8E93', fontWeight: '500' },
  tabTextActive: { color: '#007AFF', fontWeight: '600' },

  // セクション
  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: '#8E8E93',
    paddingHorizontal: 16, paddingTop: 18, paddingBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  sectionNote: { fontSize: 12, color: '#8E8E93', paddingHorizontal: 16, paddingBottom: 8, lineHeight: 17 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 10 },
  addRowBtn: { padding: 8, marginTop: 12 },

  // アカウント
  accountCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: '#000', marginBottom: 2 },
  email: { fontSize: 13, color: '#3C3C43', marginBottom: 1 },
  provider: { fontSize: 12, color: '#8E8E93' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 6 },
  itemActions: { flexDirection: 'row', alignItems: 'center' },
  activeBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginRight: 4 },
  activeBadgeText: { fontSize: 12, color: '#34C759', fontWeight: '600' },
  sep: { height: 0.5, backgroundColor: '#E5E5EA', marginLeft: 74 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    marginTop: 1, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#E5E5EA',
  },
  addBtnText: { fontSize: 15, color: '#007AFF', fontWeight: '500' },

  // フォーム
  formCard: { backgroundColor: '#fff', marginHorizontal: 0, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 1 },
  formLabel: { fontSize: 12, fontWeight: '600', color: '#8E8E93', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  formInput: {
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#000', backgroundColor: '#FAFAFA', marginBottom: 10,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  switchLabel: { fontSize: 15, color: '#000' },
  formActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  cancelBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, color: '#3C3C43', fontWeight: '500' },
  saveBtn: { flex: 1, backgroundColor: '#007AFF', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  // リストアイテム
  itemCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: '#000', marginRight: 8 },
  itemSub: { fontSize: 12, color: '#8E8E93', lineHeight: 16 },
  defaultBadge: { backgroundColor: '#E3F2FD', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  defaultBadgeText: { fontSize: 11, color: '#007AFF', fontWeight: '600' },
  actionBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  aBadge: { backgroundColor: '#F2F2F7', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  aBadgeText: { fontSize: 11, color: '#3C3C43' },

  // フォルダ作成
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#007AFF', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
  },
  createBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  errorText: { color: '#FF3B30', fontSize: 13, paddingHorizontal: 16, marginBottom: 8 },

  // AI
  aiWarnBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FEF3C7', borderRadius: 10, marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    padding: 12,
  },
  aiWarnText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  enabledBadge: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginLeft: 8 },
  enabledBadgeText: { fontSize: 12, color: '#007AFF', fontWeight: '600' },
  keyRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10,
    backgroundColor: '#F9F9F9', paddingHorizontal: 12, marginBottom: 10,
  },
  keyInput: { flex: 1, fontSize: 14, color: '#000', paddingVertical: 10 },
  eyeBtn: { padding: 4 },
  keyActions: { flexDirection: 'row', gap: 8 },
  clearBtn: { paddingHorizontal: 16, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#FF3B30' },
  clearBtnText: { color: '#FF3B30', fontWeight: '600', fontSize: 14 },
  aiActiveBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F0FDF4', borderRadius: 10, marginHorizontal: 16, marginTop: 12, padding: 12,
  },
  aiActiveText: { fontSize: 14, color: '#16A34A', fontWeight: '500' },

  // 空状態
  emptyBox: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14, color: '#8E8E93' },
});

import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  RefreshControl, StyleSheet, Modal, Animated, Dimensions,
  TextInput, SectionList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../store/accountStore';
import { useMailStore } from '../store/mailStore';
import EmailItem from '../components/EmailItem';
import type { Email, Folder } from '@/shared/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.82;

// specialUse → アイコン・ラベルマッピング
type IconName = React.ComponentProps<typeof Ionicons>['name'];

function folderMeta(folder: Folder): { label: string; icon: IconName } {
  const su = (folder.specialUse ?? '').toLowerCase();
  const path = folder.path.toLowerCase();
  if (su === '\\inbox'   || path.includes('inbox'))   return { label: '受信トレイ', icon: 'mail' };
  if (su === '\\sent'    || path.includes('sent'))     return { label: '送信済み',   icon: 'paper-plane' };
  if (su === '\\drafts'  || path.includes('draft'))    return { label: '下書き',     icon: 'document-text' };
  if (su === '\\trash'   || path.includes('trash') || path.includes('deleted')) return { label: 'ゴミ箱', icon: 'trash' };
  if (su === '\\junk'    || path.includes('spam') || path.includes('junk'))     return { label: '迷惑メール', icon: 'warning' };
  if (su === '\\starred' || path.includes('starred') || path.includes('flagged')) return { label: 'スター付き', icon: 'star' };
  if (su === '\\archive' || path.includes('archive'))  return { label: 'アーカイブ', icon: 'archive' };
  if (su === '\\allmail' || path.includes('all mail') || path.includes('allmail')) return { label: 'すべてのメール', icon: 'layers' };
  return { label: folder.name || folder.path, icon: 'folder-outline' };
}

// フォールバック（フォルダ未取得時）
const FALLBACK_FOLDERS = [
  { path: 'INBOX',   name: '受信トレイ', icon: 'mail'          as IconName },
  { path: 'Sent',    name: '送信済み',   icon: 'paper-plane'   as IconName },
  { path: 'Drafts',  name: '下書き',     icon: 'document-text' as IconName },
  { path: 'Trash',   name: 'ゴミ箱',     icon: 'trash'         as IconName },
  { path: 'Spam',    name: '迷惑メール', icon: 'warning'       as IconName },
];

type Section = { title: string; data: Email[] };

function groupByDate(emails: Email[]): Section[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const groups: Record<string, Email[]> = {};
  for (const e of emails) {
    let label: string;
    if (e.date >= today) label = '今日';
    else if (e.date >= yesterday) label = '昨日';
    else if (e.date >= weekAgo) label = '今週';
    else {
      const d = new Date(e.date);
      label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    }
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  }

  const order = ['今日', '昨日', '今週'];
  const sorted = Object.keys(groups).sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return b.localeCompare(a);
  });
  return sorted.map(title => ({ title, data: groups[title] }));
}

export default function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  const { accounts, selectedAccountId, selectAccount, initialized } = useAccountStore();
  const {
    emails, folders, selectedFolder, loading, syncing, error,
    loadEmails, syncEmails, loadFolders, setFolder,
    markRead,
  } = useMailStore();

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  // 表示用フォルダラベル
  const currentFolderLabel = (() => {
    const real = folders.find(f => f.path === selectedFolder);
    if (real) return folderMeta(real).label;
    return FALLBACK_FOLDERS.find(f => f.path === selectedFolder)?.name ?? selectedFolder;
  })();

  const displayEmails = searchQuery.trim()
    ? emails.filter(e =>
        e.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.from.name || e.from.address).toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.bodyText.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : emails;

  const sections = groupByDate(displayEmails);

  useEffect(() => {
    if (!initialized || !selectedAccountId) return;
    loadFolders(selectedAccountId);
    loadEmails(selectedAccountId, selectedFolder);
    syncEmails(selectedAccountId, selectedFolder);
  }, [initialized, selectedAccountId, selectedFolder]);

  const openDrawer = () => {
    setDrawerOpen(true);
    Animated.spring(drawerAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };
  const closeDrawer = () => {
    Animated.spring(drawerAnim, { toValue: -DRAWER_WIDTH, useNativeDriver: true, tension: 65, friction: 11 })
      .start(() => setDrawerOpen(false));
  };

  const onRefresh = useCallback(async () => {
    if (!selectedAccountId) return;
    setRefreshing(true);
    await syncEmails(selectedAccountId, selectedFolder);
    setRefreshing(false);
  }, [selectedAccountId, selectedFolder]);

  const onEmailPress = useCallback((email: Email) => {
    if (!email.isRead) markRead(email.id, email.uid, email.folder || selectedFolder);
    router.push(`/email/${email.id}`);
  }, [selectedFolder]);

  const handleFolderSelect = (folderPath: string) => {
    setFolder(folderPath);
    closeDrawer();
    if (selectedAccountId) {
      setTimeout(() => {
        loadEmails(selectedAccountId, folderPath);
        syncEmails(selectedAccountId, folderPath);
      }, 300);
    }
  };

  const handleAccountSelect = async (accountId: string) => {
    await selectAccount(accountId);
    closeDrawer();
  };

  if (!initialized) {
    return <SafeAreaView style={s.container}><ActivityIndicator style={{ flex: 1 }} /></SafeAreaView>;
  }

  if (accounts.length === 0) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.empty}>
          <Ionicons name="mail-outline" size={64} color="#C7C7CC" />
          <Text style={s.emptyTitle}>アカウントを追加してください</Text>
          <TouchableOpacity style={s.addBtn} onPress={() => router.push('/setup')}>
            <Text style={s.addBtnText}>アカウントを追加</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.container}>
      {/* ドロワー */}
      {drawerOpen && (
        <Modal transparent animationType="none" onRequestClose={closeDrawer}>
          <TouchableOpacity style={s.overlay} onPress={closeDrawer} activeOpacity={1}>
            <Animated.View style={[s.drawer, { transform: [{ translateX: drawerAnim }] }]}>
              <TouchableOpacity activeOpacity={1} style={{ flex: 1 }} onPress={() => {}}>
                <DrawerContent
                  accounts={accounts}
                  selectedAccountId={selectedAccountId}
                  selectedFolder={selectedFolder}
                  folders={folders}
                  onAccountSelect={handleAccountSelect}
                  onFolderSelect={handleFolderSelect}
                  onSettings={() => { closeDrawer(); setTimeout(() => router.push('/settings'), 300); }}
                  onSetup={() => { closeDrawer(); setTimeout(() => router.push('/setup'), 300); }}
                  insets={insets}
                />
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}

      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top']}>
        {/* ヘッダー */}
        <View style={s.header}>
          <TouchableOpacity style={s.menuBtn} onPress={openDrawer}>
            <Ionicons name="menu" size={24} color="#000" />
          </TouchableOpacity>
          <TouchableOpacity style={s.titleBtn} onPress={openDrawer}>
            <Text style={s.title}>{currentFolderLabel}</Text>
            <Ionicons name="chevron-down" size={16} color="#000" style={{ marginLeft: 3 }} />
          </TouchableOpacity>
          <View style={s.headerRight}>
            {syncing && <ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 8 }} />}
            <TouchableOpacity style={s.iconBtn} onPress={() => setSearchVisible(v => !v)}>
              <Ionicons name={searchVisible ? 'close' : 'search'} size={22} color="#007AFF" />
            </TouchableOpacity>
          </View>
        </View>

        {selectedAccount && (
          <Text style={s.accountLabel}>{selectedAccount.email}</Text>
        )}

        {searchVisible && (
          <View style={s.searchBar}>
            <Ionicons name="search" size={16} color="#8E8E93" style={{ marginRight: 6 }} />
            <TextInput
              style={s.searchInput}
              placeholder="メールを検索..."
              placeholderTextColor="#8E8E93"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              clearButtonMode="while-editing"
            />
          </View>
        )}

        {error && (
          <View style={s.errorBanner}><Text style={s.errorText}>{error}</Text></View>
        )}

        {loading && emails.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <EmailItem email={item} onPress={() => onEmailPress(item)} />
            )}
            renderSectionHeader={({ section }) => (
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>{section.title}</Text>
              </View>
            )}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#007AFF" />
            }
            ItemSeparatorComponent={() => <View style={s.sep} />}
            ListEmptyComponent={
              <View style={s.empty}>
                <Ionicons name="mail-open-outline" size={48} color="#C7C7CC" />
                <Text style={s.emptyTitle}>メールがありません</Text>
              </View>
            }
            contentContainerStyle={sections.length === 0 ? { flex: 1 } : { paddingBottom: 100 }}
            stickySectionHeadersEnabled={false}
          />
        )}
      </SafeAreaView>

      {/* FAB */}
      <TouchableOpacity
        style={[s.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => router.push('/compose')}
      >
        <Ionicons name="create-outline" size={26} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

// ─── ドロワー ───────────────────────────────────────────
function DrawerContent({
  accounts, selectedAccountId, selectedFolder, folders,
  onAccountSelect, onFolderSelect, onSettings, onSetup, insets,
}: {
  accounts: any[];
  selectedAccountId: string | null;
  selectedFolder: string;
  folders: Folder[];
  onAccountSelect: (id: string) => void;
  onFolderSelect: (path: string) => void;
  onSettings: () => void;
  onSetup: () => void;
  insets: any;
}) {
  // サーバーフォルダがあればそれを使い、なければフォールバック
  const displayFolders: Array<{ path: string; label: string; icon: IconName; unreadCount?: number }> =
    folders.length > 0
      ? folders
          .filter(f => {
            // 非表示にするフォルダ（子フォルダ名前空間等）
            const path = f.path.toLowerCase();
            return !path.includes('[gmail]') || // Gmail の場合は [Gmail] プレフィックスのものだけ表示
                   path === '[gmail]/sent mail' ||
                   path === '[gmail]/drafts' ||
                   path === '[gmail]/trash' ||
                   path === '[gmail]/spam' ||
                   path === '[gmail]/starred' ||
                   path === '[gmail]/all mail';
          })
          .map(f => {
            const meta = folderMeta(f);
            return { path: f.path, label: meta.label, icon: meta.icon, unreadCount: f.unreadCount };
          })
      : FALLBACK_FOLDERS.map(f => ({ path: f.path, label: f.name, icon: f.icon }));

  return (
    <View style={[d.container, { paddingTop: insets.top + 8 }]}>
      {/* アカウント一覧 */}
      <Text style={d.sectionLabel}>アカウント</Text>
      {accounts.map((acc: any) => (
        <TouchableOpacity
          key={acc.id}
          style={[d.accountRow, acc.id === selectedAccountId && d.accountRowActive]}
          onPress={() => onAccountSelect(acc.id)}
        >
          <View style={d.accountAvatar}>
            <Text style={d.avatarText}>{(acc.name || acc.email).charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={d.accountEmail} numberOfLines={1}>{acc.email}</Text>
          {acc.id === selectedAccountId && (
            <Ionicons name="checkmark" size={18} color="#007AFF" />
          )}
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={d.addAccountRow} onPress={onSetup}>
        <Ionicons name="add-circle-outline" size={20} color="#007AFF" style={{ marginRight: 10 }} />
        <Text style={d.addAccountText}>アカウントを追加</Text>
      </TouchableOpacity>

      <View style={d.divider} />

      {/* フォルダ一覧（サーバーから取得） */}
      <Text style={d.sectionLabel}>フォルダ</Text>
      {displayFolders.map(f => (
        <TouchableOpacity
          key={f.path}
          style={[d.folderRow, f.path === selectedFolder && d.folderRowActive]}
          onPress={() => onFolderSelect(f.path)}
        >
          <View style={[d.folderIcon, f.path === selectedFolder && d.folderIconActive]}>
            <Ionicons name={f.icon} size={17} color={f.path === selectedFolder ? '#fff' : '#007AFF'} />
          </View>
          <Text style={[d.folderLabel, f.path === selectedFolder && d.folderLabelActive]} numberOfLines={1}>
            {f.label}
          </Text>
          {(f.unreadCount ?? 0) > 0 && f.path !== selectedFolder && (
            <View style={d.badge}>
              <Text style={d.badgeText}>{f.unreadCount! > 99 ? '99+' : f.unreadCount}</Text>
            </View>
          )}
          {f.path === selectedFolder && (
            <Ionicons name="checkmark" size={16} color="#007AFF" />
          )}
        </TouchableOpacity>
      ))}

      <View style={d.divider} />
      <TouchableOpacity style={d.folderRow} onPress={onSettings}>
        <View style={d.folderIcon}>
          <Ionicons name="settings-outline" size={17} color="#8E8E93" />
        </View>
        <Text style={[d.folderLabel, { color: '#3C3C43' }]}>設定</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 6, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA',
  },
  menuBtn: { padding: 8 },
  titleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  title: { fontSize: 20, fontWeight: '700', color: '#000' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { padding: 8 },
  accountLabel: { fontSize: 12, color: '#8E8E93', paddingHorizontal: 18, paddingBottom: 6, paddingTop: 2 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    margin: 10, marginTop: 6, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#F2F2F7', borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#000', padding: 0 },
  sectionHeader: { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#fff' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  sep: { height: 0.5, backgroundColor: '#F0F0F0', marginLeft: 26 },
  errorBanner: { backgroundColor: '#FF3B30', padding: 8, paddingHorizontal: 16 },
  errorText: { color: '#fff', fontSize: 13 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#3C3C43', textAlign: 'center' },
  addBtn: { backgroundColor: '#007AFF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 4 },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#007AFF',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 8,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  drawer: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: DRAWER_WIDTH,
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 10,
  },
});

const d = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 12 },
  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: '#8E8E93',
    paddingHorizontal: 8, paddingVertical: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  accountRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, marginBottom: 2 },
  accountRowActive: { backgroundColor: '#F0F0F5' },
  accountAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  accountEmail: { flex: 1, fontSize: 14, color: '#000' },
  addAccountRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, marginTop: 2 },
  addAccountText: { fontSize: 14, color: '#007AFF', fontWeight: '500' },
  divider: { height: 0.5, backgroundColor: '#E5E5EA', marginVertical: 8, marginHorizontal: 8 },
  folderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, marginBottom: 2 },
  folderRowActive: { backgroundColor: '#EFF5FF' },
  folderIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#E8F0FE', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  folderIconActive: { backgroundColor: '#007AFF' },
  folderLabel: { flex: 1, fontSize: 15, color: '#000' },
  folderLabelActive: { fontWeight: '600', color: '#007AFF' },
  badge: { backgroundColor: '#007AFF', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

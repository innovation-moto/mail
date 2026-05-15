import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  RefreshControl, StyleSheet, Modal, Animated, Dimensions,
  TextInput, SectionList, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../store/accountStore';
import { useMailStore } from '../store/mailStore';
import EmailItem from '../components/EmailItem';
import type { Email, Folder } from '@/shared/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.82;

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// PC（Sidebar.tsx）と同じカラー定義
type FolderColor = { icon: string; bg: string };
const FOLDER_COLORS: Record<string, FolderColor> = {
  inbox:    { icon: '#3b82f6', bg: '#EFF6FF' }, // blue-500
  sent:     { icon: '#22c55e', bg: '#F0FDF4' }, // green-500
  drafts:   { icon: '#eab308', bg: '#FEFCE8' }, // yellow-500
  starred:  { icon: '#fb923c', bg: '#FFF7ED' }, // orange-400
  trash:    { icon: '#f87171', bg: '#FEF2F2' }, // red-400
  spam:     { icon: '#f97316', bg: '#FFF7ED' }, // orange-500
  archive:  { icon: '#6366f1', bg: '#EEF2FF' }, // indigo-500
  allmail:  { icon: '#8b5cf6', bg: '#F5F3FF' }, // violet-500
  default:  { icon: '#8b5cf6', bg: '#F5F3FF' },
};

type FolderMeta = { label: string; icon: IconName; colorKey: keyof typeof FOLDER_COLORS };

function folderMeta(folder: Folder): FolderMeta {
  const su = (folder.specialUse ?? '').toLowerCase();
  const path = folder.path.toLowerCase();
  if (su === '\\inbox'   || path === 'inbox')                               return { label: '受信トレイ',     icon: 'mail-outline',         colorKey: 'inbox' };
  if (su === '\\sent'    || path.includes('sent'))                          return { label: '送信済み',       icon: 'paper-plane-outline',  colorKey: 'sent' };
  if (su === '\\drafts'  || path.includes('draft'))                         return { label: '下書き',         icon: 'document-text-outline', colorKey: 'drafts' };
  if (su === '\\trash'   || path.includes('trash') || path.includes('deleted')) return { label: 'ゴミ箱',    icon: 'trash-outline',        colorKey: 'trash' };
  if (su === '\\junk'    || path.includes('spam')  || path.includes('junk'))    return { label: '迷惑メール', icon: 'warning-outline',      colorKey: 'spam' };
  if (su === '\\starred' || path.includes('starred') || path.includes('flagged')) return { label: 'スター付き', icon: 'star-outline',       colorKey: 'starred' };
  if (su === '\\archive' || path.includes('archive'))                        return { label: 'アーカイブ',    icon: 'archive-outline',      colorKey: 'archive' };
  if (su === '\\allmail' || path.includes('all mail') || path.includes('allmail')) return { label: 'すべてのメール', icon: 'layers-outline', colorKey: 'allmail' };
  return { label: folder.name || folder.path, icon: 'folder-outline', colorKey: 'default' };
}

// フォールバック（フォルダ未取得時）
const FALLBACK_FOLDERS: Array<{ path: string; label: string; icon: IconName; colorKey: keyof typeof FOLDER_COLORS }> = [
  { path: 'INBOX',  label: '受信トレイ', icon: 'mail-outline',          colorKey: 'inbox' },
  { path: 'Sent',   label: '送信済み',   icon: 'paper-plane-outline',   colorKey: 'sent' },
  { path: 'Drafts', label: '下書き',     icon: 'document-text-outline', colorKey: 'drafts' },
  { path: 'Trash',  label: 'ゴミ箱',     icon: 'trash-outline',         colorKey: 'trash' },
  { path: 'Spam',   label: '迷惑メール', icon: 'warning-outline',       colorKey: 'spam' },
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
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  const { accounts, selectedAccountId, selectAccount, initialized } = useAccountStore();
  const {
    emails, folders, folderUnreadCounts, selectedFolder, loading, syncing, error,
    loadEmails, syncEmails, loadFolders, setFolder, refreshUnreadCounts,
    markRead,
  } = useMailStore();

  // syncing中はアイコンをスピン
  useEffect(() => {
    if (syncing) {
      spinAnim.setValue(0);
      spinLoop.current = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      );
      spinLoop.current.start();
    } else {
      spinLoop.current?.stop();
      spinAnim.setValue(0);
    }
  }, [syncing]);

  const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

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
    refreshUnreadCounts(selectedAccountId);
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
                  folderUnreadCounts={folderUnreadCounts}
                  syncing={syncing}
                  onAccountSelect={handleAccountSelect}
                  onFolderSelect={handleFolderSelect}
                  onSync={() => selectedAccountId && syncEmails(selectedAccountId, selectedFolder)}
                  onSettings={() => { closeDrawer(); setTimeout(() => router.push('/settings'), 300); }}
                  onSetup={() => { closeDrawer(); setTimeout(() => router.push('/setup'), 300); }}
                  insets={insets}
                />
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}

      <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f2f7' }} edges={['top']}>
        {/* ─── ヘッダー リキッドグラスバー ─── */}
        <BlurView intensity={72} tint="light" style={s.header}>
          <View style={s.headerInner}>
            <TouchableOpacity style={s.menuBtn} onPress={openDrawer}>
              <Ionicons name="menu" size={24} color="#1C1C1E" />
            </TouchableOpacity>
            <TouchableOpacity style={s.titleBtn} onPress={openDrawer}>
              <Text style={s.title}>{currentFolderLabel}</Text>
              <Ionicons name="chevron-down" size={15} color="#1C1C1E" style={{ marginLeft: 3 }} />
            </TouchableOpacity>
            <View style={s.headerRight}>
              {/* 更新ボタン + 検索ボタン（ひとつのglass pill） */}
              <BlurView intensity={55} tint="light" style={s.headerPill}>
                <View style={s.headerPillInner}>
                  <TouchableOpacity
                    style={s.pillBtn}
                    onPress={() => selectedAccountId && syncEmails(selectedAccountId, selectedFolder)}
                    disabled={syncing}
                  >
                    <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
                      <Ionicons name="refresh-outline" size={18} color={syncing ? '#007AFF' : '#3C3C43'} />
                    </Animated.View>
                  </TouchableOpacity>
                  <View style={s.pillDivider} />
                  <TouchableOpacity
                    style={s.pillBtn}
                    onPress={() => setSearchVisible(v => !v)}
                  >
                    <Ionicons name={searchVisible ? 'close' : 'search-outline'} size={18} color="#3C3C43" />
                  </TouchableOpacity>
                </View>
              </BlurView>
            </View>
          </View>
        </BlurView>

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
  accounts, selectedAccountId, selectedFolder, folders, folderUnreadCounts, syncing,
  onAccountSelect, onFolderSelect, onSync, onSettings, onSetup, insets,
}: {
  accounts: any[];
  selectedAccountId: string | null;
  selectedFolder: string;
  folders: Folder[];
  folderUnreadCounts: Record<string, number>;
  syncing: boolean;
  onAccountSelect: (id: string) => void;
  onFolderSelect: (path: string) => void;
  onSync: () => void;
  onSettings: () => void;
  onSetup: () => void;
  insets: any;
}) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (syncing) {
      Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ).start();
    } else {
      spinAnim.setValue(0);
    }
  }, [syncing]);
  const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // サーバーフォルダがあればそれを使い、なければフォールバック
  type DisplayFolder = { path: string; label: string; icon: IconName; colorKey: keyof typeof FOLDER_COLORS; unreadCount?: number };
  const displayFolders: DisplayFolder[] =
    folders.length > 0
      ? folders
          .filter(f => {
            const p = f.path.toLowerCase();
            // [Gmail] ネームスペース自体は除外、中のフォルダは許可
            if (p === '[gmail]') return false;
            return true;
          })
          .map(f => {
            const meta = folderMeta(f);
            return { path: f.path, label: meta.label, icon: meta.icon, colorKey: meta.colorKey, unreadCount: f.unreadCount };
          })
      : FALLBACK_FOLDERS;

  return (
    <View style={[d.wrap, { paddingTop: insets.top + 4 }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
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
            <View style={{ flex: 1 }}>
              <Text style={d.accountName} numberOfLines={1}>{acc.name || acc.email}</Text>
              <Text style={d.accountEmail} numberOfLines={1}>{acc.email}</Text>
            </View>
            {acc.id === selectedAccountId && (
              <Ionicons name="checkmark-circle" size={18} color="#007AFF" />
            )}
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={d.addAccountRow} onPress={onSetup}>
          <Ionicons name="add-circle-outline" size={20} color="#007AFF" style={{ marginRight: 10 }} />
          <Text style={d.addAccountText}>アカウントを追加</Text>
        </TouchableOpacity>

        <View style={d.divider} />

        {/* フォルダ一覧（PCと同じカラーアイコン） */}
        <View style={d.folderHeader}>
          <Text style={d.sectionLabel}>フォルダ</Text>
          {/* 更新ボタン（PCのサイドバー下部と同等） */}
          <TouchableOpacity style={d.syncBtn} onPress={onSync} disabled={syncing}>
            <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
              <Ionicons name="refresh-outline" size={16} color={syncing ? '#007AFF' : '#8E8E93'} />
            </Animated.View>
          </TouchableOpacity>
        </View>

        {displayFolders.map(f => {
          const isActive = f.path === selectedFolder;
          const color = FOLDER_COLORS[f.colorKey] ?? FOLDER_COLORS.default;
          // ローカルDBの未読数を優先、なければサーバーから取得した値
          const unread = folderUnreadCounts[f.path] ?? f.unreadCount ?? 0;
          return (
            <TouchableOpacity
              key={f.path}
              style={[d.folderRow, isActive && d.folderRowActive]}
              onPress={() => onFolderSelect(f.path)}
            >
              {/* カラーアイコン（PCと同じ色） */}
              <View style={[d.folderIconWrap, { backgroundColor: isActive ? color.icon : color.bg }]}>
                <Ionicons
                  name={f.icon}
                  size={16}
                  color={isActive ? '#fff' : color.icon}
                />
              </View>
              <Text style={[d.folderLabel, isActive && d.folderLabelActive]} numberOfLines={1}>
                {f.label}
              </Text>
              {unread > 0 && (
                <View style={[d.badge, isActive && d.badgeActive]}>
                  <Text style={[d.badgeText, isActive && d.badgeTextActive]}>{unread > 99 ? '99+' : unread}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        <View style={d.divider} />

        {/* 設定 */}
        <TouchableOpacity style={d.folderRow} onPress={onSettings}>
          <View style={[d.folderIconWrap, { backgroundColor: '#F2F2F7' }]}>
            <Ionicons name="settings-outline" size={16} color="#8E8E93" />
          </View>
          <Text style={[d.folderLabel, { color: '#3C3C43' }]}>設定</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  // ─── ヘッダー リキッドグラス ───
  header: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 4,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  menuBtn: { padding: 8 },
  titleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  title: { fontSize: 20, fontWeight: '700', color: '#1C1C1E' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  // 更新+検索 pill
  headerPill: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  headerPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  pillBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  pillDivider: { width: 0.5, height: 16, backgroundColor: 'rgba(60,60,67,0.2)' },
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
  wrap: { flex: 1, paddingHorizontal: 12 },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: '#8E8E93',
    paddingHorizontal: 8, paddingTop: 16, paddingBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  // アカウント
  accountRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, paddingHorizontal: 8,
    borderRadius: 10, marginBottom: 2,
  },
  accountRowActive: { backgroundColor: '#F0F0F5' },
  accountAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#007AFF',
    justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  accountName: { fontSize: 14, fontWeight: '600', color: '#000' },
  accountEmail: { fontSize: 12, color: '#8E8E93' },
  addAccountRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, paddingHorizontal: 8, marginTop: 2,
  },
  addAccountText: { fontSize: 14, color: '#007AFF', fontWeight: '500' },
  divider: { height: 0.5, backgroundColor: '#E5E5EA', marginVertical: 8, marginHorizontal: 4 },
  // フォルダヘッダー（ラベル＋更新ボタン）
  folderHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingRight: 4,
  },
  syncBtn: { padding: 8, marginLeft: 'auto' as any },
  // フォルダ行
  folderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, paddingHorizontal: 8,
    borderRadius: 10, marginBottom: 1,
  },
  folderRowActive: { backgroundColor: '#EFF6FF' },
  folderIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  folderLabel: { flex: 1, fontSize: 15, color: '#1C1C1E' },
  folderLabelActive: { fontWeight: '600', color: '#007AFF' },
  badge: {
    backgroundColor: '#007AFF', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2, marginRight: 4,
    minWidth: 20, alignItems: 'center',
  },
  badgeActive: { backgroundColor: 'rgba(0,122,255,0.15)' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  badgeTextActive: { color: '#007AFF' },
});

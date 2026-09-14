import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  RefreshControl, StyleSheet, Modal, Animated, Dimensions,
  TextInput, SectionList, ScrollView, Image, AppState, AppStateStatus, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../store/accountStore';
import { useMailStore } from '../store/mailStore';
import EmailItem from '../components/EmailItem';
import SenderAvatar from '../components/SenderAvatar';
import { SwipeableThreadItem } from '../components/SwipeableThreadItem';
import { searchThreads, addToBlockList, getRecentEmailsForSearch, getAppSetting, setAppSetting } from '../lib/db';
import { mailApi } from '../lib/api';
import type { Email, Folder, ThreadSummary } from '@/shared/types';

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
  const topPath = path.split('/')[0];
  if (su === '\\trash'   || topPath === 'trash' || topPath === 'deleted') return { label: 'ゴミ箱',    icon: 'trash-outline',        colorKey: 'trash' };
  if (su === '\\junk'    || path.includes('spam')  || path.includes('junk'))    return { label: '迷惑メール', icon: 'warning-outline',      colorKey: 'spam' };
  if (su === '\\starred' || su === '\\flagged' || path.includes('starred') || path.includes('flagged') || path.includes('スター')) return { label: 'スター付き', icon: 'star-outline', colorKey: 'starred' };
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

type Section = { title: string; data: ThreadSummary[] };

function groupByDate(threads: ThreadSummary[]): Section[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const groups: Record<string, ThreadSummary[]> = {};
  for (const t of threads) {
    let label: string;
    if (t.latestDate >= today) label = '今日';
    else if (t.latestDate >= yesterday) label = '昨日';
    else if (t.latestDate >= weekAgo) label = '今週';
    else {
      const d = new Date(t.latestDate);
      label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    }
    if (!groups[label]) groups[label] = [];
    groups[label].push(t);
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
  const [searchResults, setSearchResults] = useState<ThreadSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [isSmartSearch, setIsSmartSearch] = useState(false);
  const [smartSearchAnswer, setSmartSearchAnswer] = useState('');
  const [smartSearching, setSmartSearching] = useState(false);
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  const [moveTarget, setMoveTarget] = useState<ThreadSummary | null>(null);

  const { accounts, selectedAccountId, selectAccount, initialized, openAiKey } = useAccountStore();
  const {
    emails, threads, folders, folderUnreadCounts, selectedFolder, loading, syncing, error,
    hasMoreThreads, loadingMoreThreads, backfillingOlderEmails,
    loadEmails, loadThreads, loadMoreThreads, selectThread, syncEmails, syncAllFolders, loadFolders, setFolder, refreshUnreadCounts,
    markRead, deleteThread, moveThread, spamThread, markAllRead,
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
    return FALLBACK_FOLDERS.find(f => f.path === selectedFolder)?.label ?? selectedFolder;
  })();

  // 検索クエリをDB全文検索（件名・差出人・本文、フォルダ横断）。300msデバウンス。
  useEffect(() => {
    setIsSmartSearch(false);
    setSmartSearchAnswer('');
    const q = searchQuery.trim();
    if (!q || !selectedAccountId) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchThreads(selectedAccountId, q)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedAccountId]);

  function emailToThread(e: Email): ThreadSummary {
    return {
      threadId: e.id,
      subject: e.subject,
      latestFrom: e.from,
      latestDate: e.date,
      emailCount: 1,
      unreadCount: e.isRead ? 0 : 1,
      hasAttachments: e.hasAttachments,
      latestEmailId: e.id,
      aiPriority: e.aiPriority ?? null,
      folder: e.folder,
    };
  }

  async function handleSmartSearch() {
    const q = searchQuery.trim();
    if (!q || !selectedAccountId) return;
    if (!openAiKey) {
      Alert.alert('AI機能が未設定です', '設定 → AI でAPIキーを登録してください');
      return;
    }
    setIsSmartSearch(true);
    setSmartSearching(true);
    setSmartSearchAnswer('');
    try {
      const recent = await getRecentEmailsForSearch(selectedAccountId, 200);
      const payload = recent.map(e => ({ id: e.id, from: e.from, subject: e.subject, date: e.date, bodyText: e.bodyText }));
      const { answer, ids } = await mailApi.aiSmartSearch(openAiKey, q, payload);
      const idSet = new Set(ids);
      const matched = recent.filter(e => idSet.has(e.id)).map(emailToThread);
      setSmartSearchAnswer(answer);
      setSearchResults(matched);
    } catch {
      Alert.alert('エラー', 'AIスマート検索に失敗しました');
    } finally {
      setSmartSearching(false);
    }
  }

  const displayThreads = searchQuery.trim() ? (searchResults ?? []) : threads;

  const sections = groupByDate(displayThreads);

  useEffect(() => {
    if (!initialized || !selectedAccountId) return;
    // loadFolders がINBOXの実際の未読数（IMAP STATUS）を設定するので先に実行
    loadFolders(selectedAccountId);
    loadEmails(selectedAccountId, selectedFolder);
    loadThreads(selectedAccountId, selectedFolder);
    syncEmails(selectedAccountId, selectedFolder);
  }, [initialized, selectedAccountId, selectedFolder]);

  // 現在のフォルダのみ同期（送信済みなど他フォルダはsyncAllFoldersに任せる）
  const syncRelevantFolders = React.useCallback((currentFolder: string) => {
    if (!selectedAccountId) return;
    syncEmails(selectedAccountId, currentFolder);
  }, [selectedAccountId, syncEmails]);

  // 30秒ごと：現在のフォルダ＋送信済みを同期（高頻度・軽量）
  useEffect(() => {
    if (!initialized || !selectedAccountId) return;
    const timer = setInterval(() => {
      syncRelevantFolders(selectedFolder);
    }, 30_000);
    return () => clearInterval(timer);
  }, [initialized, selectedAccountId, selectedFolder, syncRelevantFolders]);

  // 5分ごと：全アカウントの全フォルダをバックグラウンド同期（バッジ数をMacと揃える）
  // useRefで初回同期の二重実行（StrictMode）を防ぐ
  const didInitialSync = useRef(false);
  useEffect(() => {
    if (!initialized || accounts.length === 0) return;
    if (!didInitialSync.current) {
      didInitialSync.current = true;
      for (const acc of accounts) syncAllFolders(acc.id);
    }
    const timer = setInterval(() => {
      for (const acc of accounts) syncAllFolders(acc.id);
    }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [initialized, accounts]);

  // アプリがフォアグラウンドに戻ったとき：現在フォルダを即同期＋全アカウント同期
  useEffect(() => {
    if (!initialized || accounts.length === 0) return;
    let lastActiveAt = 0;
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        const now = Date.now();
        if (now - lastActiveAt < 60_000) return; // 60秒以内の復帰は skip
        lastActiveAt = now;
        syncRelevantFolders(selectedFolder);
        for (const acc of accounts) syncAllFolders(acc.id);
      }
    });
    return () => sub.remove();
  }, [initialized, accounts, selectedFolder, syncRelevantFolders]);

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

  const onThreadPress = useCallback(async (thread: ThreadSummary) => {
    if (!selectedAccountId) return;
    await selectThread(selectedAccountId, thread.threadId, thread.folder || selectedFolder);
    router.push(`/email/${thread.latestEmailId}`);
  }, [selectedAccountId, selectedFolder]);

  const handleFolderSelect = (folderPath: string) => {
    setFolder(folderPath);
    closeDrawer();
    if (selectedAccountId) {
      setTimeout(() => {
        loadEmails(selectedAccountId, folderPath);
        loadThreads(selectedAccountId, folderPath);
        syncEmails(selectedAccountId, folderPath);
      }, 300);
    }
  };

  const handleAccountSelect = async (accountId: string) => {
    await selectAccount(accountId);
    closeDrawer();
  };

  const handleReportSpam = (target: ThreadSummary) => {
    Alert.alert(
      '迷惑メールとして報告',
      `${target.latestFrom.name || target.latestFrom.address} からのメールを迷惑メールフォルダに移動しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '報告', style: 'destructive',
          onPress: () => {
            if (selectedAccountId) {
              spamThread(selectedAccountId, target.threadId, target.folder || selectedFolder);
            }
            setMoveTarget(null);
          },
        },
      ],
    );
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
                  {threads.some(t => t.unreadCount > 0) && (
                    <>
                      <TouchableOpacity
                        style={s.pillBtn}
                        onPress={() => selectedAccountId && markAllRead(selectedAccountId, selectedFolder)}
                      >
                        <Ionicons name="checkmark-done-outline" size={18} color="#3C3C43" />
                      </TouchableOpacity>
                      <View style={s.pillDivider} />
                    </>
                  )}
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
          <View style={s.accountChipRow}>
            <View style={s.accountChip}>
              <View style={s.accountChipAvatar}>
                <Text style={s.accountChipAvatarText}>
                  {(selectedAccount.name || selectedAccount.email).charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={s.accountChipEmail} numberOfLines={1}>{selectedAccount.email}</Text>
            </View>
          </View>
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
            {searching && <ActivityIndicator size="small" color="#8E8E93" style={{ marginLeft: 6 }} />}
            {!!searchQuery.trim() && (
              <TouchableOpacity onPress={handleSmartSearch} disabled={smartSearching} style={{ marginLeft: 8 }}>
                {smartSearching
                  ? <ActivityIndicator size="small" color="#AF52DE" />
                  : <Ionicons name="sparkles" size={18} color={isSmartSearch ? '#AF52DE' : '#8E8E93'} />
                }
              </TouchableOpacity>
            )}
          </View>
        )}

        {isSmartSearch && !!smartSearchAnswer && (
          <View style={s.smartSearchBanner}>
            <Ionicons name="sparkles" size={14} color="#AF52DE" style={{ marginRight: 6, marginTop: 1 }} />
            <Text style={s.smartSearchText}>{smartSearchAnswer}</Text>
          </View>
        )}

        {error && (
          <View style={s.errorBanner}><Text style={s.errorText}>{error}</Text></View>
        )}


        {loading && threads.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={item => item.threadId}
            renderItem={({ item }) => (
              <SwipeableThreadItem
                thread={item}
                onPress={() => onThreadPress(item)}
                onDelete={() => selectedAccountId && deleteThread(selectedAccountId, item.threadId, item.folder || selectedFolder)}
                onMove={() => setMoveTarget(item)}
              />
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
            ListFooterComponent={
              (loadingMoreThreads || backfillingOlderEmails) ? (
                <View style={{ paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color="#007AFF" />
                  {backfillingOlderEmails && <Text style={{ fontSize: 12, color: '#8E8E93' }}>過去のメールを取得中...</Text>}
                </View>
              ) : null
            }
            onEndReached={() => selectedAccountId && loadMoreThreads(selectedAccountId)}
            onEndReachedThreshold={0.4}
            contentContainerStyle={sections.length === 0 ? { flex: 1 } : { paddingBottom: 100 }}
            stickySectionHeadersEnabled={false}
          />
        )}
      </SafeAreaView>

      {/* フォルダ移動モーダル */}
      {moveTarget && (() => {
        // サーバーフォルダが未取得の場合はフォールバックを使用
        const moveFolders: Array<{ path: string; label: string; icon: IconName; colorKey: keyof typeof FOLDER_COLORS }> =
          folders.length > 0
            ? folders
                .filter(f => {
                  const p = f.path.toLowerCase();
                  const su = (f.specialUse ?? '').toLowerCase();
                  if (p === '[gmail]') return false;
                  if (su === '\\allmail' || p.includes('all mail') || p.includes('allmail')) return false;
                  return true;
                })
                .map(f => { const m = folderMeta(f); return { path: f.path, label: m.label, icon: m.icon, colorKey: m.colorKey }; })
            : FALLBACK_FOLDERS;
        return (
          <Modal transparent animationType="slide" onRequestClose={() => setMoveTarget(null)}>
            <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setMoveTarget(null)}>
              <View style={[s.moveSheet, { paddingBottom: insets.bottom + 12 }]}>
                <View style={s.moveSheetHandle} />
                <Text style={s.moveSheetTitle}>フォルダへ移動</Text>
                <TouchableOpacity
                  style={s.folderRow}
                  onPress={() => moveTarget && handleReportSpam(moveTarget)}
                >
                  <View style={[s.folderIcon, { backgroundColor: '#FFE5E5' }]}>
                    <Ionicons name="warning-outline" size={18} color="#FF3B30" />
                  </View>
                  <Text style={[s.folderLabel, { color: '#FF3B30' }]}>迷惑メールとして報告</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.folderRow}
                  onPress={() => {
                    const target = moveTarget;
                    if (!target || !selectedAccountId) return;
                    const address = target.latestFrom.address;
                    setMoveTarget(null);
                    Alert.alert('送信者をブロック', `${address} をブロックしますか？\n今後このアドレスからのメールは自動的に削除されます。`, [
                      { text: 'キャンセル', style: 'cancel' },
                      {
                        text: 'ブロック', style: 'destructive', onPress: async () => {
                          await addToBlockList(selectedAccountId, address);
                        },
                      },
                    ]);
                  }}
                >
                  <View style={[s.folderIcon, { backgroundColor: '#FFE5E5' }]}>
                    <Ionicons name="ban-outline" size={18} color="#FF3B30" />
                  </View>
                  <Text style={[s.folderLabel, { color: '#FF3B30' }]}>送信者をブロック</Text>
                </TouchableOpacity>
                <View style={{ height: 0.5, backgroundColor: '#F0F0F0', marginVertical: 4 }} />
                <ScrollView bounces={false} style={{ maxHeight: 360 }}>
                  {moveFolders.map(f => {
                    const clr = FOLDER_COLORS[f.colorKey] ?? FOLDER_COLORS.default;
                    return (
                      <TouchableOpacity
                        key={f.path}
                        style={s.folderRow}
                        onPress={() => {
                          if (selectedAccountId && moveTarget) {
                            moveThread(selectedAccountId, moveTarget.threadId, moveTarget.folder || selectedFolder, f.path);
                          }
                          setMoveTarget(null);
                        }}
                      >
                        <View style={[s.folderIcon, { backgroundColor: clr.bg }]}>
                          <Ionicons name={f.icon as any} size={18} color={clr.icon} />
                        </View>
                        <Text style={s.folderLabel}>{f.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        );
      })()}

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

  // フォルダ並び替え（アカウントごとにローカルSQLiteへ保存）
  const [reorderMode, setReorderMode] = useState(false);
  const [orderedPaths, setOrderedPaths] = useState<string[]>([]);
  const orderKey = selectedAccountId ? `folderOrder:${selectedAccountId}` : null;

  useEffect(() => {
    if (!orderKey) { setOrderedPaths([]); return; }
    getAppSetting(orderKey).then(raw => {
      if (!raw) { setOrderedPaths([]); return; }
      try { setOrderedPaths(JSON.parse(raw)); } catch { setOrderedPaths([]); }
    });
  }, [orderKey]);

  function moveFolder(path: string, direction: -1 | 1, currentOrder: string[]) {
    const idx = currentOrder.indexOf(path);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= currentOrder.length) return;
    const next = [...currentOrder];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setOrderedPaths(next);
    if (orderKey) setAppSetting(orderKey, JSON.stringify(next)).catch(() => {});
  }

  // サーバーフォルダがあればそれを使い、なければフォールバック
  if (folders.length > 0) {
    console.log('[drawer] folders from store:', folders.map(f => f.path).join(', '));
  } else {
    console.log('[drawer] folders empty, showing fallback');
  }
  type DisplayFolder = { path: string; label: string; icon: IconName; colorKey: keyof typeof FOLDER_COLORS; unreadCount?: number };
  const rawDisplayFolders: DisplayFolder[] =
    folders.length > 0
      ? folders
          .filter(f => {
            const p = f.path.toLowerCase();
            const su = (f.specialUse ?? '').toLowerCase();
            // [Gmail] ネームスペース自体は除外
            if (p === '[gmail]') return false;
            // すべてのメール（All Mail）は非表示
            if (su === '\\allmail' || p.includes('all mail') || p.includes('allmail') || p.includes('すべてのメール')) return false;
            // 重要（Important）は非表示（INBOXと内容が重複するため）
            if (su === '\\important' || p.includes('重要') || p.includes('important')) return false;
            // 内部設定フォルダは非表示
            if (p === 'im-mail-config') return false;
            // Deleted/xxx, Trash/xxx などゴミ箱配下のサブフォルダは非表示
            if ((p.startsWith('deleted/') || p.startsWith('trash/'))) return false;
            return true;
          })
          .map(f => {
            const meta = folderMeta(f);
            return { path: f.path, label: meta.label, icon: meta.icon, colorKey: meta.colorKey, unreadCount: f.unreadCount };
          })
      : FALLBACK_FOLDERS;

  // 保存済み並び順 + 新規フォルダは末尾に追加
  const displayFolders: DisplayFolder[] = orderedPaths.length > 0
    ? [
        ...orderedPaths.map(p => rawDisplayFolders.find(f => f.path === p)).filter((f): f is DisplayFolder => !!f),
        ...rawDisplayFolders.filter(f => !orderedPaths.includes(f.path)),
      ]
    : rawDisplayFolders;

  return (
    <View style={[d.wrap, { paddingTop: insets.top + 4 }]}>
      {/* スクロール領域 */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        {/* ロゴ */}
        <View style={d.logoWrap}>
          <Image
            source={require('../assets/logo.png')}
            style={d.logo}
            resizeMode="contain"
          />
        </View>

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
          <Text style={d.sectionLabel}>フォルダ {folders.length > 0 ? `(${folders.length})` : '(未取得)'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <TouchableOpacity style={[d.syncBtn, { marginLeft: 0 }]} onPress={() => setReorderMode(v => !v)}>
              <Ionicons name={reorderMode ? 'checkmark' : 'reorder-three-outline'} size={16} color={reorderMode ? '#007AFF' : '#8E8E93'} />
            </TouchableOpacity>
            <TouchableOpacity style={d.syncBtn} onPress={onSync} disabled={syncing}>
              <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
                <Ionicons name="refresh-outline" size={16} color={syncing ? '#007AFF' : '#8E8E93'} />
              </Animated.View>
            </TouchableOpacity>
          </View>
        </View>

        {displayFolders.map((f, index) => {
          const isActive = f.path === selectedFolder;
          const color = FOLDER_COLORS[f.colorKey] ?? FOLDER_COLORS.default;
          const unread = folderUnreadCounts[f.path] ?? 0;
          const currentOrder = displayFolders.map(df => df.path);
          return (
            <TouchableOpacity
              key={f.path}
              style={[d.folderRow, isActive && d.folderRowActive]}
              onPress={() => reorderMode ? undefined : onFolderSelect(f.path)}
              disabled={reorderMode}
            >
              <View style={[d.folderIconWrap, { backgroundColor: isActive ? color.icon : color.bg }]}>
                <Ionicons name={f.icon} size={16} color={isActive ? '#fff' : color.icon} />
              </View>
              <Text style={[d.folderLabel, isActive && d.folderLabelActive]} numberOfLines={1}>
                {f.label}
              </Text>
              {reorderMode ? (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <TouchableOpacity
                    style={d.reorderBtn}
                    disabled={index === 0}
                    onPress={() => moveFolder(f.path, -1, currentOrder)}
                  >
                    <Ionicons name="chevron-up" size={16} color={index === 0 ? '#D1D1D6' : '#8E8E93'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={d.reorderBtn}
                    disabled={index === displayFolders.length - 1}
                    onPress={() => moveFolder(f.path, 1, currentOrder)}
                  >
                    <Ionicons name="chevron-down" size={16} color={index === displayFolders.length - 1 ? '#D1D1D6' : '#8E8E93'} />
                  </TouchableOpacity>
                </View>
              ) : unread > 0 && (
                <View style={[d.badge, isActive && d.badgeActive]}>
                  <Text style={[d.badgeText, isActive && d.badgeTextActive]}>{unread > 999 ? '999+' : unread}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 設定ボタン：常に下部に固定 */}
      <View style={d.settingsWrap}>
        <View style={d.settingsDivider} />
        <TouchableOpacity style={d.settingsRow} onPress={onSettings}>
          <View style={[d.folderIconWrap, { backgroundColor: '#F2F2F7' }]}>
            <Ionicons name="settings-outline" size={16} color="#8E8E93" />
          </View>
          <Text style={d.settingsLabel}>設定</Text>
        </TouchableOpacity>
        <View style={{ height: insets.bottom + 8 }} />
      </View>
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
  title: { fontSize: 17, fontWeight: '700', color: '#1C1C1E' },
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
  accountChipRow: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4 },
  accountChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: '#F2F2F7', borderRadius: 20,
    paddingRight: 12, paddingVertical: 3,
    borderWidth: 0.5, borderColor: '#E5E5EA',
  },
  accountChipAvatar: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#007AFF',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 6, marginLeft: 3,
  },
  accountChipAvatarText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  accountChipEmail: { fontSize: 12, color: '#3C3C43', fontWeight: '500', maxWidth: 240 },
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
  smartSearchBanner: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#F5F0FF', marginHorizontal: 16, marginBottom: 8,
    padding: 10, borderRadius: 10,
  },
  smartSearchText: { flex: 1, fontSize: 13, color: '#3C3C43', lineHeight: 18 },
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
  moveSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingHorizontal: 16, paddingTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12, shadowRadius: 8,
  },
  moveSheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#D1D1D6', alignSelf: 'center', marginBottom: 14,
  },
  moveSheetTitle: { fontSize: 17, fontWeight: '700', color: '#1C1C1E', marginBottom: 12 },
  folderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  folderIcon: {
    width: 36, height: 36, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  folderLabel: { fontSize: 16, color: '#1C1C1E' },
});


const d = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 12 },
  logoWrap: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4 },
  logo: { width: 150, height: 36 },
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
  reorderBtn: { padding: 4 },
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
  // 設定ボタン固定エリア
  settingsWrap: { paddingHorizontal: 0 },
  settingsDivider: { height: 0.5, backgroundColor: '#E5E5EA', marginHorizontal: 4, marginBottom: 4 },
  settingsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, paddingHorizontal: 8,
    borderRadius: 10,
  },
  settingsLabel: { fontSize: 15, color: '#3C3C43' },
});

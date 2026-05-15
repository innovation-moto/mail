import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  TextInput,
  Modal,
  Animated,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../../store/accountStore';
import { useMailStore } from '../../store/mailStore';
import EmailItem from '../../components/EmailItem';
import type { Email } from '../../shared/types';

// Folder list configuration
const FOLDERS = [
  { path: 'INBOX', name: '受信トレイ', icon: 'mail' as const },
  { path: 'Sent', name: '送信済み', icon: 'send' as const },
  { path: 'Drafts', name: '下書き', icon: 'document-text' as const },
  { path: 'Trash', name: 'ゴミ箱', icon: 'trash' as const },
  { path: 'Spam', name: 'スパム', icon: 'alert-circle' as const },
  { path: '[Gmail]/Starred', name: 'スター付き', icon: 'star' as const },
];

function getFolderName(path: string): string {
  const f = FOLDERS.find((x) => x.path === path);
  return f ? f.name : path;
}

export default function InboxScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [folderDrawerVisible, setFolderDrawerVisible] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);

  const { accounts, selectedAccountId, initialized } = useAccountStore();
  const {
    emails,
    selectedFolder,
    loading,
    syncing,
    error,
    loadEmails,
    syncEmails,
    setFolder,
    selectEmail,
    starEmail,
    deleteEmail,
  } = useMailStore();

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // Load + sync on mount or account/folder change
  useEffect(() => {
    if (!initialized || !selectedAccountId) return;
    loadEmails(selectedAccountId, selectedFolder);
    syncEmails(selectedAccountId, selectedFolder);
  }, [initialized, selectedAccountId, selectedFolder]);

  const onRefresh = useCallback(async () => {
    if (!selectedAccountId) return;
    setRefreshing(true);
    await syncEmails(selectedAccountId, selectedFolder);
    setRefreshing(false);
  }, [selectedAccountId, selectedFolder]);

  const onEmailPress = useCallback(
    (email: Email) => {
      selectEmail(email.id);
      router.push(`/email/${email.id}`);
    },
    [router],
  );

  const handleStar = useCallback(
    async (email: Email) => {
      await starEmail(email.id, email.uid, email.folder || selectedFolder, !email.isStarred);
    },
    [selectedFolder],
  );

  const handleDelete = useCallback(
    (email: Email) => {
      Alert.alert('削除', 'このメールを削除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: () => deleteEmail(email.id, email.uid, email.folder || selectedFolder),
        },
      ]);
    },
    [selectedFolder],
  );

  // Search filter
  const filteredEmails = searchText.trim()
    ? emails.filter((e) => {
        const q = searchText.toLowerCase();
        return (
          e.subject.toLowerCase().includes(q) ||
          e.from.name.toLowerCase().includes(q) ||
          e.from.address.toLowerCase().includes(q) ||
          e.bodyText.toLowerCase().includes(q)
        );
      })
    : emails;

  // Folder drawer animation
  const openDrawer = () => {
    setFolderDrawerVisible(true);
    Animated.spring(drawerAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closeDrawer = () => {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setFolderDrawerVisible(false));
  };

  const selectFolderItem = (path: string) => {
    setFolder(path);
    closeDrawer();
    if (selectedAccountId) {
      loadEmails(selectedAccountId, path);
      syncEmails(selectedAccountId, path);
    }
  };

  const toggleSearch = () => {
    if (searchVisible) {
      setSearchVisible(false);
      setSearchText('');
    } else {
      setSearchVisible(true);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  };

  const drawerTranslateY = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  if (!initialized) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator style={{ flex: 1 }} color="#007AFF" />
      </SafeAreaView>
    );
  }

  if (accounts.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="mail-outline" size={48} color="#C7C7CC" />
          </View>
          <Text style={styles.emptyStateTitle}>アカウントがありません</Text>
          <Text style={styles.emptyStateSubtitle}>
            メールアカウントを追加して{'\n'}受信トレイを確認しましょう
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/setup')}>
            <Text style={styles.primaryButtonText}>アカウントを追加</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.folderTitleBtn} onPress={openDrawer}>
          <Text style={styles.folderTitle}>{getFolderName(selectedFolder)}</Text>
          <Ionicons name="chevron-down" size={16} color="#007AFF" style={{ marginLeft: 2, marginTop: 2 }} />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {syncing && (
            <ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 8 }} />
          )}
          <TouchableOpacity style={styles.iconBtn} onPress={toggleSearch}>
            <Ionicons name={searchVisible ? 'close' : 'search'} size={22} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push('/compose')}
          >
            <Ionicons name="create-outline" size={22} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Account subtitle */}
      {selectedAccount && !searchVisible && (
        <View style={styles.accountBadge}>
          <Text style={styles.accountEmail} numberOfLines={1}>
            {selectedAccount.email}
          </Text>
        </View>
      )}

      {/* Search bar */}
      {searchVisible && (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color="#8E8E93" style={{ marginRight: 6 }} />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="メールを検索..."
            placeholderTextColor="#C7C7CC"
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
        </View>
      )}

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
        </View>
      )}

      {/* Email list */}
      {loading && filteredEmails.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>読み込み中...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredEmails}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <EmailItem
              email={item}
              onPress={() => onEmailPress(item)}
              onStar={() => handleStar(item)}
              onDelete={() => handleDelete(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#007AFF"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <Ionicons
                name={searchText ? 'search-outline' : 'mail-open-outline'}
                size={44}
                color="#C7C7CC"
              />
              <Text style={styles.emptyListTitle}>
                {searchText ? '検索結果がありません' : 'メールがありません'}
              </Text>
              {!searchText && (
                <Text style={styles.emptyListSub}>
                  下にスワイプして同期できます
                </Text>
              )}
            </View>
          }
          contentContainerStyle={filteredEmails.length === 0 ? { flex: 1 } : { paddingBottom: 16 }}
        />
      )}

      {/* Folder drawer modal */}
      <Modal
        visible={folderDrawerVisible}
        transparent
        animationType="none"
        onRequestClose={closeDrawer}
      >
        <Pressable style={styles.drawerOverlay} onPress={closeDrawer}>
          <Animated.View
            style={[
              styles.drawerSheet,
              { transform: [{ translateY: drawerTranslateY }] },
            ]}
          >
            <Pressable>
              {/* Handle bar */}
              <View style={styles.drawerHandle} />

              <Text style={styles.drawerTitle}>フォルダ</Text>

              {FOLDERS.map((folder) => {
                const isSelected = selectedFolder === folder.path;
                return (
                  <TouchableOpacity
                    key={folder.path}
                    style={[styles.folderItem, isSelected && styles.folderItemSelected]}
                    onPress={() => selectFolderItem(folder.path)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.folderIconWrap, isSelected && styles.folderIconSelected]}>
                      <Ionicons
                        name={folder.icon}
                        size={18}
                        color={isSelected ? '#FFFFFF' : '#007AFF'}
                      />
                    </View>
                    <Text style={[styles.folderItemText, isSelected && styles.folderItemTextSelected]}>
                      {folder.name}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={18} color="#007AFF" />
                    )}
                  </TouchableOpacity>
                );
              })}

              <View style={styles.drawerBottom} />
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  folderTitleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  folderTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconBtn: {
    padding: 6,
  },
  accountBadge: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  accountEmail: {
    fontSize: 13,
    color: '#8E8E93',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#000000',
    padding: 0,
  },
  separator: {
    height: 0.5,
    backgroundColor: '#E5E5EA',
    marginLeft: 74,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF3B30',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#8E8E93',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 60,
  },
  emptyListTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3C3C43',
  },
  emptyListSub: {
    fontSize: 13,
    color: '#8E8E93',
  },

  // Folder drawer
  drawerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  drawerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
  },
  drawerHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D1D6',
    marginBottom: 12,
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 12,
    marginLeft: 4,
  },
  folderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 12,
    marginBottom: 2,
  },
  folderItemSelected: {
    backgroundColor: '#F0F6FF',
  },
  folderIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#EAF3FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  folderIconSelected: {
    backgroundColor: '#007AFF',
  },
  folderItemText: {
    flex: 1,
    fontSize: 16,
    color: '#000000',
    fontWeight: '400',
  },
  folderItemTextSelected: {
    fontWeight: '600',
    color: '#007AFF',
  },
  drawerBottom: {
    height: 32,
  },
});

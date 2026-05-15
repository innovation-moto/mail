import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../../store/accountStore';
import { useMailStore } from '../../store/mailStore';
import EmailItem from '../../components/EmailItem';
import type { Email } from '@/shared/types';

export default function InboxScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { accounts, selectedAccountId, initialized } = useAccountStore();
  const {
    emails,
    selectedFolder,
    loading,
    syncing,
    error,
    loadEmails,
    syncEmails,
    selectEmail,
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

  if (!initialized) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (accounts.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.empty}>
          <Ionicons name="mail-outline" size={64} color="#C7C7CC" />
          <Text style={styles.emptyTitle}>アカウントがありません</Text>
          <Text style={styles.emptySubtitle}>設定からメールアカウントを追加してください</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/setup')}
          >
            <Text style={styles.addButtonText}>アカウントを追加</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.folderName}>{selectedFolder}</Text>
          {selectedAccount && (
            <Text style={styles.accountName}>{selectedAccount.email}</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          {syncing && <ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 8 }} />}
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="search" size={22} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Email list */}
      {loading && emails.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : (
        <FlatList
          data={emails}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <EmailItem email={item} onPress={() => onEmailPress(item)} />
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
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={48} color="#C7C7CC" />
              <Text style={styles.emptyTitle}>メールがありません</Text>
            </View>
          }
          contentContainerStyle={emails.length === 0 ? { flex: 1 } : undefined}
        />
      )}
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
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flex: 1,
  },
  folderName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
  },
  accountName: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 4,
  },
  separator: {
    height: 0.5,
    backgroundColor: '#F0F0F0',
    marginLeft: 72,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#3C3C43',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  addButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
});

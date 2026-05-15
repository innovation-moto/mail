import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../../store/accountStore';
import type { Account } from '../../../shared/types';

export default function SettingsScreen() {
  const router = useRouter();
  const { accounts, selectedAccountId, removeAccount, selectAccount } = useAccountStore();

  const handleRemoveAccount = (account: Account) => {
    Alert.alert(
      'アカウントを削除',
      `${account.email} を削除しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: () => removeAccount(account.id),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>設定</Text>
      </View>

      {/* Accounts section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>メールアカウント</Text>
        {accounts.length === 0 ? (
          <View style={styles.emptyAccounts}>
            <Text style={styles.emptyText}>アカウントがありません</Text>
          </View>
        ) : (
          accounts.map((account) => (
            <View key={account.id} style={styles.accountItem}>
              <TouchableOpacity
                style={styles.accountInfo}
                onPress={() => selectAccount(account.id)}
              >
                <View style={styles.accountAvatar}>
                  <Text style={styles.accountAvatarText}>
                    {account.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.accountDetails}>
                  <Text style={styles.accountName}>{account.name}</Text>
                  <Text style={styles.accountEmail}>{account.email}</Text>
                  <Text style={styles.accountProvider}>{account.provider}</Text>
                </View>
                {selectedAccountId === account.id && (
                  <Ionicons name="checkmark-circle" size={22} color="#007AFF" />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleRemoveAccount(account)}
              >
                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
              </TouchableOpacity>
            </View>
          ))
        )}

        <TouchableOpacity
          style={styles.addAccountButton}
          onPress={() => router.push('/setup')}
        >
          <Ionicons name="add-circle-outline" size={22} color="#007AFF" />
          <Text style={styles.addAccountText}>アカウントを追加</Text>
        </TouchableOpacity>
      </View>

      {/* App info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>アプリ情報</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>バージョン</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>アプリ名</Text>
          <Text style={styles.infoValue}>IM Mail</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#F2F2F7',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
  },
  section: {
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#C6C6C8',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6C6C70',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  accountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
  },
  accountInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  accountAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  accountDetails: {
    flex: 1,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
  },
  accountEmail: {
    fontSize: 13,
    color: '#666666',
    marginTop: 1,
  },
  accountProvider: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 1,
    textTransform: 'capitalize',
  },
  deleteButton: {
    padding: 8,
  },
  emptyAccounts: {
    padding: 16,
  },
  emptyText: {
    color: '#8E8E93',
    fontSize: 14,
  },
  addAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  addAccountText: {
    fontSize: 16,
    color: '#007AFF',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
  },
  infoLabel: {
    fontSize: 15,
    color: '#000000',
  },
  infoValue: {
    fontSize: 15,
    color: '#8E8E93',
  },
});

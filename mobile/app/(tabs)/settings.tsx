import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../../store/accountStore';
import type { Account } from '../../shared/types';

function getAvatarColor(name: string): string {
  const colors = ['#007AFF', '#34C759', '#AF52DE', '#FF9500', '#FF2D55', '#5856D6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + hash * 31;
  return colors[Math.abs(hash) % colors.length];
}

export default function SettingsScreen() {
  const router = useRouter();
  const { accounts, selectedAccountId, removeAccount, selectAccount } = useAccountStore();

  const handleSelectAccount = async (account: Account) => {
    await selectAccount(account.id);
  };

  const handleRemoveAccount = (account: Account) => {
    Alert.alert(
      'アカウントを削除',
      `${account.email} をこのデバイスから削除しますか？`,
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
      <ScrollView>
        {/* Page title */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>設定</Text>
        </View>

        {/* Accounts section */}
        <Text style={styles.sectionHeader}>メールアカウント</Text>
        <View style={styles.card}>
          {accounts.length === 0 ? (
            <View style={styles.emptyAccounts}>
              <Ionicons name="mail-outline" size={32} color="#C7C7CC" />
              <Text style={styles.emptyText}>アカウントがありません</Text>
            </View>
          ) : (
            accounts.map((account, index) => {
              const isSelected = selectedAccountId === account.id;
              const avatarColor = getAvatarColor(account.name || account.email);

              return (
                <View key={account.id}>
                  {index > 0 && <View style={styles.rowSeparator} />}
                  <View style={styles.accountRow}>
                    {/* Avatar + info (tap to select) */}
                    <TouchableOpacity
                      style={styles.accountInfo}
                      onPress={() => handleSelectAccount(account)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
                        <Text style={styles.avatarText}>
                          {(account.name || account.email).charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.accountDetails}>
                        <View style={styles.accountNameRow}>
                          <Text style={styles.accountName} numberOfLines={1}>
                            {account.name || account.email}
                          </Text>
                          {isSelected && (
                            <View style={styles.selectedBadge}>
                              <Text style={styles.selectedBadgeText}>使用中</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.accountEmail} numberOfLines={1}>
                          {account.email}
                        </Text>
                        <Text style={styles.accountProvider}>
                          {account.provider.charAt(0).toUpperCase() + account.provider.slice(1)}
                          {' · '}IMAP {account.imapHost}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Select checkmark */}
                    <TouchableOpacity
                      style={styles.selectBtn}
                      onPress={() => handleSelectAccount(account)}
                    >
                      <Ionicons
                        name={isSelected ? 'checkmark-circle' : 'radio-button-off'}
                        size={24}
                        color={isSelected ? '#007AFF' : '#C7C7CC'}
                      />
                    </TouchableOpacity>

                    {/* Delete button */}
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleRemoveAccount(account)}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={19} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          {/* Add account row */}
          <View style={accounts.length > 0 ? styles.rowSeparator : undefined} />
          <TouchableOpacity
            style={styles.addAccountRow}
            onPress={() => router.push('/setup')}
            activeOpacity={0.7}
          >
            <View style={styles.addIconWrap}>
              <Ionicons name="add" size={20} color="#007AFF" />
            </View>
            <Text style={styles.addAccountText}>アカウントを追加</Text>
            <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
          </TouchableOpacity>
        </View>

        {/* App section */}
        <Text style={styles.sectionHeader}>アプリ情報</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>アプリ名</Text>
            <Text style={styles.infoValue}>IM Mail</Text>
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>バージョン</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>プラットフォーム</Text>
            <Text style={styles.infoValue}>React Native + Expo</Text>
          </View>
        </View>

        {/* Help section */}
        <Text style={styles.sectionHeader}>ヘルプ</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.helpRow} activeOpacity={0.7}>
            <Ionicons name="help-circle-outline" size={20} color="#007AFF" style={{ marginRight: 12 }} />
            <Text style={styles.helpRowText}>サポートに問い合わせる</Text>
            <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
          </TouchableOpacity>
        </View>

        <View style={styles.footer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  pageHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6C6C70',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 7,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  rowSeparator: {
    height: 0.5,
    backgroundColor: '#E5E5EA',
    marginLeft: 68,
  },

  // Account row
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 12,
  },
  accountInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  accountDetails: {
    flex: 1,
    gap: 1,
  },
  accountNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
    flex: 1,
  },
  selectedBadge: {
    backgroundColor: '#E8F4FF',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  selectedBadgeText: {
    fontSize: 11,
    color: '#007AFF',
    fontWeight: '600',
  },
  accountEmail: {
    fontSize: 13,
    color: '#666666',
  },
  accountProvider: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 1,
  },
  selectBtn: {
    padding: 8,
  },
  deleteBtn: {
    padding: 8,
  },
  emptyAccounts: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#8E8E93',
  },

  // Add account
  addAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  addIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#E8F4FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addAccountText: {
    flex: 1,
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },

  // Info rows
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  infoLabel: {
    fontSize: 15,
    color: '#000000',
  },
  infoValue: {
    fontSize: 15,
    color: '#8E8E93',
  },

  // Help
  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  helpRowText: {
    flex: 1,
    fontSize: 16,
    color: '#000000',
  },

  footer: {
    height: 40,
  },
});

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  Alert, TextInput, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../store/accountStore';
import type { Account } from '@/shared/types';

function avatarColor(email: string): string {
  const colors = ['#007AFF','#34C759','#FF9500','#FF3B30','#AF52DE','#5856D6','#FF2D55','#00C7BE'];
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % colors.length;
  return colors[h];
}

export default function SettingsScreen() {
  const router = useRouter();
  const { accounts, selectedAccountId, removeAccount, selectAccount, openAiKey, saveOpenAiKey, clearOpenAiKey } = useAccountStore();

  const [keyInput, setKeyInput] = useState(openAiKey ?? '');
  const [keyVisible, setKeyVisible] = useState(false);
  const [keySaved, setKeySaved] = useState(!!openAiKey);

  const handleRemove = (account: Account) => {
    Alert.alert('アカウントを削除', `${account.email} を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => removeAccount(account.id) },
    ]);
  };

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      Alert.alert('エラー', 'APIキーを入力してください');
      return;
    }
    await saveOpenAiKey(trimmed);
    setKeySaved(true);
    Alert.alert('保存しました', 'OpenAI APIキーを保存しました');
  };

  const handleClearKey = () => {
    Alert.alert('APIキーを削除', '削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          await clearOpenAiKey();
          setKeyInput('');
          setKeySaved(false);
        },
      },
    ]);
  };

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

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* アカウントセクション */}
        <Text style={s.sectionLabel}>アカウント</Text>
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
                  <View style={s.activeBadge}>
                    <Text style={s.activeBadgeText}>使用中</Text>
                  </View>
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

        {/* AI設定セクション */}
        <Text style={s.sectionLabel}>AI機能</Text>
        <View style={s.aiCard}>
          <View style={s.aiHeader}>
            <Ionicons name="flash" size={18} color="#007AFF" style={{ marginRight: 6 }} />
            <Text style={s.aiTitle}>OpenAI APIキー</Text>
            {keySaved && (
              <View style={s.enabledBadge}>
                <Text style={s.enabledBadgeText}>有効</Text>
              </View>
            )}
          </View>
          <Text style={s.aiDesc}>
            メールの要約・AI返信・予定検出などのAI機能を使うにはOpenAIのAPIキーが必要です。
          </Text>
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
            <TouchableOpacity style={s.saveBtn} onPress={handleSaveKey}>
              <Text style={s.saveBtnText}>保存</Text>
            </TouchableOpacity>
            {keySaved && (
              <TouchableOpacity style={s.clearBtn} onPress={handleClearKey}>
                <Text style={s.clearBtnText}>削除</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={s.aiNote}>
          APIキーはデバイス内のセキュアストレージに保存され、OpenAI APIへのリクエスト時のみ使用されます。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA',
  },
  backBtn: { padding: 4 },
  title: { fontSize: 17, fontWeight: '600', color: '#000' },
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: '#8E8E93',
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
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
  activeBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginRight: 4 },
  activeBadgeText: { fontSize: 12, color: '#34C759', fontWeight: '600' },
  sep: { height: 0.5, backgroundColor: '#E5E5EA', marginLeft: 74 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    marginTop: 1, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#E5E5EA',
  },
  addBtnText: { fontSize: 15, color: '#007AFF', fontWeight: '500' },
  // AI section
  aiCard: { backgroundColor: '#fff', marginHorizontal: 0, paddingHorizontal: 16, paddingVertical: 16 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  aiTitle: { fontSize: 15, fontWeight: '600', color: '#000', flex: 1 },
  enabledBadge: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  enabledBadgeText: { fontSize: 12, color: '#007AFF', fontWeight: '600' },
  aiDesc: { fontSize: 13, color: '#8E8E93', lineHeight: 18, marginBottom: 12 },
  keyRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10,
    backgroundColor: '#F9F9F9', paddingHorizontal: 12, marginBottom: 10,
  },
  keyInput: { flex: 1, fontSize: 14, color: '#000', paddingVertical: 10 },
  eyeBtn: { padding: 4 },
  keyActions: { flexDirection: 'row', gap: 8 },
  saveBtn: {
    flex: 1, backgroundColor: '#007AFF', borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  clearBtn: {
    paddingHorizontal: 16, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#FF3B30',
  },
  clearBtnText: { color: '#FF3B30', fontWeight: '600', fontSize: 15 },
  aiNote: { fontSize: 12, color: '#8E8E93', paddingHorizontal: 16, paddingTop: 8, lineHeight: 16 },
});

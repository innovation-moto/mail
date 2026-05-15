import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../../store/accountStore';
import { mailApi } from '../../lib/api';
import type { ComposeData } from '@/shared/types';

export default function ComposeScreen() {
  const router = useRouter();
  const { getSelectedAccount, getPassword, selectedAccountId } = useAccountStore();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showCc, setShowCc] = useState(false);

  const account = getSelectedAccount();

  const handleSend = async () => {
    if (!account) {
      Alert.alert('エラー', 'アカウントが選択されていません');
      return;
    }

    const toAddresses = to.split(',').map((s) => s.trim()).filter(Boolean);
    if (toAddresses.length === 0) {
      Alert.alert('エラー', '宛先を入力してください');
      return;
    }

    const password = await getPassword(account.id);
    if (!password) {
      Alert.alert('エラー', 'パスワードが見つかりません');
      return;
    }

    const ccAddresses = cc.split(',').map((s) => s.trim()).filter(Boolean);

    const compose: ComposeData = {
      accountId: account.id,
      to: toAddresses,
      cc: ccAddresses,
      bcc: [],
      subject,
      bodyText: body,
    };

    setSending(true);
    try {
      await mailApi.send(account, password, compose);
      Alert.alert('送信完了', 'メールを送信しました', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert('送信エラー', (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.cancelButton}>
          <Text style={styles.cancelText}>キャンセル</Text>
        </TouchableOpacity>
        <Text style={styles.title}>新規メール</Text>
        <TouchableOpacity
          onPress={handleSend}
          disabled={sending}
          style={styles.sendButton}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : (
            <Ionicons name="send" size={20} color="#007AFF" />
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
          {/* From */}
          <View style={styles.field}>
            <Text style={styles.label}>From</Text>
            <Text style={styles.fromValue}>{account?.email ?? '（アカウントなし）'}</Text>
          </View>

          {/* To */}
          <View style={styles.field}>
            <Text style={styles.label}>To</Text>
            <TextInput
              style={styles.input}
              value={to}
              onChangeText={setTo}
              placeholder="宛先を入力..."
              placeholderTextColor="#C7C7CC"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowCc(!showCc)} style={styles.ccToggle}>
              <Text style={styles.ccToggleText}>Cc</Text>
            </TouchableOpacity>
          </View>

          {/* Cc */}
          {showCc && (
            <View style={styles.field}>
              <Text style={styles.label}>Cc</Text>
              <TextInput
                style={styles.input}
                value={cc}
                onChangeText={setCc}
                placeholder="Cc を入力..."
                placeholderTextColor="#C7C7CC"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          {/* Subject */}
          <View style={styles.field}>
            <Text style={styles.label}>件名</Text>
            <TextInput
              style={styles.input}
              value={subject}
              onChangeText={setSubject}
              placeholder="件名を入力..."
              placeholderTextColor="#C7C7CC"
            />
          </View>

          {/* Separator */}
          <View style={styles.bodySeparator} />

          {/* Body */}
          <TextInput
            style={styles.bodyInput}
            value={body}
            onChangeText={setBody}
            placeholder="メール本文を入力..."
            placeholderTextColor="#C7C7CC"
            multiline
            textAlignVertical="top"
          />
        </ScrollView>
      </KeyboardAvoidingView>
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
  },
  cancelButton: {
    minWidth: 60,
  },
  cancelText: {
    fontSize: 16,
    color: '#007AFF',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
  },
  sendButton: {
    minWidth: 40,
    alignItems: 'flex-end',
  },
  form: {
    flex: 1,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
  },
  label: {
    width: 48,
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#000000',
    padding: 0,
  },
  fromValue: {
    flex: 1,
    fontSize: 15,
    color: '#3C3C43',
  },
  ccToggle: {
    padding: 4,
  },
  ccToggleText: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '500',
  },
  bodySeparator: {
    height: 0.5,
    backgroundColor: '#E5E5EA',
  },
  bodyInput: {
    flex: 1,
    fontSize: 15,
    color: '#000000',
    paddingHorizontal: 16,
    paddingTop: 12,
    minHeight: 300,
  },
});

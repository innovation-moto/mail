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
import { useAccountStore } from '../store/accountStore';
import { mailApi } from '../lib/api';
import type { Account, AccountConfig } from '../../shared/types';
import { PROVIDER_PRESETS } from '../../shared/types';

type Provider = 'gmail' | 'outlook' | 'yahoo' | 'custom';

interface ProviderCard {
  id: Provider;
  label: string;
  icon: string;
  color: string;
}

const PROVIDERS: ProviderCard[] = [
  { id: 'gmail', label: 'Gmail', icon: 'mail', color: '#EA4335' },
  { id: 'outlook', label: 'Outlook', icon: 'mail', color: '#0078D4' },
  { id: 'yahoo', label: 'Yahoo', icon: 'mail', color: '#6001D2' },
  { id: 'custom', label: 'カスタム', icon: 'settings', color: '#8E8E93' },
];

export default function SetupScreen() {
  const router = useRouter();
  const { addAccount } = useAccountStore();

  const [step, setStep] = useState<'provider' | 'credentials'>('provider');
  const [provider, setProvider] = useState<Provider>('gmail');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ imap: boolean; smtp: boolean; imapError?: string; smtpError?: string } | null>(null);

  const selectProvider = (p: Provider) => {
    setProvider(p);
    const preset = PROVIDER_PRESETS[p];
    if (preset) {
      setImapHost(preset.imapHost ?? '');
      setImapPort(String(preset.imapPort ?? 993));
      setImapSecure(preset.imapSecure ?? true);
      setSmtpHost(preset.smtpHost ?? '');
      setSmtpPort(String(preset.smtpPort ?? 587));
      setSmtpSecure(preset.smtpSecure ?? false);
    }
    setStep('credentials');
  };

  const buildAccountConfig = (): AccountConfig => ({
    name: name || email.split('@')[0],
    email,
    password,
    provider,
    imapHost,
    imapPort: parseInt(imapPort, 10) || 993,
    imapSecure,
    smtpHost,
    smtpPort: parseInt(smtpPort, 10) || 587,
    smtpSecure,
  });

  const handleTest = async () => {
    if (!email || !password) {
      Alert.alert('エラー', 'メールアドレスとパスワードを入力してください');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // Build a temporary Account-like object for the API
      const tempAccount: Account = {
        id: 'test',
        name: name || email,
        email,
        provider,
        imapHost,
        imapPort: parseInt(imapPort, 10) || 993,
        imapSecure,
        smtpHost,
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpSecure,
        createdAt: Date.now(),
      };
      const result = await mailApi.testConnection(tempAccount, password);
      setTestResult(result);
    } catch (err) {
      Alert.alert('接続テストエラー', (err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!email || !password) {
      Alert.alert('エラー', 'メールアドレスとパスワードを入力してください');
      return;
    }
    setSaving(true);
    try {
      const account: Account = {
        id: `${email}-${Date.now()}`,
        name: name || email.split('@')[0],
        email,
        provider,
        imapHost,
        imapPort: parseInt(imapPort, 10) || 993,
        imapSecure,
        smtpHost,
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpSecure,
        createdAt: Date.now(),
      };
      await addAccount(account, password);
      Alert.alert('追加完了', 'アカウントを追加しました', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert('保存エラー', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (step === 'provider') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#000000" />
          </TouchableOpacity>
          <Text style={styles.title}>アカウントを追加</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.providerList}>
          <Text style={styles.sectionLabel}>メールプロバイダーを選択</Text>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.providerCard}
              onPress={() => selectProvider(p.id)}
            >
              <View style={[styles.providerIcon, { backgroundColor: p.color }]}>
                <Ionicons name={p.icon as any} size={24} color="#FFFFFF" />
              </View>
              <Text style={styles.providerLabel}>{p.label}</Text>
              <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setStep('provider')} style={styles.closeButton}>
          <Ionicons name="chevron-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        <Text style={styles.title}>{PROVIDERS.find((p) => p.id === provider)?.label}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
          {/* Basic credentials */}
          <Text style={styles.sectionLabel}>基本情報</Text>
          <View style={styles.fieldGroup}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>名前</Text>
              <TextInput
                style={styles.fieldInput}
                value={name}
                onChangeText={setName}
                placeholder="表示名"
                placeholderTextColor="#C7C7CC"
                autoCapitalize="words"
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.fieldLabel}>メール</Text>
              <TextInput
                style={styles.fieldInput}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#C7C7CC"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.fieldLabel}>パスワード</Text>
              <TextInput
                style={styles.fieldInput}
                value={password}
                onChangeText={setPassword}
                placeholder="パスワード / アプリパスワード"
                placeholderTextColor="#C7C7CC"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* IMAP settings */}
          <Text style={styles.sectionLabel}>IMAP設定</Text>
          <View style={styles.fieldGroup}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>ホスト</Text>
              <TextInput
                style={styles.fieldInput}
                value={imapHost}
                onChangeText={setImapHost}
                placeholder="imap.example.com"
                placeholderTextColor="#C7C7CC"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.fieldLabel}>ポート</Text>
              <TextInput
                style={styles.fieldInput}
                value={imapPort}
                onChangeText={setImapPort}
                placeholder="993"
                placeholderTextColor="#C7C7CC"
                keyboardType="number-pad"
              />
            </View>
            <TouchableOpacity
              style={[styles.field, styles.fieldBorder]}
              onPress={() => setImapSecure(!imapSecure)}
            >
              <Text style={styles.fieldLabel}>SSL/TLS</Text>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleValue}>{imapSecure ? 'ON' : 'OFF'}</Text>
                <Ionicons
                  name={imapSecure ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={imapSecure ? '#007AFF' : '#C7C7CC'}
                />
              </View>
            </TouchableOpacity>
          </View>

          {/* SMTP settings */}
          <Text style={styles.sectionLabel}>SMTP設定</Text>
          <View style={styles.fieldGroup}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>ホスト</Text>
              <TextInput
                style={styles.fieldInput}
                value={smtpHost}
                onChangeText={setSmtpHost}
                placeholder="smtp.example.com"
                placeholderTextColor="#C7C7CC"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={[styles.field, styles.fieldBorder]}>
              <Text style={styles.fieldLabel}>ポート</Text>
              <TextInput
                style={styles.fieldInput}
                value={smtpPort}
                onChangeText={setSmtpPort}
                placeholder="587"
                placeholderTextColor="#C7C7CC"
                keyboardType="number-pad"
              />
            </View>
            <TouchableOpacity
              style={[styles.field, styles.fieldBorder]}
              onPress={() => setSmtpSecure(!smtpSecure)}
            >
              <Text style={styles.fieldLabel}>SSL/TLS</Text>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleValue}>{smtpSecure ? 'ON' : 'OFF'}</Text>
                <Ionicons
                  name={smtpSecure ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={smtpSecure ? '#007AFF' : '#C7C7CC'}
                />
              </View>
            </TouchableOpacity>
          </View>

          {/* Test result */}
          {testResult && (
            <View style={styles.testResult}>
              <View style={styles.testRow}>
                <Ionicons
                  name={testResult.imap ? 'checkmark-circle' : 'close-circle'}
                  size={20}
                  color={testResult.imap ? '#34C759' : '#FF3B30'}
                />
                <Text style={styles.testLabel}>IMAP</Text>
                {testResult.imapError && (
                  <Text style={styles.testError} numberOfLines={2}>{testResult.imapError}</Text>
                )}
              </View>
              <View style={styles.testRow}>
                <Ionicons
                  name={testResult.smtp ? 'checkmark-circle' : 'close-circle'}
                  size={20}
                  color={testResult.smtp ? '#34C759' : '#FF3B30'}
                />
                <Text style={styles.testLabel}>SMTP</Text>
                {testResult.smtpError && (
                  <Text style={styles.testError} numberOfLines={2}>{testResult.smtpError}</Text>
                )}
              </View>
            </View>
          )}

          {/* Action buttons */}
          <TouchableOpacity
            style={styles.testButton}
            onPress={handleTest}
            disabled={testing}
          >
            {testing ? (
              <ActivityIndicator color="#007AFF" />
            ) : (
              <Text style={styles.testButtonText}>接続テスト</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>アカウントを保存</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#F2F2F7',
  },
  closeButton: {
    width: 40,
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
  },
  content: {
    flex: 1,
  },
  providerList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 14,
  },
  providerIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  providerLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#000000',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6C6C70',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  fieldGroup: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
  },
  fieldBorder: {
    borderTopWidth: 0.5,
    borderTopColor: '#E5E5EA',
  },
  fieldLabel: {
    width: 80,
    fontSize: 15,
    color: '#000000',
    fontWeight: '400',
  },
  fieldInput: {
    flex: 1,
    fontSize: 15,
    color: '#000000',
    padding: 0,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleValue: {
    fontSize: 14,
    color: '#8E8E93',
  },
  testResult: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  testLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
    minWidth: 50,
  },
  testError: {
    flex: 1,
    fontSize: 12,
    color: '#FF3B30',
  },
  testButton: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  testButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  saveButton: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#007AFF',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

import React, { useState, useEffect, useRef } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAccountStore } from '../../store/accountStore';
import { mailApi } from '../../lib/api';
import { getEmail } from '../../lib/db';
import type { ComposeData, Email } from '../../shared/types';

type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

function buildQuotedBody(original: Email, mode: 'reply' | 'replyAll' | 'forward'): string {
  const date = new Date(original.date).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const from = original.from.name
    ? `${original.from.name} <${original.from.address}>`
    : original.from.address;

  const divider = `\n\n---\n${date}、${from} のメール:`;
  const quoted = (original.bodyText || '')
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

  return `${divider}\n${quoted}`;
}

export default function ComposeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; emailId?: string }>();
  const { getSelectedAccount, getPassword } = useAccountStore();

  const mode: ComposeMode = (params.mode as ComposeMode) || 'new';
  const emailId = params.emailId || null;

  const [originalEmail, setOriginalEmail] = useState<Email | null>(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [loadingOriginal, setLoadingOriginal] = useState(!!emailId);

  const toInputRef = useRef<TextInput>(null);

  const account = getSelectedAccount();

  // Load original email for reply/forward
  useEffect(() => {
    if (!emailId) return;
    (async () => {
      const orig = await getEmail(emailId);
      setOriginalEmail(orig);
      setLoadingOriginal(false);

      if (!orig) return;

      if (mode === 'reply') {
        setTo(orig.from.address);
        setSubject(`Re: ${orig.subject.replace(/^Re:\s*/i, '')}`);
        setBody(buildQuotedBody(orig, 'reply'));
      } else if (mode === 'replyAll') {
        const replyToAddresses = [orig.from.address];
        orig.to.forEach((t) => {
          if (t.address !== account?.email) replyToAddresses.push(t.address);
        });
        setTo(replyToAddresses.join(', '));
        const ccAddresses = orig.cc?.map((c) => c.address) ?? [];
        if (ccAddresses.length > 0) {
          setCc(ccAddresses.join(', '));
          setShowCc(true);
        }
        setSubject(`Re: ${orig.subject.replace(/^Re:\s*/i, '')}`);
        setBody(buildQuotedBody(orig, 'replyAll'));
      } else if (mode === 'forward') {
        setTo('');
        setSubject(`Fwd: ${orig.subject.replace(/^Fwd:\s*/i, '')}`);
        setBody(buildQuotedBody(orig, 'forward'));
      }
    })();
  }, [emailId, mode]);

  const getTitleForMode = (): string => {
    switch (mode) {
      case 'reply': return '返信';
      case 'replyAll': return '全員返信';
      case 'forward': return '転送';
      default: return '新規メール';
    }
  };

  const handleSend = async () => {
    if (!account) {
      Alert.alert('エラー', 'アカウントが選択されていません');
      return;
    }

    const toAddresses = to
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

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
    const bccAddresses = bcc.split(',').map((s) => s.trim()).filter(Boolean);

    const compose: ComposeData = {
      accountId: account.id,
      to: toAddresses,
      cc: ccAddresses,
      bcc: bccAddresses,
      subject,
      bodyText: body,
      replyToMessageId: originalEmail?.messageId,
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

  const handleDiscard = () => {
    if (to || subject || body.trim()) {
      Alert.alert('破棄', 'この下書きを破棄しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        { text: '破棄', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  };

  if (loadingOriginal) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.cancelBtn} onPress={handleDiscard}>
          <Text style={styles.cancelText}>キャンセル</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{getTitleForMode()}</Text>
        <TouchableOpacity
          onPress={handleSend}
          disabled={sending}
          style={styles.sendBtn}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <View style={styles.sendBtnInner}>
              <Ionicons name="send" size={16} color="#FFFFFF" />
              <Text style={styles.sendBtnText}>送信</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
          {/* From */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>From</Text>
            <Text style={styles.fromValue} numberOfLines={1}>
              {account ? `${account.name} <${account.email}>` : '（アカウントなし）'}
            </Text>
          </View>

          {/* To */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>To</Text>
            <TextInput
              ref={toInputRef}
              style={styles.fieldInput}
              value={to}
              onChangeText={setTo}
              placeholder="宛先..."
              placeholderTextColor="#C7C7CC"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={() => { setShowCc(!showCc); }}
              style={styles.ccToggle}
            >
              <Text style={styles.ccToggleText}>Cc/Bcc</Text>
            </TouchableOpacity>
          </View>

          {/* Cc */}
          {showCc && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Cc</Text>
              <TextInput
                style={styles.fieldInput}
                value={cc}
                onChangeText={setCc}
                placeholder="Cc..."
                placeholderTextColor="#C7C7CC"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowBcc(!showBcc)}
                style={styles.ccToggle}
              >
                <Text style={styles.ccToggleText}>Bcc</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Bcc */}
          {showBcc && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Bcc</Text>
              <TextInput
                style={styles.fieldInput}
                value={bcc}
                onChangeText={setBcc}
                placeholder="Bcc..."
                placeholderTextColor="#C7C7CC"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          {/* Subject */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>件名</Text>
            <TextInput
              style={styles.fieldInput}
              value={subject}
              onChangeText={setSubject}
              placeholder="件名..."
              placeholderTextColor="#C7C7CC"
              returnKeyType="next"
            />
          </View>

          <View style={styles.bodySeparator} />

          {/* Body */}
          <TextInput
            style={styles.bodyInput}
            value={body}
            onChangeText={setBody}
            placeholder="メール本文..."
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
  flex1: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
  },
  cancelBtn: {
    minWidth: 64,
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
  sendBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
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
    minHeight: 44,
  },
  fieldLabel: {
    width: 44,
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  fieldInput: {
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
    paddingLeft: 8,
    paddingVertical: 2,
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
    fontSize: 15,
    color: '#000000',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    minHeight: 320,
    lineHeight: 22,
  },
});

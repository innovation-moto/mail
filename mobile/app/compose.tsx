import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Platform,
  InputAccessoryView, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useAccountStore } from '../store/accountStore';
import { useMailStore } from '../store/mailStore';
import { mailApi } from '../lib/api';
import { getEmail } from '../lib/db';
import type { Email } from '@/shared/types';

type Mode = 'new' | 'reply' | 'replyAll' | 'forward';
type Attachment = { filename: string; content: string; contentType: string; size: number };

const TOOLBAR_ID = 'compose-toolbar';

export default function ComposeScreen() {
  const { mode = 'new', emailId, aiBody } = useLocalSearchParams<{ mode?: Mode; emailId?: string; aiBody?: string }>();
  const router = useRouter();
  const { getSelectedAccount, getPassword, accounts } = useAccountStore();
  const { folders, syncEmails } = useMailStore();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const toRef = useRef<TextInput>(null);

  const account = getSelectedAccount();

  const sentFolderPath = React.useMemo(() => {
    const f = folders.find(f => {
      const su = (f.specialUse ?? '').toLowerCase();
      const p = f.path.toLowerCase();
      return su === '\\sent' || p.includes('sent') || p.includes('送信');
    });
    return f?.path ?? null;
  }, [folders]);

  useEffect(() => {
    // キーボードを自動表示
    const t = setTimeout(() => toRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!emailId || mode === 'new') return;
    (async () => {
      const orig = await getEmail(emailId);
      if (!orig) return;
      if (mode === 'reply') {
        setTo(orig.from.address);
        setSubject(`Re: ${orig.subject}`);
        setBody(aiBody ? decodeURIComponent(aiBody) + '\n\n' + buildQuote(orig) : buildQuote(orig));
      } else if (mode === 'replyAll') {
        const toAddrs = [orig.from.address, ...orig.to.map(t => t.address)].filter(a => a !== account?.email).join(', ');
        setTo(toAddrs);
        if (orig.cc?.length > 0) { setCc(orig.cc.map(c => c.address).join(', ')); setShowCcBcc(true); }
        setSubject(`Re: ${orig.subject}`);
        setBody(buildQuote(orig));
      } else if (mode === 'forward') {
        setSubject(`Fwd: ${orig.subject}`);
        setBody(buildQuote(orig, true));
      }
    })();
  }, [emailId, mode]);

  const buildQuote = (orig: Email, isForward = false): string => {
    const header = isForward
      ? `\n\n---------- 転送メッセージ ----------\n送信者: ${orig.from.name || orig.from.address} <${orig.from.address}>\n日時: ${new Date(orig.date).toLocaleString('ja-JP')}\n件名: ${orig.subject}\n\n`
      : `\n\n${new Date(orig.date).toLocaleString('ja-JP')} ${orig.from.name || orig.from.address} <${orig.from.address}> :\n`;
    const text = orig.bodyText || orig.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return header + text.split('\n').map((l: string) => `> ${l}`).join('\n');
  };

  const handleAttach = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const newAtts: Attachment[] = await Promise.all(
        result.assets.map(async (asset) => {
          const res = await fetch(asset.uri);
          const blob = await res.blob();
          return new Promise<Attachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1];
              resolve({ filename: asset.name, content: base64, contentType: asset.mimeType ?? 'application/octet-stream', size: asset.size ?? 0 });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })
      );
      setAttachments(prev => [...prev, ...newAtts]);
    } catch {
      Alert.alert('エラー', 'ファイルの選択に失敗しました');
    }
  };

  const removeAttachment = (index: number) => setAttachments(prev => prev.filter((_, i) => i !== index));

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const handleSend = async () => {
    if (!account) { Alert.alert('エラー', 'アカウントが選択されていません'); return; }
    if (!to.trim()) { Alert.alert('エラー', '宛先を入力してください'); return; }
    const password = await getPassword(account.id);
    if (!password) { Alert.alert('エラー', 'パスワードが取得できません'); return; }
    setSending(true);
    try {
      await mailApi.send(account, password, {
        accountId: account.id,
        to: to.split(',').map(s => s.trim()).filter(Boolean),
        cc: showCcBcc && cc.trim() ? cc.split(',').map(s => s.trim()).filter(Boolean) : [],
        bcc: showCcBcc && bcc.trim() ? bcc.split(',').map(s => s.trim()).filter(Boolean) : [],
        subject,
        bodyText: body,
        bodyHtml: '',
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      if (sentFolderPath) syncEmails(account.id, sentFolderPath).catch(() => {});
      router.back();
    } catch (err) {
      Alert.alert('送信エラー', (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const toolbar = (
    <View style={s.toolbar}>
      <TouchableOpacity onPress={handleAttach} style={s.toolbarBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="attach" size={22} color="#007AFF" />
      </TouchableOpacity>
      <View style={{ flex: 1 }} />
      <TouchableOpacity
        onPress={handleSend}
        disabled={sending || !to.trim()}
        style={[s.sendIconBtn, (sending || !to.trim()) && { opacity: 0.4 }]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {sending
          ? <ActivityIndicator size="small" color="#fff" />
          : <Ionicons name="send" size={18} color="#fff" />
        }
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* ヘッダー */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <View style={s.closeCircle}>
            <Ionicons name="close" size={16} color="#666" />
          </View>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{account?.email ?? '新規作成'}</Text>
          {accounts.length > 1 && <Ionicons name="chevron-down" size={12} color="#8E8E93" style={{ marginLeft: 2 }} />}
        </View>
        <View style={{ width: 36 }} />
      </View>

      {Platform.OS === 'ios' ? (
        <>
          <ScrollView style={{ flex: 1 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
            {renderFields()}
          </ScrollView>
          <InputAccessoryView nativeID={TOOLBAR_ID}>
            {toolbar}
          </InputAccessoryView>
        </>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {renderFields()}
          </ScrollView>
          {toolbar}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );

  function renderFields() {
    return (
      <>
        {/* 宛先 */}
        <View style={s.row}>
          <Text style={s.label}>宛先</Text>
          <TextInput
            ref={toRef}
            style={s.input}
            value={to}
            onChangeText={setTo}
            placeholder="メールアドレス"
            placeholderTextColor="#C7C7CC"
            keyboardType="email-address"
            autoCapitalize="none"
            multiline
            inputAccessoryViewID={Platform.OS === 'ios' ? TOOLBAR_ID : undefined}
          />
          {!showCcBcc && (
            <TouchableOpacity onPress={() => setShowCcBcc(true)} style={s.ccBccBtn}>
              <Text style={s.ccBccText}>Cc: Bcc:</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={s.sep} />

        {showCcBcc && (
          <>
            <View style={s.row}>
              <Text style={s.label}>Cc</Text>
              <TextInput
                style={s.input}
                value={cc}
                onChangeText={setCc}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                keyboardType="email-address"
                autoCapitalize="none"
                multiline
                inputAccessoryViewID={Platform.OS === 'ios' ? TOOLBAR_ID : undefined}
              />
            </View>
            <View style={s.sep} />
            <View style={s.row}>
              <Text style={s.label}>Bcc</Text>
              <TextInput
                style={s.input}
                value={bcc}
                onChangeText={setBcc}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                keyboardType="email-address"
                autoCapitalize="none"
                multiline
                inputAccessoryViewID={Platform.OS === 'ios' ? TOOLBAR_ID : undefined}
              />
            </View>
            <View style={s.sep} />
          </>
        )}

        {/* 件名 */}
        <View style={s.row}>
          <Text style={s.label}>件名</Text>
          <TextInput
            style={s.input}
            value={subject}
            onChangeText={setSubject}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            inputAccessoryViewID={Platform.OS === 'ios' ? TOOLBAR_ID : undefined}
          />
        </View>
        <View style={s.sep} />

        {/* 本文 */}
        <TextInput
          style={s.body}
          value={body}
          onChangeText={setBody}
          placeholder="本文を入力してください"
          placeholderTextColor="#C7C7CC"
          multiline
          textAlignVertical="top"
          inputAccessoryViewID={Platform.OS === 'ios' ? TOOLBAR_ID : undefined}
        />

        {/* 添付ファイル */}
        {attachments.length > 0 && (
          <View style={s.attachList}>
            {attachments.map((att, i) => (
              <View key={i} style={s.attachItem}>
                <Ionicons name="document-attach-outline" size={15} color="#007AFF" />
                <Text style={s.attachName} numberOfLines={1}>{att.filename}</Text>
                <Text style={s.attachSize}>{formatSize(att.size)}</Text>
                <TouchableOpacity onPress={() => removeAttachment(i)}>
                  <Ionicons name="close-circle" size={17} color="#8E8E93" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </>
    );
  }
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA',
  },
  headerClose: { width: 36, alignItems: 'flex-start' },
  closeCircle: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#E5E5EA',
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 11, minHeight: 44 },
  label: { width: 36, fontSize: 15, color: '#000', paddingTop: 1 },
  input: { flex: 1, fontSize: 15, color: '#000', lineHeight: 20, paddingTop: 0 },
  ccBccBtn: { paddingLeft: 8, paddingTop: 2, borderWidth: 0.5, borderColor: '#C7C7CC', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  ccBccText: { fontSize: 13, color: '#8E8E93' },
  sep: { height: 0.5, backgroundColor: '#E5E5EA' },
  body: { minHeight: 260, fontSize: 15, color: '#000', padding: 16, lineHeight: 22, textAlignVertical: 'top' },
  attachList: { paddingHorizontal: 16, paddingBottom: 12, gap: 6 },
  attachItem: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  attachName: { flex: 1, fontSize: 13, color: '#000' },
  attachSize: { fontSize: 12, color: '#8E8E93' },
  toolbar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 0.5, borderTopColor: '#E5E5EA',
    backgroundColor: '#F9F9F9',
  },
  toolbarBtn: { padding: 4 },
  sendIconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#007AFF',
    alignItems: 'center', justifyContent: 'center',
  },
});

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
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

export default function ComposeScreen() {
  const { mode = 'new', emailId, aiBody } = useLocalSearchParams<{ mode?: Mode; emailId?: string; aiBody?: string }>();
  const router = useRouter();
  const { getSelectedAccount, getPassword } = useAccountStore();
  const { folders, syncEmails } = useMailStore();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

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
    if (!emailId || mode === 'new') return;
    (async () => {
      const orig = await getEmail(emailId);
      if (!orig) return;
      if (mode === 'reply') {
        setTo(orig.from.address);
        setSubject(`Re: ${orig.subject}`);
        setBody(aiBody ? decodeURIComponent(aiBody) + '\n\n' + buildQuote(orig) : buildQuote(orig));
      } else if (mode === 'replyAll') {
        const toAddrs = [orig.from.address, ...orig.to.map(t=>t.address)].filter(a => a !== account?.email).join(', ');
        setTo(toAddrs);
        if (orig.cc?.length > 0) { setCc(orig.cc.map(c=>c.address).join(', ')); setShowCcBcc(true); }
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
    const text = orig.bodyText || orig.bodyHtml.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    return header + text.split('\n').map((l:string) => `> ${l}`).join('\n');
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

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const handleSend = async () => {
    if (!account) { Alert.alert('エラー','アカウントが選択されていません'); return; }
    if (!to.trim()) { Alert.alert('エラー','宛先を入力してください'); return; }
    const password = await getPassword(account.id);
    if (!password) { Alert.alert('エラー','パスワードが取得できません'); return; }

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

  const modeLabel = mode === 'reply' ? '返信' : mode === 'replyAll' ? '全員返信' : mode === 'forward' ? '転送' : '新規作成';

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn}>
          <Text style={s.cancelText}>キャンセル</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{modeLabel}</Text>
        <TouchableOpacity style={[s.sendBtn, sending && {opacity:0.5}]} onPress={handleSend} disabled={sending}>
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Ionicons name="send" size={16} color="#fff" style={{marginRight:4}} /><Text style={s.sendBtnText}>送信</Text></>
          }
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined} keyboardVerticalOffset={0}>
        <ScrollView style={{flex:1}} keyboardShouldPersistTaps="handled">
          {/* 宛先 */}
          <View style={s.field}>
            <Text style={s.fieldLabel}>宛先</Text>
            <TextInput
              style={s.fieldInput}
              value={to}
              onChangeText={setTo}
              placeholder="メールアドレス"
              placeholderTextColor="#C7C7CC"
              keyboardType="email-address"
              autoCapitalize="none"
              multiline
            />
            {!showCcBcc && (
              <TouchableOpacity onPress={() => setShowCcBcc(true)} style={s.ccBtn}>
                <Text style={s.ccBtnText}>CC/BCC</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={s.sep} />

          {showCcBcc && (
            <>
              <View style={s.field}>
                <Text style={s.fieldLabel}>CC</Text>
                <TextInput
                  style={s.fieldInput}
                  value={cc}
                  onChangeText={setCc}
                  placeholder="CCアドレス"
                  placeholderTextColor="#C7C7CC"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  multiline
                />
              </View>
              <View style={s.sep} />
              <View style={s.field}>
                <Text style={s.fieldLabel}>BCC</Text>
                <TextInput
                  style={s.fieldInput}
                  value={bcc}
                  onChangeText={setBcc}
                  placeholder="BCCアドレス"
                  placeholderTextColor="#C7C7CC"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  multiline
                />
              </View>
              <View style={s.sep} />
            </>
          )}

          {/* 件名 */}
          <View style={s.field}>
            <Text style={s.fieldLabel}>件名</Text>
            <TextInput
              style={s.fieldInput}
              value={subject}
              onChangeText={setSubject}
              placeholder="件名"
              placeholderTextColor="#C7C7CC"
            />
          </View>
          <View style={s.sep} />

          {/* 添付ファイル一覧 */}
          {attachments.length > 0 && (
            <>
              <View style={s.attachList}>
                {attachments.map((att, i) => (
                  <View key={i} style={s.attachItem}>
                    <Ionicons name="attach" size={14} color="#007AFF" />
                    <Text style={s.attachName} numberOfLines={1}>{att.filename}</Text>
                    <Text style={s.attachSize}>{formatSize(att.size)}</Text>
                    <TouchableOpacity onPress={() => removeAttachment(i)} style={s.attachRemove}>
                      <Ionicons name="close-circle" size={16} color="#8E8E93" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <View style={s.sep} />
            </>
          )}

          {/* 本文 */}
          <TextInput
            style={s.bodyInput}
            value={body}
            onChangeText={setBody}
            placeholder="本文を入力..."
            placeholderTextColor="#C7C7CC"
            multiline
            textAlignVertical="top"
          />
        </ScrollView>

        {/* 添付ボタン */}
        <View style={s.toolbar}>
          <TouchableOpacity onPress={handleAttach} style={s.toolbarBtn}>
            <Ionicons name="attach" size={22} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:'#fff' },
  header: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:14, paddingVertical:12, borderBottomWidth:0.5, borderBottomColor:'#E5E5EA' },
  headerBtn: { minWidth:70 },
  cancelText: { fontSize:16, color:'#007AFF' },
  headerTitle: { fontSize:16, fontWeight:'600', color:'#000' },
  sendBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'#007AFF', paddingHorizontal:14, paddingVertical:8, borderRadius:20 },
  sendBtnText: { color:'#fff', fontWeight:'600', fontSize:14 },
  field: { flexDirection:'row', alignItems:'flex-start', paddingHorizontal:16, paddingVertical:12 },
  fieldLabel: { width:40, fontSize:14, color:'#8E8E93', paddingTop:1 },
  fieldInput: { flex:1, fontSize:15, color:'#000', lineHeight:20 },
  ccBtn: { paddingLeft:8, paddingTop:2 },
  ccBtnText: { fontSize:13, color:'#007AFF' },
  sep: { height:0.5, backgroundColor:'#E5E5EA', marginHorizontal:16 },
  attachList: { paddingHorizontal:16, paddingVertical:8, gap:6 },
  attachItem: { flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#F2F2F7', borderRadius:8, paddingHorizontal:10, paddingVertical:6 },
  attachName: { flex:1, fontSize:13, color:'#000' },
  attachSize: { fontSize:12, color:'#8E8E93' },
  attachRemove: { padding:2 },
  bodyInput: { flex:1, minHeight:300, fontSize:15, color:'#000', padding:16, lineHeight:22 },
  toolbar: { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:8, borderTopWidth:0.5, borderTopColor:'#E5E5EA', backgroundColor:'#fff' },
  toolbarBtn: { padding:8 },
});

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
  Modal, Image, useWindowDimensions, Keyboard,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useAccountStore } from '../store/accountStore';
import { useMailStore } from '../store/mailStore';
import { mailApi } from '../lib/api';
import { getEmail, listSignatures } from '../lib/db';
import type { Email } from '@/shared/types';

type Mode = 'new' | 'reply' | 'replyAll' | 'forward';
type Attachment = { filename: string; content: string; contentType: string; size: number };

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
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [recentPhotos, setRecentPhotos] = useState<MediaLibrary.Asset[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const pendingAction = useRef<(() => void) | null>(null);
  const attachOpenedWithKeyboard = useRef(false);
  const toRef = useRef<TextInput>(null);
  const bodyRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  const { height: windowHeight } = useWindowDimensions();
  const [sheetH, setSheetH] = useState(0);
  const [keyboardH, setKeyboardH] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', e => setKeyboardH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);


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
    const t = setTimeout(() => toRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // 添付ファイルが追加されたら末尾へスクロール
  useEffect(() => {
    if (attachments.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [attachments.length]);

  // デフォルト署名を本文にセット
  useEffect(() => {
    (async () => {
      const sigs = await listSignatures(account?.id ?? undefined);
      const def = sigs.find(s => s.isDefault) ?? sigs[0];
      if (!def) return;
      const sigText = '\n\n--\n' + def.content;
      if (mode === 'new') {
        setBody(sigText);
      }
      // reply / replyAll / forward は buildQuote が body を設定するので
      // そちらの useEffect が走った後に追記する
    })();
  }, []);

  useEffect(() => {
    if (!emailId || mode === 'new') return;
    (async () => {
      const orig = await getEmail(emailId);
      if (!orig) return;
      const sigs = await listSignatures(account?.id ?? undefined);
      const def = sigs.find(s => s.isDefault) ?? sigs[0];
      const sigText = def ? '\n\n--\n' + def.content : '';
      if (mode === 'reply') {
        setTo(orig.from.address);
        setSubject(`Re: ${orig.subject}`);
        setBody((aiBody ? decodeURIComponent(aiBody) + '\n\n' + buildQuote(orig) : buildQuote(orig)) + sigText);
      } else if (mode === 'replyAll') {
        const toAddrs = [orig.from.address, ...orig.to.map(t => t.address)].filter(a => a !== account?.email).join(', ');
        setTo(toAddrs);
        if (orig.cc?.length > 0) { setCc(orig.cc.map(c => c.address).join(', ')); setShowCcBcc(true); }
        setSubject(`Re: ${orig.subject}`);
        setBody(buildQuote(orig) + sigText);
      } else if (mode === 'forward') {
        setSubject(`Fwd: ${orig.subject}`);
        setBody(buildQuote(orig, true) + sigText);
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

  const uriToAttachment = async (uri: string, filename: string, mimeType: string): Promise<Attachment> => {
    const res = await fetch(uri);
    const blob = await res.blob();
    return new Promise<Attachment>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve({ filename, content: base64, contentType: mimeType, size: blob.size });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleAttach = async () => {
    attachOpenedWithKeyboard.current = false;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'denied' && status !== 'undetermined') {
      try {
        const { assets } = await MediaLibrary.getAssetsAsync({
          first: 12,
          mediaType: MediaLibrary.MediaType.photo,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });
        const withLocalUri = await Promise.all(
          assets.map(async a => {
            const info = await MediaLibrary.getAssetInfoAsync(a);
            return { ...a, uri: info.localUri ?? a.uri };
          })
        );
        setRecentPhotos(withLocalUri as MediaLibrary.Asset[]);
      } catch { /* ignore */ }
    }
    setShowAttachPicker(true);
  };

  const closePickerThen = (action: () => void) => {
    pendingAction.current = action;
    setSelectedPhotos(new Set());
    setShowAttachPicker(false);
  };

  const handlePickPhoto = () => closePickerThen(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    try {
      const newAtts = await Promise.all(result.assets.map(a =>
        uriToAttachment(a.uri, a.fileName ?? `photo_${Date.now()}.jpg`, a.mimeType ?? 'image/jpeg')
      ));
      setAttachments(prev => [...prev, ...newAtts]);
    } catch { Alert.alert('エラー', '写真・動画の取得に失敗しました'); }
  });

  const handlePickCamera = () => closePickerThen(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('カメラへのアクセスを許可してください'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 });
    if (result.canceled) return;
    try {
      const a = result.assets[0];
      const att = await uriToAttachment(a.uri, a.fileName ?? `photo_${Date.now()}.jpg`, a.mimeType ?? 'image/jpeg');
      setAttachments(prev => [...prev, att]);
    } catch { Alert.alert('エラー', 'カメラの取得に失敗しました'); }
  });

  const handlePickFile = () => closePickerThen(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const newAtts = await Promise.all(result.assets.map(asset =>
        uriToAttachment(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream')
      ));
      setAttachments(prev => [...prev, ...newAtts]);
    } catch { Alert.alert('エラー', 'ファイルの選択に失敗しました'); }
  });

  const toggleRecentPhoto = (id: string) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddSelectedPhotos = () => {
    if (selectedPhotos.size === 0) return;
    const selected = recentPhotos.filter(p => selectedPhotos.has(p.id));
    setSelectedPhotos(new Set());
    closePickerThen(async () => {
      try {
        const newAtts = await Promise.all(selected.map(async asset => {
          const info = await MediaLibrary.getAssetInfoAsync(asset);
          const uri = info.localUri ?? info.uri;
          return uriToAttachment(uri, asset.filename, 'image/jpeg');
        }));
        setAttachments(prev => [...prev, ...newAtts]);
      } catch { Alert.alert('エラー', '写真の取得に失敗しました'); }
    });
  };

  const removeAttachment = (index: number) => setAttachments(prev => prev.filter((_, i) => i !== index));

  const getFileIcon = (contentType: string) => {
    if (contentType.startsWith('image/')) return 'image-outline' as const;
    if (contentType.startsWith('video/')) return 'videocam-outline' as const;
    if (contentType.includes('pdf')) return 'document-text-outline' as const;
    return 'document-outline' as const;
  };

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

  // onLayout で formSheet の実際の高さを取得（flex:1 がゼロ高さになる問題の回避）
  const baseH = sheetH || windowHeight;
  const displayH = keyboardH > 0 ? Math.max(baseH - keyboardH, 100) : baseH;

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      onLayout={e => {
        const h = e.nativeEvent.layout.height;
        if (h > 0) setSheetH(h);
      }}
    >
    <SafeAreaView style={{ height: displayH, backgroundColor: '#fff' }} edges={keyboardH > 0 ? ['top'] : ['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <View style={s.closeCircle}>
            <Ionicons name="close-outline" size={30} color="#000" />
          </View>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{account?.email ?? '新規作成'}</Text>
          {accounts.length > 1 && <Ionicons name="chevron-down" size={12} color="#8E8E93" style={{ marginLeft: 2 }} />}
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: '#fff' }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {renderFields()}
        {attachments.length > 0 && (
          <View style={s.attachRow}>
            {attachments.map((item, index) => (
              <View key={String(index)} style={s.attachCard}>
                <View style={s.attachCardIcon}>
                  <Ionicons name={getFileIcon(item.contentType)} size={22} color="#007AFF" />
                </View>
                <Text style={s.attachCardName} numberOfLines={1}>{item.filename}</Text>
                <Text style={s.attachCardSize}>{formatSize(item.size)}</Text>
                <TouchableOpacity
                  style={s.attachCardRemove}
                  onPress={() => removeAttachment(index)}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#8E8E93" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[s.toolbar, { position: 'absolute', bottom: keyboardH > 0 ? 8 : 18, right: 0, left: 0 }]}>
        <View style={s.glassCluster}>
          <TouchableOpacity onPress={handleAttach} style={s.glassBtn}>
            <Ionicons name="attach-outline" size={24} color="#3C3C43" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || !to.trim()}
            style={[s.glassBtn, sending && { opacity: 0.3 }]}
          >
            {sending
              ? <ActivityIndicator size="small" color="#3C3C43" />
              : <Ionicons name="send-outline" size={24} color="#3C3C43" />
            }
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={showAttachPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAttachPicker(false)}
        onDismiss={() => {
          const action = pendingAction.current;
          pendingAction.current = null;
          if (action) {
            action();
          } else if (attachOpenedWithKeyboard.current) {
            setTimeout(() => bodyRef.current?.focus(), 100);
          }
        }}
      >
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowAttachPicker(false)} />
        <View style={[s.pickerSheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={s.pickerHandle} />

          {recentPhotos.length > 0 && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 }}>
                <Text style={s.pickerSectionTitle}>最近の項目</Text>
                {selectedPhotos.size > 0 && (
                  <TouchableOpacity onPress={handleAddSelectedPhotos} style={{ backgroundColor: '#007AFF', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 5 }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{selectedPhotos.size}枚を追加</Text>
                  </TouchableOpacity>
                )}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.photoList}
              >
                {recentPhotos.map(item => {
                  const isSelected = selectedPhotos.has(item.id);
                  return (
                    <TouchableOpacity key={item.id} onPress={() => toggleRecentPhoto(item.id)} style={s.photoThumbWrap}>
                      <Image source={{ uri: item.uri }} style={[s.photoThumb, isSelected && { opacity: 0.7 }]} />
                      {isSelected && (
                        <View style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="checkmark" size={14} color="#fff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <View style={s.pickerDivider} />
            </>
          )}

          <View style={s.pickerActions}>
            <TouchableOpacity style={s.pickerActionBtn} onPress={handlePickPhoto}>
              <View style={s.pickerActionIcon}>
                <Ionicons name="images-outline" size={26} color="#007AFF" />
              </View>
              <Text style={s.pickerActionLabel}>写真・動画</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.pickerActionBtn} onPress={handlePickCamera}>
              <View style={s.pickerActionIcon}>
                <Ionicons name="camera-outline" size={26} color="#007AFF" />
              </View>
              <Text style={s.pickerActionLabel}>カメラ</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.pickerActionBtn} onPress={handlePickFile}>
              <View style={s.pickerActionIcon}>
                <Ionicons name="folder-outline" size={26} color="#007AFF" />
              </View>
              <Text style={s.pickerActionLabel}>ファイル</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.pickerCancel} onPress={() => setShowAttachPicker(false)}>
            <Text style={s.pickerCancelText}>キャンセル</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
    </View>
  );

  function renderFields() {
    return (
      <>
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
              />
            </View>
            <View style={s.sep} />
          </>
        )}

        <View style={s.row}>
          <Text style={s.label}>件名</Text>
          <TextInput
            style={s.input}
            value={subject}
            onChangeText={setSubject}
            placeholder=""
            placeholderTextColor="#C7C7CC"
          />
        </View>
        <View style={s.sep} />

        <TextInput
          ref={bodyRef}
          style={s.body}
          value={body}
          onChangeText={setBody}
          placeholder="本文を入力してください"
          placeholderTextColor="#C7C7CC"
          multiline
          textAlignVertical="top"
        />
      </>
    );
  }
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#E5E5EA',
  },
  headerClose: { width: 36, alignItems: 'flex-start' },
  closeCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 3 },
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 11, minHeight: 44 },
  label: { width: 36, fontSize: 15, color: '#000', paddingTop: 1 },
  input: { flex: 1, fontSize: 15, color: '#000', lineHeight: 20, paddingTop: 0 },
  ccBccBtn: { paddingLeft: 8, paddingTop: 2, borderWidth: 0.5, borderColor: '#C7C7CC', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  ccBccText: { fontSize: 13, color: '#8E8E93' },
  sep: { height: 0.5, backgroundColor: '#E5E5EA' },
  body: { minHeight: 120, fontSize: 15, color: '#000', padding: 16, lineHeight: 22, textAlignVertical: 'top' },
  attachRow: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: '#fff',
  },
  attachCard: {
    width: 72,
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    padding: 6,
  },
  attachCardIcon: {
    width: 36, height: 36,
    borderRadius: 8,
    backgroundColor: '#E5E5EA',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 3,
  },
  attachCardName: { fontSize: 9, color: '#000', textAlign: 'center', width: '100%' },
  attachCardSize: { fontSize: 9, color: '#8E8E93', marginTop: 1 },
  attachCardRemove: { position: 'absolute', top: 3, right: 3 },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  glassCluster: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 40,
    paddingHorizontal: 4, paddingVertical: 4,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  glassBtn: {
    width: 46, height: 46,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 23,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  pickerSheet: {
    backgroundColor: '#F2F2F7',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 8,
  },
  pickerHandle: {
    width: 36, height: 5, borderRadius: 3,
    backgroundColor: '#C7C7CC',
    alignSelf: 'center', marginBottom: 12,
  },
  pickerSectionTitle: {
    fontSize: 13, color: '#8E8E93', fontWeight: '500',
    paddingHorizontal: 16, marginBottom: 8,
  },
  photoList: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  photoThumbWrap: { borderRadius: 8, overflow: 'hidden', marginHorizontal: 2 },
  photoThumb: { width: 80, height: 80 },
  pickerDivider: {
    height: 0.5, backgroundColor: '#C7C7CC',
    marginHorizontal: 16, marginBottom: 8,
  },
  pickerActions: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 16, paddingVertical: 16,
    backgroundColor: '#fff',
  },
  pickerActionBtn: { alignItems: 'center', gap: 6, flex: 1 },
  pickerActionIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#F2F2F7',
    alignItems: 'center', justifyContent: 'center',
  },
  pickerActionLabel: { fontSize: 12, color: '#3C3C43', fontWeight: '500' },
  pickerCancel: { backgroundColor: '#fff', marginTop: 8, paddingVertical: 16, alignItems: 'center' },
  pickerCancelText: { fontSize: 17, color: '#007AFF', fontWeight: '600' },
});

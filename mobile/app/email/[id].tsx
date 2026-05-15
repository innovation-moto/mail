import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Alert, Modal, Animated, Dimensions, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import WebView from 'react-native-webview';
import { useMailStore } from '../../store/mailStore';
import { useAccountStore } from '../../store/accountStore';
import { getEmail } from '../../lib/db';
import { mailApi } from '../../lib/api';
import type { AiSummarizeResult, AiTone, CalendarEvent, Email } from '@/shared/types';

function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

type AiSheet = 'menu' | 'summary' | 'reply' | 'event' | null;

export default function EmailDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { markRead, starEmail, deleteEmail, selectedFolder } = useMailStore();
  const { openAiKey } = useAccountStore();

  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHtml, setShowHtml] = useState(true);
  const [headerExpanded, setHeaderExpanded] = useState(false);

  // AI state
  const [aiSheet, setAiSheet] = useState<AiSheet>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [summary, setSummary] = useState<AiSummarizeResult | null>(null);
  const [replyTone, setReplyTone] = useState<AiTone>('polite');
  const [calEvent, setCalEvent] = useState<CalendarEvent | null | undefined>(undefined);

  const sheetAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!id) return;
    (async () => {
      const found = await getEmail(id);
      setEmail(found);
      setLoading(false);
      if (found && !found.isRead) {
        markRead(found.id, found.uid, found.folder || selectedFolder);
      }
    })();
  }, [id]);

  const openSheet = (sheet: AiSheet) => {
    setAiSheet(sheet);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 10 }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setAiSheet(null);
    });
  };

  const screenH = Dimensions.get('window').height;
  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenH, 0],
  });

  const handleStar = async () => {
    if (!email) return;
    await starEmail(email.id, email.uid, email.folder || selectedFolder, !email.isStarred);
    setEmail(prev => prev ? { ...prev, isStarred: !prev.isStarred } : prev);
  };

  const handleDelete = () => {
    if (!email) return;
    Alert.alert('削除', 'このメールをゴミ箱に移動しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          await deleteEmail(email.id, email.uid, email.folder || selectedFolder);
          router.back();
        },
      },
    ]);
  };

  const handleAiButton = () => {
    if (!openAiKey) {
      Alert.alert(
        'AIキー未設定',
        'AI機能を使うにはOpenAI APIキーが必要です。設定画面から登録してください。',
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: '設定を開く', onPress: () => router.push('/settings') },
        ],
      );
      return;
    }
    openSheet('menu');
  };

  const handleSummarize = async () => {
    if (!email || !openAiKey) return;
    openSheet('summary');
    if (summary) return; // キャッシュ済み
    setAiLoading(true);
    try {
      const result = await mailApi.aiSummarize(openAiKey, email.subject, email.bodyText || email.bodyHtml.replace(/<[^>]+>/g, ' '));
      setSummary(result);
    } catch (err) {
      Alert.alert('エラー', (err as Error).message);
      closeSheet();
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerateReply = async (tone: AiTone) => {
    if (!email || !openAiKey) return;
    setReplyTone(tone);
    setAiLoading(true);
    try {
      const { reply } = await mailApi.aiReply(openAiKey, email.subject, email.bodyText || email.bodyHtml.replace(/<[^>]+>/g, ' '), tone);
      closeSheet();
      router.push(`/compose?mode=reply&emailId=${email.id}&aiBody=${encodeURIComponent(reply)}`);
    } catch (err) {
      Alert.alert('エラー', (err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleDetectEvent = async () => {
    if (!email || !openAiKey) return;
    openSheet('event');
    if (calEvent !== undefined) return; // キャッシュ済み
    setAiLoading(true);
    try {
      const { event } = await mailApi.aiDetectEvent(
        openAiKey,
        email.subject,
        email.bodyText || email.bodyHtml.replace(/<[^>]+>/g, ' '),
        email.date,
        email.from.name || email.from.address,
        email.from.address,
      );
      setCalEvent(event);
    } catch (err) {
      Alert.alert('エラー', (err as Error).message);
      closeSheet();
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <ActivityIndicator style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!email) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color="#007AFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#8E8E93' }}>メールが見つかりません</Text>
        </View>
      </SafeAreaView>
    );
  }

  const senderName = email.from.name || email.from.address;
  const toList = email.to.map(t => t.name || t.address).join(', ');
  const htmlContent = `
    <html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
    <style>
      body { font-family: -apple-system,BlinkMacSystemFont,sans-serif; font-size:16px; color:#1c1c1e; line-height:1.6; margin:0; padding:16px; word-wrap:break-word; overflow-wrap:break-word; }
      a { color:#007AFF; }
      img { max-width:100%; height:auto; }
      table { max-width:100%; }
      pre,code { white-space:pre-wrap; word-wrap:break-word; }
    </style></head>
    <body>${email.bodyHtml || email.bodyText.replace(/\n/g, '<br>')}</body></html>
  `;

  return (
    <SafeAreaView style={s.container} edges={['top']}>

      {/* ─── ヘッダー（リキッドグラス バー全体） ─── */}
      <BlurView intensity={72} tint="light" style={s.header}>
        <View style={s.headerInner}>
          {/* 戻るボタン */}
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color="#007AFF" />
          </TouchableOpacity>

          {/* 右側 pill ボタン群 */}
          <View style={s.headerPill}>
            <TouchableOpacity style={s.glassBtn} onPress={handleStar}>
              <Ionicons
                name={email.isStarred ? 'bookmark' : 'bookmark-outline'}
                size={20}
                color={email.isStarred ? '#FF9500' : '#3C3C43'}
              />
            </TouchableOpacity>
            <View style={s.glassDivider} />
            <TouchableOpacity style={s.glassBtn} onPress={handleAiButton}>
              <Ionicons name="flash" size={20} color={openAiKey ? '#007AFF' : '#C7C7CC'} />
            </TouchableOpacity>
            <View style={s.glassDivider} />
            <TouchableOpacity style={s.glassBtn}>
              <Ionicons name="person-add-outline" size={20} color="#3C3C43" />
            </TouchableOpacity>
          </View>
        </View>
      </BlurView>

      {/* ─── 件名 ─── */}
      <View style={s.subjectArea}>
        <Text style={s.subject}>{email.subject || '（件名なし）'}</Text>
      </View>

      {/* ─── 送信者カード ─── */}
      <TouchableOpacity style={s.senderCard} onPress={() => setHeaderExpanded(v => !v)} activeOpacity={0.7}>
        <View style={s.senderAvatar}>
          <Text style={s.senderAvatarText}>{senderName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={s.senderInfo}>
          <Text style={s.senderName}>{senderName}</Text>
          {headerExpanded ? (
            <View>
              <Text style={s.senderSub}>{email.from.address}</Text>
              {toList ? <Text style={s.senderSub}>宛先: {toList}</Text> : null}
              {email.cc?.length > 0 && (
                <Text style={s.senderSub}>CC: {email.cc.map(c => c.name || c.address).join(', ')}</Text>
              )}
            </View>
          ) : (
            <Text style={s.senderSub} numberOfLines={1}>宛先: {toList || 'あなた'}</Text>
          )}
        </View>
        <View style={s.senderRight}>
          <Text style={s.senderDate}>{formatFullDate(email.date)}</Text>
          <Ionicons name={headerExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#8E8E93" />
        </View>
      </TouchableOpacity>

      {/* ─── テキスト/HTML切替 ─── */}
      {email.bodyHtml && email.bodyText && (
        <View style={s.toggle}>
          <TouchableOpacity style={[s.toggleBtn, !showHtml && s.toggleActive]} onPress={() => setShowHtml(false)}>
            <Text style={[s.toggleText, !showHtml && s.toggleActiveText]}>テキスト</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.toggleBtn, showHtml && s.toggleActive]} onPress={() => setShowHtml(true)}>
            <Text style={[s.toggleText, showHtml && s.toggleActiveText]}>HTML</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── 本文 ─── */}
      <View style={{ flex: 1 }}>
        {showHtml && email.bodyHtml ? (
          <WebView
            source={{ html: htmlContent }}
            style={{ flex: 1 }}
            scrollEnabled
            showsVerticalScrollIndicator={false}
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(req) => {
              if (req.url.startsWith('about:') || req.url.startsWith('data:')) return true;
              return false;
            }}
          />
        ) : (
          <ScrollView style={s.textScroll} contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
            <Text style={s.bodyText}>{email.bodyText || '本文がありません'}</Text>
          </ScrollView>
        )}
      </View>

      {/* ─── フローティング リキッドグラス ツールバー ─── */}
      <View style={[s.toolbarWrap, { bottom: insets.bottom + 12 }]}>
        <BlurView intensity={70} tint="light" style={s.toolbarBlur}>
          <View style={s.toolbarInner}>
            <TouchableOpacity style={s.toolbarBtn} onPress={handleDelete}>
              <Ionicons name="archive-outline" size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            <TouchableOpacity style={s.toolbarBtn} onPress={() => router.push(`/compose?mode=reply&emailId=${email.id}`)}>
              <Ionicons name="arrow-undo-outline" size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            <TouchableOpacity style={s.toolbarBtn} onPress={() => {
              markRead(email.id, email.uid, email.folder || selectedFolder);
              setEmail(prev => prev ? { ...prev, isRead: true } : prev);
            }}>
              <Ionicons name="checkmark-outline" size={24} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            <TouchableOpacity style={s.toolbarBtn} onPress={() => router.push(`/compose?mode=forward&emailId=${email.id}`)}>
              <Ionicons name="arrow-redo-outline" size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            <TouchableOpacity style={s.toolbarBtn}>
              <Ionicons name="time-outline" size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            <TouchableOpacity style={s.toolbarBtn} onPress={() => {
              Alert.alert('その他', undefined, [
                { text: '全員に返信', onPress: () => router.push(`/compose?mode=replyAll&emailId=${email.id}`) },
                { text: '削除', style: 'destructive', onPress: handleDelete },
                { text: 'キャンセル', style: 'cancel' },
              ]);
            }}>
              <Ionicons name="ellipsis-horizontal" size={22} color="#3C3C43" />
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>

      {/* ─── AI シート (Modal) ─── */}
      <Modal visible={aiSheet !== null} transparent animationType="none" onRequestClose={closeSheet}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={closeSheet} />
        <Animated.View style={[s.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={s.sheetHandle} />

          {/* AI メニュー */}
          {aiSheet === 'menu' && (
            <>
              <Text style={s.sheetTitle}>AI機能</Text>
              <TouchableOpacity style={s.sheetItem} onPress={handleSummarize}>
                <View style={[s.sheetIcon, { backgroundColor: '#E3F2FD' }]}>
                  <Ionicons name="document-text-outline" size={20} color="#007AFF" />
                </View>
                <View style={s.sheetItemText}>
                  <Text style={s.sheetItemTitle}>このメールを要約</Text>
                  <Text style={s.sheetItemDesc}>内容と要対応事項をまとめます</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
              </TouchableOpacity>
              <View style={s.sheetSep} />
              <TouchableOpacity style={s.sheetItem} onPress={() => openSheet('reply')}>
                <View style={[s.sheetIcon, { backgroundColor: '#E8F5E9' }]}>
                  <Ionicons name="create-outline" size={20} color="#34C759" />
                </View>
                <View style={s.sheetItemText}>
                  <Text style={s.sheetItemTitle}>AI返信を生成</Text>
                  <Text style={s.sheetItemDesc}>トーンを選んで返信文を自動作成</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
              </TouchableOpacity>
              <View style={s.sheetSep} />
              <TouchableOpacity style={s.sheetItem} onPress={handleDetectEvent}>
                <View style={[s.sheetIcon, { backgroundColor: '#FFF3E0' }]}>
                  <Ionicons name="calendar-outline" size={20} color="#FF9500" />
                </View>
                <View style={s.sheetItemText}>
                  <Text style={s.sheetItemTitle}>予定を検出</Text>
                  <Text style={s.sheetItemDesc}>メール内の日程・イベントを抽出</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
              </TouchableOpacity>
            </>
          )}

          {/* 要約シート */}
          {aiSheet === 'summary' && (
            <>
              <View style={s.sheetTitleRow}>
                <TouchableOpacity onPress={() => openSheet('menu')} style={{ marginRight: 8 }}>
                  <Ionicons name="chevron-back" size={22} color="#007AFF" />
                </TouchableOpacity>
                <Text style={s.sheetTitle}>AI要約</Text>
              </View>
              {aiLoading ? (
                <View style={s.aiLoadingArea}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={s.aiLoadingText}>要約中...</Text>
                </View>
              ) : summary ? (
                <ScrollView style={s.sheetScroll} showsVerticalScrollIndicator={false}>
                  <Text style={s.summaryText}>{summary.summary}</Text>
                  {summary.actions.length > 0 && (
                    <>
                      <Text style={s.actionsTitle}>要対応事項</Text>
                      {summary.actions.map((a, i) => (
                        <View key={i} style={s.actionItem}>
                          <View style={s.actionBullet} />
                          <Text style={s.actionText}>{a}</Text>
                        </View>
                      ))}
                    </>
                  )}
                </ScrollView>
              ) : null}
            </>
          )}

          {/* AI返信 トーン選択 */}
          {aiSheet === 'reply' && (
            <>
              <View style={s.sheetTitleRow}>
                <TouchableOpacity onPress={() => openSheet('menu')} style={{ marginRight: 8 }}>
                  <Ionicons name="chevron-back" size={22} color="#007AFF" />
                </TouchableOpacity>
                <Text style={s.sheetTitle}>AI返信 — トーンを選択</Text>
              </View>
              {aiLoading ? (
                <View style={s.aiLoadingArea}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={s.aiLoadingText}>返信文を生成中...</Text>
                </View>
              ) : (
                <>
                  {([
                    { tone: 'polite' as AiTone, label: '丁寧', desc: 'ビジネス向け・礼儀正しい文体', icon: 'briefcase-outline', color: '#007AFF', bg: '#E3F2FD' },
                    { tone: 'casual' as AiTone, label: 'カジュアル', desc: '親しみやすい・フレンドリーな文体', icon: 'chatbubble-outline', color: '#34C759', bg: '#E8F5E9' },
                    { tone: 'brief' as AiTone, label: '簡潔', desc: '要点のみ・短い返信文', icon: 'flash-outline', color: '#FF9500', bg: '#FFF3E0' },
                  ] as const).map(({ tone, label, desc, icon, color, bg }) => (
                    <TouchableOpacity key={tone} style={s.sheetItem} onPress={() => handleGenerateReply(tone)}>
                      <View style={[s.sheetIcon, { backgroundColor: bg }]}>
                        <Ionicons name={icon} size={20} color={color} />
                      </View>
                      <View style={s.sheetItemText}>
                        <Text style={s.sheetItemTitle}>{label}</Text>
                        <Text style={s.sheetItemDesc}>{desc}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </>
          )}

          {/* カレンダー検出シート */}
          {aiSheet === 'event' && (
            <>
              <View style={s.sheetTitleRow}>
                <TouchableOpacity onPress={() => openSheet('menu')} style={{ marginRight: 8 }}>
                  <Ionicons name="chevron-back" size={22} color="#007AFF" />
                </TouchableOpacity>
                <Text style={s.sheetTitle}>予定の検出</Text>
              </View>
              {aiLoading ? (
                <View style={s.aiLoadingArea}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={s.aiLoadingText}>予定を検出中...</Text>
                </View>
              ) : calEvent ? (
                <ScrollView style={s.sheetScroll}>
                  <View style={s.eventCard}>
                    <Text style={s.eventTitle}>{calEvent.title}</Text>
                    <View style={s.eventRow}>
                      <Ionicons name="calendar-outline" size={16} color="#8E8E93" style={{ marginRight: 6 }} />
                      <Text style={s.eventMeta}>
                        {new Date(calEvent.startDate).toLocaleString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                        {' 〜 '}
                        {new Date(calEvent.endDate).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    {calEvent.location ? (
                      <View style={s.eventRow}>
                        <Ionicons name={calEvent.isOnline ? 'videocam-outline' : 'location-outline'} size={16} color="#8E8E93" style={{ marginRight: 6 }} />
                        <Text style={s.eventMeta}>{calEvent.location}</Text>
                      </View>
                    ) : null}
                    {calEvent.description ? (
                      <Text style={s.eventDesc}>{calEvent.description}</Text>
                    ) : null}
                  </View>
                </ScrollView>
              ) : calEvent === null ? (
                <View style={s.aiLoadingArea}>
                  <Ionicons name="calendar-outline" size={40} color="#C7C7CC" />
                  <Text style={s.noEventText}>このメールに予定は見つかりませんでした</Text>
                </View>
              ) : null}
            </>
          )}
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  // ─── ヘッダー リキッドグラスバー ───
  header: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.45)',
    // 下側シャドウで浮遊感
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 4,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  backBtn: { padding: 4 },
  // 右側 pill
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 22,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.65)',
    overflow: 'hidden',
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  glassBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
  },
  glassDivider: {
    width: 0.5, height: 16,
    backgroundColor: 'rgba(60,60,67,0.2)',
  },
  subjectArea: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0' },
  subject: { fontSize: 20, fontWeight: '700', color: '#000', lineHeight: 26 },
  senderCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  senderAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center',
    marginRight: 10, flexShrink: 0,
  },
  senderAvatarText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  senderInfo: { flex: 1 },
  senderName: { fontSize: 15, fontWeight: '600', color: '#000', marginBottom: 2 },
  senderSub: { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  senderRight: { alignItems: 'flex-end', marginLeft: 8 },
  senderDate: { fontSize: 12, color: '#8E8E93', marginBottom: 3 },
  toggle: {
    flexDirection: 'row', margin: 10,
    backgroundColor: '#F2F2F7', borderRadius: 8, padding: 2,
  },
  toggleBtn: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 6 },
  toggleActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  toggleText: { fontSize: 13, color: '#8E8E93', fontWeight: '500' },
  toggleActiveText: { color: '#000', fontWeight: '600' },
  textScroll: { flex: 1 },
  bodyText: { fontSize: 15, color: '#1c1c1e', lineHeight: 22 },

  // ─── フローティング リキッドグラス ツールバー ───
  toolbarWrap: {
    position: 'absolute', left: 20, right: 20,
    borderRadius: 26,
    // 外側シャドウ
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  toolbarBlur: {
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  toolbarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  toolbarBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 13,
  },
  toolbarDivider: {
    width: 0.5, height: 20,
    backgroundColor: 'rgba(60,60,67,0.15)',
  },

  // ─── AI シート ───
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingHorizontal: 16, paddingBottom: 40, paddingTop: 12,
    minHeight: 260,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#D1D1D6', alignSelf: 'center', marginBottom: 14,
  },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginBottom: 16 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  sheetIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  sheetItemText: { flex: 1 },
  sheetItemTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  sheetItemDesc: { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  sheetSep: { height: 0.5, backgroundColor: '#F0F0F0', marginLeft: 52 },
  sheetScroll: { maxHeight: 340 },

  // ─── AI コンテンツ ───
  aiLoadingArea: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  aiLoadingText: { fontSize: 14, color: '#8E8E93' },
  summaryText: { fontSize: 15, color: '#1C1C1E', lineHeight: 22, marginBottom: 16 },
  actionsTitle: { fontSize: 13, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  actionItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  actionBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#007AFF', marginTop: 7, marginRight: 8 },
  actionText: { flex: 1, fontSize: 14, color: '#1C1C1E', lineHeight: 20 },
  eventCard: { backgroundColor: '#F9F9F9', borderRadius: 12, padding: 16, gap: 10 },
  eventTitle: { fontSize: 16, fontWeight: '700', color: '#000', lineHeight: 22 },
  eventRow: { flexDirection: 'row', alignItems: 'center' },
  eventMeta: { fontSize: 14, color: '#3C3C43', flex: 1 },
  eventDesc: { fontSize: 13, color: '#8E8E93', lineHeight: 18, marginTop: 4 },
  noEventText: { fontSize: 15, color: '#8E8E93', textAlign: 'center', marginTop: 8 },
});

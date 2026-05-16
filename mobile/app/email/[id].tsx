import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput,
  ActivityIndicator, Alert, Modal, Animated, Dimensions, Platform, Linking,
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
import SenderAvatar from '../../components/SenderAvatar';
import { createFilterRule } from '../../lib/db';
import type { AiSummarizeResult, AiTone, CalendarEvent, Email, FilterCondition, Folder } from '@/shared/types';

function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const AVATAR_COLORS = [
  '#ef4444','#f97316','#f59e0b','#eab308',
  '#84cc16','#22c55e','#10b981','#14b8a6',
  '#06b6d4','#0ea5e9','#3b82f6','#6366f1',
  '#8b5cf6','#a855f7','#d946ef','#ec4899',
];
function getAvatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function getInitials(name: string, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name[0].toUpperCase();
  }
  return email[0]?.toUpperCase() ?? '?';
}

// 全員に返信アイコン（返信矢印＋右上に「+」バッジ）
function ReplyAllIcon({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size }}>
      <Ionicons name="arrow-undo-outline" size={size} color={color} />
      <View style={{
        position: 'absolute', right: -1, top: -1,
        backgroundColor: color, borderRadius: 5,
        width: 10, height: 10,
        justifyContent: 'center', alignItems: 'center',
      }}>
        <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800', lineHeight: 10 }}>+</Text>
      </View>
    </View>
  );
}

type AiSheet = 'menu' | 'summary' | 'reply' | 'event' | null;

export default function EmailDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { markRead, starEmail, deleteEmail, selectedFolder, folders } = useMailStore();
  const { openAiKey, selectedAccountId } = useAccountStore();

  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHtml, setShowHtml] = useState(true);
  const [headerExpanded, setHeaderExpanded] = useState(false);

  // Filter state
  const [filterVisible, setFilterVisible] = useState(false);

  // AI state
  const [aiSheet, setAiSheet] = useState<AiSheet>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [summary, setSummary] = useState<AiSummarizeResult | null>(null);
  const [replyTone, setReplyTone] = useState<AiTone>('polite');
  const [calEvent, setCalEvent] = useState<CalendarEvent | null | undefined>(undefined);
  const [calendarAdded, setCalendarAdded] = useState(false);

  const sheetAnim = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;

  // スクロール量からヘッダー表示を制御
  const SCROLL_THRESHOLD = 80;
  const compactHeaderOpacity = scrollY.interpolate({
    inputRange: [SCROLL_THRESHOLD, SCROLL_THRESHOLD + 30],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const floatOpacity = scrollY.interpolate({
    inputRange: [0, SCROLL_THRESHOLD],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

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

  // ヘッダー用: 要約のみ直接起動
  const handleSummarizeButton = () => {
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
    handleSummarize();
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

  // Google Calendar URL を開く（Mac アプリと同仕様）
  const openGoogleCalendar = (event: CalendarEvent) => {
    const toGoogleDate = (iso: string) =>
      iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15) + 'Z';
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${toGoogleDate(event.startDate)}/${toGoogleDate(event.endDate)}`,
      details: event.description ?? '',
      ...(event.location ? { location: event.location } : {}),
    });
    Linking.openURL(`https://calendar.google.com/calendar/render?${params.toString()}`);
    setCalendarAdded(true);
  };

  // ツールバー用: AI 返信（トーン選択シートを直接開く）
  const handleAiReplyButton = () => {
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
    openSheet('reply');
  };

  // ツールバー用: カレンダー検出を直接実行
  const handleCalendarButton = () => {
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
    setCalendarAdded(false);
    handleDetectEvent();
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
  const avatarColor = getAvatarColor(email.from.address);
  const avatarInitials = getInitials(email.from.name || '', email.from.address);

  // HTML メール用：件名・送信者情報も HTML 内に埋め込んで一体スクロール
  const fullHtmlContent = `
    <html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 16px; color: #1c1c1e; background: #fff; word-wrap: break-word; overflow-wrap: break-word; }
      .header-pad { height: 62px; }
      .subject-area { padding: 14px 16px; border-bottom: 0.5px solid #F0F0F0; }
      .subject { font-size: 20px; font-weight: 700; color: #000; line-height: 1.3; }
      .sender-card { display: flex; align-items: flex-start; padding: 12px 16px; border-bottom: 0.5px solid #F0F0F0; gap: 10px; }
      .avatar { width: 40px; height: 40px; border-radius: 20px; background: ${avatarColor}; display: flex; align-items: center; justify-content: center; color: white; font-size: 16px; font-weight: 700; flex-shrink: 0; }
      .sender-info { flex: 1; min-width: 0; }
      .sender-name { font-size: 15px; font-weight: 600; color: #000; margin-bottom: 2px; }
      .sender-sub { font-size: 13px; color: #8E8E93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sender-right { text-align: right; flex-shrink: 0; }
      .sender-date { font-size: 12px; color: #8E8E93; white-space: nowrap; }
      .body-content { padding: 16px; line-height: 1.6; }
      .body-content a { color: #007AFF; }
      .body-content img { max-width: 100%; height: auto; }
      .body-content table { max-width: 100%; }
      .body-content pre, .body-content code { white-space: pre-wrap; word-wrap: break-word; }
      .bottom-pad { height: 140px; }
    </style></head>
    <body>
      <div class="header-pad"></div>
      <div class="subject-area">
        <div class="subject">${escapeHtml(email.subject || '（件名なし）')}</div>
      </div>
      <div class="sender-card">
        <div class="avatar">${escapeHtml(avatarInitials)}</div>
        <div class="sender-info">
          <div class="sender-name">${escapeHtml(senderName)}</div>
          <div class="sender-sub">宛先: ${escapeHtml(toList || 'あなた')}</div>
        </div>
        <div class="sender-right">
          <div class="sender-date">${escapeHtml(formatFullDate(email.date))}</div>
        </div>
      </div>
      <div class="body-content">
        ${email.bodyHtml || email.bodyText.replace(/\n/g, '<br>')}
      </div>
      <div class="bottom-pad"></div>
    </body></html>
  `;

  const FLOAT_TOP = 10;

  // WebViewスクロール検知用JS
  const scrollListenerJS = `
    (function() {
      var lastY = 0;
      window.addEventListener('scroll', function() {
        var y = window.scrollY;
        if (Math.abs(y - lastY) > 2) {
          lastY = y;
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'scroll', y: y}));
        }
      }, {passive: true});
    })();
    true;
  `;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={{ flex: 1 }}>

        {/* ─── コンテンツ（テキスト or WebView） ─── */}
        {showHtml && email.bodyHtml ? (
          /* HTML メール: 件名・送信者・本文すべてを WebView 内でスクロール */
          <WebView
            source={{ html: fullHtmlContent }}
            style={{ flex: 1 }}
            scrollEnabled
            showsVerticalScrollIndicator={false}
            originWhitelist={['*']}
            injectedJavaScript={scrollListenerJS}
            onMessage={(e) => {
              try {
                const data = JSON.parse(e.nativeEvent.data);
                if (data.type === 'scroll') scrollY.setValue(data.y);
              } catch {}
            }}
            onShouldStartLoadWithRequest={(req) => {
              if (req.url.startsWith('about:') || req.url.startsWith('data:')) return true;
              return false;
            }}
          />
        ) : (
          <Animated.ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingTop: FLOAT_TOP + 52, paddingBottom: 140 }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { y: scrollY } } }],
              { useNativeDriver: false },
            )}
          >
            <View style={s.subjectArea}>
              <Text style={s.subject}>{email.subject || '（件名なし）'}</Text>
            </View>
            <TouchableOpacity style={s.senderCard} onPress={() => setHeaderExpanded(v => !v)} activeOpacity={0.7}>
              <View style={s.senderAvatarWrap}>
                <SenderAvatar fromEmail={email.from.address} fromName={email.from.name || ''} size={40} />
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
            <Text style={s.bodyText}>{email.bodyText || '本文がありません'}</Text>
          </Animated.ScrollView>
        )}

        {/* ─── フローティング ヘッダーボタン（スクロールで消える） ─── */}
        <Animated.View style={[s.floatHeader, { top: FLOAT_TOP, opacity: floatOpacity }]} pointerEvents="box-none">
          <BlurView intensity={72} tint="light" style={s.floatBack}>
            <TouchableOpacity style={s.floatBackBtn} onPress={() => router.back()} pointerEvents="auto">
              <Ionicons name="chevron-back" size={22} color="#007AFF" />
            </TouchableOpacity>
          </BlurView>
          <BlurView intensity={72} tint="light" style={s.floatPill}>
            <View style={s.floatPillInner}>
              <TouchableOpacity style={s.floatBtn} onPress={handleStar} pointerEvents="auto">
                <Ionicons name={email.isStarred ? 'star' : 'star-outline'} size={19} color={email.isStarred ? '#FF9500' : '#3C3C43'} />
              </TouchableOpacity>
              <View style={s.floatDivider} />
              <TouchableOpacity style={s.floatBtn} onPress={handleSummarizeButton} pointerEvents="auto">
                <Ionicons name="sparkles" size={19} color={openAiKey ? '#007AFF' : '#C7C7CC'} />
              </TouchableOpacity>
              <View style={s.floatDivider} />
              <TouchableOpacity style={s.floatBtn} onPress={() => setFilterVisible(true)} pointerEvents="auto">
                <Ionicons name="funnel-outline" size={19} color="#3C3C43" />
              </TouchableOpacity>
            </View>
          </BlurView>
        </Animated.View>

        {/* ─── コンパクトヘッダーバー（スクロールで現れる） ─── */}
        <Animated.View style={[s.compactHeader, { opacity: compactHeaderOpacity }]} pointerEvents="box-none">
          <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
          <View style={s.compactHeaderInner}>
            <TouchableOpacity style={s.compactBack} onPress={() => router.back()} pointerEvents="auto">
              <Ionicons name="chevron-back" size={22} color="#007AFF" />
            </TouchableOpacity>
            <Text style={s.compactTitle} numberOfLines={1}>{email.subject || '（件名なし）'}</Text>
            <View style={s.compactActions}>
              <TouchableOpacity style={s.compactBtn} onPress={handleStar} pointerEvents="auto">
                <Ionicons name={email.isStarred ? 'star' : 'star-outline'} size={18} color={email.isStarred ? '#FF9500' : '#3C3C43'} />
              </TouchableOpacity>
              <TouchableOpacity style={s.compactBtn} onPress={handleSummarizeButton} pointerEvents="auto">
                <Ionicons name="sparkles" size={18} color={openAiKey ? '#007AFF' : '#C7C7CC'} />
              </TouchableOpacity>
              <TouchableOpacity style={s.compactBtn} onPress={() => setFilterVisible(true)} pointerEvents="auto">
                <Ionicons name="funnel-outline" size={18} color="#3C3C43" />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>

        {/* ─── フローティング リキッドグラス ツールバー ─── */}
      <View style={[s.toolbarWrap, { bottom: insets.bottom + 12 }]}>
        <BlurView intensity={70} tint="light" style={s.toolbarBlur}>
          <View style={s.toolbarInner}>
            {/* 返信 */}
            <TouchableOpacity style={s.toolbarBtn} onPress={() => router.push(`/compose?mode=reply&emailId=${email.id}`)}>
              <Ionicons name="arrow-undo-outline" size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            {/* 全員に返信 */}
            <TouchableOpacity style={s.toolbarBtn} onPress={() => router.push(`/compose?mode=replyAll&emailId=${email.id}`)}>
              <ReplyAllIcon size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            {/* 転送 */}
            <TouchableOpacity style={s.toolbarBtn} onPress={() => router.push(`/compose?mode=forward&emailId=${email.id}`)}>
              <Ionicons name="arrow-redo-outline" size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            {/* AI 返信を生成 */}
            <TouchableOpacity style={s.toolbarBtn} onPress={handleAiReplyButton}>
              <Ionicons name="sparkles" size={22} color={openAiKey ? '#007AFF' : '#C7C7CC'} />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            {/* カレンダー */}
            <TouchableOpacity style={s.toolbarBtn} onPress={handleCalendarButton}>
              <Ionicons name="calendar-outline" size={22} color={openAiKey ? '#3C3C43' : '#C7C7CC'} />
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>

      </View>{/* /flex:1 wrapper */}

      {/* ─── フィルター作成シート ─── */}
      {filterVisible && (
        <QuickFilterSheet
          email={email}
          folders={folders}
          accountId={selectedAccountId ?? ''}
          onClose={() => setFilterVisible(false)}
        />
      )}

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
                <>
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
                  {/* カレンダーに追加ボタン */}
                  <TouchableOpacity
                    style={[s.calendarAddBtn, calendarAdded && s.calendarAddBtnDone]}
                    onPress={() => openGoogleCalendar(calEvent)}
                    disabled={calendarAdded}
                  >
                    <Ionicons
                      name={calendarAdded ? 'checkmark-circle' : 'calendar'}
                      size={18}
                      color="#fff"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={s.calendarAddText}>
                      {calendarAdded ? 'カレンダーに追加しました' : 'Googleカレンダーに追加'}
                    </Text>
                  </TouchableOpacity>
                </>
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

// ─── QuickFilterSheet ────────────────────────────────────────────────────────
const FIELD_LABELS: Record<FilterCondition['field'], string> = {
  from: '差出人', to: '宛先', subject: '件名', body: '本文',
};
const OP_LABELS: Record<FilterCondition['operator'], string> = {
  contains: 'を含む', equals: '完全一致', startsWith: 'で始まる', endsWith: 'で終わる',
};

function QuickFilterSheet({
  email, folders, accountId, onClose,
}: {
  email: Email;
  folders: Folder[];
  accountId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(`${email.from.address} からのメール`);
  const [conditions, setConditions] = useState<FilterCondition[]>([
    { field: 'from', operator: 'contains', value: email.from.address },
  ]);
  const [conditionType, setConditionType] = useState<'all' | 'any'>('any');
  const [actionFolder, setActionFolder] = useState('');
  const [actionMarkRead, setActionMarkRead] = useState(false);
  const [actionStarred, setActionStarred] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [folderPickerVisible, setFolderPickerVisible] = useState(false);

  function updateCondition(i: number, patch: Partial<FilterCondition>) {
    setConditions(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  async function handleSave() {
    if (!accountId || conditions.some(c => !c.value.trim())) return;
    setSaving(true);
    try {
      await createFilterRule(accountId, {
        name,
        conditions,
        conditionType,
        actionFolder: actionFolder || null,
        actionMarkRead,
        actionStarred,
        active: true,
      });
      setSaved(true);
      setTimeout(() => onClose(), 900);
    } catch (err) {
      Alert.alert('エラー', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={f.overlay} activeOpacity={1} onPress={onClose} />
      <View style={f.sheet}>
        {/* ハンドル */}
        <View style={f.handle} />

        {/* ヘッダー */}
        <View style={f.header}>
          <View style={f.headerLeft}>
            <Ionicons name="funnel" size={16} color="#007AFF" style={{ marginRight: 6 }} />
            <Text style={f.headerTitle}>フィルターを作成</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={f.closeBtn}>
            <Ionicons name="close" size={18} color="#8E8E93" />
          </TouchableOpacity>
        </View>

        <ScrollView style={f.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* ルール名 */}
          <Text style={f.label}>ルール名</Text>
          <TextInput
            style={f.input}
            value={name}
            onChangeText={setName}
            placeholder="ルール名（省略可）"
            placeholderTextColor="#C7C7CC"
          />

          {/* 条件 */}
          <View style={f.condHeader}>
            <Text style={f.label}>条件</Text>
            <View style={f.segWrap}>
              {(['any', 'all'] as const).map(v => (
                <TouchableOpacity
                  key={v}
                  style={[f.seg, conditionType === v && f.segActive]}
                  onPress={() => setConditionType(v)}
                >
                  <Text style={[f.segText, conditionType === v && f.segActiveText]}>
                    {v === 'any' ? 'いずれか (OR)' : 'すべて (AND)'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {conditions.map((c, i) => (
            <View key={i} style={f.condRow}>
              {/* フィールド */}
              <View style={f.pickerWrap}>
                {(Object.keys(FIELD_LABELS) as FilterCondition['field'][]).map(k => (
                  <TouchableOpacity
                    key={k}
                    style={[f.chip, c.field === k && f.chipActive]}
                    onPress={() => updateCondition(i, { field: k })}
                  >
                    <Text style={[f.chipText, c.field === k && f.chipActiveText]}>{FIELD_LABELS[k]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* 演算子 */}
              <View style={f.pickerWrap}>
                {(Object.keys(OP_LABELS) as FilterCondition['operator'][]).map(k => (
                  <TouchableOpacity
                    key={k}
                    style={[f.chip, c.operator === k && f.chipActive]}
                    onPress={() => updateCondition(i, { operator: k })}
                  >
                    <Text style={[f.chipText, c.operator === k && f.chipActiveText]}>{OP_LABELS[k]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* 値 */}
              <View style={f.condValueRow}>
                <TextInput
                  style={[f.input, { flex: 1, marginBottom: 0 }]}
                  value={c.value}
                  onChangeText={v => updateCondition(i, { value: v })}
                  placeholder="値を入力"
                  placeholderTextColor="#C7C7CC"
                  autoCapitalize="none"
                />
                {conditions.length > 1 && (
                  <TouchableOpacity
                    onPress={() => setConditions(prev => prev.filter((_, idx) => idx !== i))}
                    style={f.removeBtn}
                  >
                    <Ionicons name="close-circle" size={20} color="#FF3B30" />
                  </TouchableOpacity>
                )}
              </View>
              {i < conditions.length - 1 && <View style={f.condSep} />}
            </View>
          ))}

          <TouchableOpacity
            style={f.addCondBtn}
            onPress={() => setConditions(prev => [...prev, { field: 'from', operator: 'contains', value: '' }])}
          >
            <Ionicons name="add-circle-outline" size={15} color="#007AFF" style={{ marginRight: 4 }} />
            <Text style={f.addCondText}>条件を追加</Text>
          </TouchableOpacity>

          {/* アクション */}
          <Text style={[f.label, { marginTop: 16 }]}>アクション</Text>
          <View style={f.actionCard}>
            {/* フォルダへ移動 */}
            <Text style={f.actionLabel}>フォルダへ移動</Text>
            <TouchableOpacity
              style={f.folderPicker}
              onPress={() => setFolderPickerVisible(true)}
            >
              <Ionicons name="folder-outline" size={16} color="#8E8E93" style={{ marginRight: 8 }} />
              <Text style={[f.folderPickerText, !actionFolder && { color: '#C7C7CC' }]}>
                {actionFolder
                  ? (folders.find(fold => fold.path === actionFolder)?.name || actionFolder)
                  : '移動しない'}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#C7C7CC" />
            </TouchableOpacity>

            {/* フォルダ選択モーダル */}
            <Modal visible={folderPickerVisible} transparent animationType="fade" onRequestClose={() => setFolderPickerVisible(false)}>
              <TouchableOpacity style={f.pickerOverlay} activeOpacity={1} onPress={() => setFolderPickerVisible(false)}>
                <View style={f.pickerModal}>
                  <View style={f.pickerModalHeader}>
                    <Text style={f.pickerModalTitle}>フォルダを選択</Text>
                    <TouchableOpacity onPress={() => setFolderPickerVisible(false)}>
                      <Ionicons name="close" size={20} color="#8E8E93" />
                    </TouchableOpacity>
                  </View>
                  {/* 移動しない */}
                  <TouchableOpacity
                    style={f.pickerItem}
                    onPress={() => { setActionFolder(''); setFolderPickerVisible(false); }}
                  >
                    <Ionicons name="ban-outline" size={18} color="#8E8E93" style={{ marginRight: 12 }} />
                    <Text style={[f.pickerItemText, !actionFolder && { fontWeight: '600', color: '#007AFF' }]}>移動しない</Text>
                    {!actionFolder && <Ionicons name="checkmark" size={16} color="#007AFF" />}
                  </TouchableOpacity>
                  <View style={{ height: 0.5, backgroundColor: '#F0F0F0', marginLeft: 46 }} />
                  {folders.map((fold, i) => (
                    <View key={fold.path}>
                      <TouchableOpacity
                        style={f.pickerItem}
                        onPress={() => { setActionFolder(fold.path); setFolderPickerVisible(false); }}
                      >
                        <Ionicons name="folder-outline" size={18} color="#6366f1" style={{ marginRight: 12 }} />
                        <Text style={[f.pickerItemText, actionFolder === fold.path && { fontWeight: '600', color: '#007AFF' }]}>
                          {fold.name || fold.path}
                        </Text>
                        {actionFolder === fold.path && <Ionicons name="checkmark" size={16} color="#007AFF" />}
                      </TouchableOpacity>
                      {i < folders.length - 1 && <View style={{ height: 0.5, backgroundColor: '#F0F0F0', marginLeft: 46 }} />}
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            </Modal>

            {/* 既読にする */}
            <TouchableOpacity style={f.toggle} onPress={() => setActionMarkRead(v => !v)}>
              <View style={[f.checkbox, actionMarkRead && f.checkboxChecked]}>
                {actionMarkRead && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <Text style={f.toggleText}>既読にする</Text>
            </TouchableOpacity>

            {/* スターを付ける */}
            <TouchableOpacity style={f.toggle} onPress={() => setActionStarred(v => !v)}>
              <View style={[f.checkbox, actionStarred && f.checkboxChecked]}>
                {actionStarred && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <Text style={f.toggleText}>スターを付ける</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* フッター */}
        <View style={f.footer}>
          <TouchableOpacity style={f.cancelBtn} onPress={onClose}>
            <Text style={f.cancelText}>キャンセル</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[f.saveBtn, (saving || saved) && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving || saved}
          >
            {saving && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
            <Text style={f.saveText}>{saved ? '✓ 保存しました' : '保存'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const f = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    maxHeight: '88%',
    paddingBottom: 34,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D1D1D6', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: 16 },
  label: { fontSize: 11, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, color: '#000', marginBottom: 8,
    backgroundColor: '#FAFAFA',
  },
  condHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  segWrap: { flexDirection: 'row', backgroundColor: '#F2F2F7', borderRadius: 8, padding: 2 },
  seg: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  segActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  segText: { fontSize: 11, color: '#8E8E93', fontWeight: '500' },
  segActiveText: { color: '#000', fontWeight: '600' },
  condRow: { backgroundColor: '#F9F9F9', borderRadius: 10, padding: 10, marginBottom: 8 },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#F0F0F5', borderWidth: 1, borderColor: '#E5E5EA' },
  chipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  chipText: { fontSize: 12, color: '#3C3C43', fontWeight: '500' },
  chipActiveText: { color: '#fff', fontWeight: '600' },
  condValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeBtn: { padding: 2 },
  condSep: { height: 0.5, backgroundColor: '#E5E5EA', marginVertical: 8 },
  addCondBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  addCondText: { fontSize: 14, color: '#007AFF', fontWeight: '500' },
  actionCard: { backgroundColor: '#F9F9F9', borderRadius: 10, padding: 12, marginBottom: 12 },
  actionLabel: { fontSize: 12, color: '#8E8E93', fontWeight: '500', marginBottom: 6 },
  folderPicker: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10,
    backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 11,
    marginBottom: 10,
  },
  folderPickerText: { flex: 1, fontSize: 14, color: '#000' },
  pickerOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  pickerModal: {
    backgroundColor: '#fff', borderRadius: 14, width: '100%',
    maxHeight: 400, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 20, elevation: 12,
  },
  pickerModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  pickerModalTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  pickerItemText: { flex: 1, fontSize: 15, color: '#1C1C1E' },
  toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#C7C7CC',
    justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  checkboxChecked: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  toggleText: { fontSize: 14, color: '#1C1C1E' },
  footer: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 0.5, borderTopColor: '#F0F0F0',
  },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center',
  },
  cancelText: { fontSize: 15, color: '#3C3C43', fontWeight: '500' },
  saveBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#007AFF', alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
  },
  saveText: { fontSize: 15, color: '#fff', fontWeight: '600' },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  backBtn: { padding: 14 },

  // ─── コンパクトヘッダーバー（スクロールで現れる）───
  compactHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: 52, zIndex: 110, overflow: 'hidden',
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  compactHeaderInner: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 6,
  },
  compactBack: {
    width: 40, height: 52, justifyContent: 'center', alignItems: 'center',
  },
  compactTitle: {
    flex: 1, fontSize: 15, fontWeight: '600', color: '#000',
    marginHorizontal: 4,
  },
  compactActions: {
    flexDirection: 'row', alignItems: 'center',
  },
  compactBtn: {
    width: 38, height: 52, justifyContent: 'center', alignItems: 'center',
  },

  // ─── フローティングヘッダーボタン ───
  floatHeader: {
    position: 'absolute', left: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 100,
  },
  floatBack: {
    width: 38, height: 38, borderRadius: 19,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 16, elevation: 10,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.7)',
  },
  floatBackBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  floatPill: {
    borderRadius: 22, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 16, elevation: 10,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.7)',
  },
  floatPillInner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.45)',
    paddingHorizontal: 2, paddingVertical: 2,
  },
  floatBtn: { paddingHorizontal: 13, paddingVertical: 9 },
  floatDivider: { width: 0.5, height: 16, backgroundColor: 'rgba(60,60,67,0.18)' },
  subjectArea: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0' },
  subject: { fontSize: 20, fontWeight: '700', color: '#000', lineHeight: 26 },
  senderCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  senderAvatarWrap: {
    marginRight: 10, flexShrink: 0,
  },
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
  bodyText: { fontSize: 15, color: '#1c1c1e', lineHeight: 22, paddingHorizontal: 16, paddingTop: 12 },

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

  // ─── カレンダー追加ボタン ───
  calendarAddBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#34C759', borderRadius: 12,
    paddingVertical: 13, marginTop: 12, marginHorizontal: 2,
  },
  calendarAddBtnDone: { backgroundColor: '#8E8E93' },
  calendarAddText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});

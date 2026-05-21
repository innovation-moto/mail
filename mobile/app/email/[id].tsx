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
import { getEmail, getThreadEmails } from '../../lib/db';
import { mailApi } from '../../lib/api';
import SenderAvatar from '../../components/SenderAvatar';
import { QuickFilterSheet } from '../../components/QuickFilterSheet';
import type { AiSummarizeResult, AiTone, CalendarEvent, Email, Folder } from '@/shared/types';

const URL_REGEX = /(https?:\/\/[^\s　、。！）」"'<>）]+)|(mailto:[^\s<>"']+)|([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;

function LinkifiedText({ text, style }: { text: string; style?: object }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const raw = m[0];
    const url = raw.startsWith('http') || raw.startsWith('mailto') ? raw : `mailto:${raw}`;
    parts.push(
      <Text key={m.index} style={{ color: '#007AFF' }} onPress={() => Linking.openURL(url).catch(() => {})}>
        {raw}
      </Text>
    );
    last = m.index + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Text style={style}>{parts}</Text>;
}

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
  const { markRead, starEmail, deleteEmail, selectedFolder, folders, threadEmails } = useMailStore();
  const { openAiKey, selectedAccountId } = useAccountStore();

  const [email, setEmail] = useState<Email | null>(null);
  const [threadMailList, setThreadMailList] = useState<Email[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
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

      if (found && selectedAccountId && found.threadId) {
        try {
          const allInThread = await getThreadEmails(selectedAccountId, found.threadId, found.folder || selectedFolder);
          if (allInThread.length > 1) {
            setThreadMailList(allInThread);
            // 最新メール（一番最後）をデフォルト展開
            const latestId = allInThread[allInThread.length - 1]?.id;
            if (latestId) setExpandedIds(new Set([latestId]));
          } else {
            setThreadMailList([]);
          }
        } catch {
          setThreadMailList([]);
        }
      } else {
        setThreadMailList([]);
      }

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
    // スレッド表示の場合は最新メールに対してスター操作
    const target = threadMailList.length > 1 ? (threadMailList[threadMailList.length - 1] ?? email) : email;
    await starEmail(target.id, target.uid, target.folder || selectedFolder, !target.isStarred);
    setEmail(prev => prev ? { ...prev, isStarred: !prev.isStarred } : prev);
  };

  const handleDelete = () => {
    if (!email) return;
    // スレッド表示の場合は最新メールをゴミ箱へ
    const target = threadMailList.length > 1 ? (threadMailList[threadMailList.length - 1] ?? email) : email;
    Alert.alert('削除', 'このメールをゴミ箱に移動しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          await deleteEmail(target.id, target.uid, target.folder || selectedFolder);
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

  // スレッド表示の場合、最新メールをツールバーアクションの対象にする
  const latestEmail = threadMailList.length > 0 ? threadMailList[threadMailList.length - 1] : email;
  const activeEmail = latestEmail ?? email;

  const senderName = email.from.name || email.from.address;
  const toList = email.to.map(t => t.name || t.address).join(', ');
  const avatarColor = getAvatarColor(email.from.address);
  const avatarInitials = getInitials(email.from.name || '', email.from.address);

  // HTML メール用：件名・送信者情報も HTML 内に埋め込んで一体スクロール
  const buildHtmlContent = (m: Email) => {
    const mSender = m.from.name || m.from.address;
    const mToList = m.to.map(t => t.name || t.address).join(', ');
    const mAvatarColor = getAvatarColor(m.from.address);
    const mAvatarInitials = getInitials(m.from.name || '', m.from.address);
    return `
      <html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 16px; color: #1c1c1e; background: #fff; word-wrap: break-word; overflow-wrap: break-word; }
        .sender-card { display: flex; align-items: flex-start; padding: 12px 16px; border-bottom: 0.5px solid #F0F0F0; gap: 10px; }
        .avatar { width: 40px; height: 40px; border-radius: 20px; background: ${mAvatarColor}; display: flex; align-items: center; justify-content: center; color: white; font-size: 16px; font-weight: 700; flex-shrink: 0; }
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
      </style></head>
      <body>
        <div class="sender-card">
          <div class="avatar">${escapeHtml(mAvatarInitials)}</div>
          <div class="sender-info">
            <div class="sender-name">${escapeHtml(mSender)}</div>
            <div class="sender-sub">宛先: ${escapeHtml(mToList || 'あなた')}</div>
          </div>
          <div class="sender-right">
            <div class="sender-date">${escapeHtml(formatFullDate(m.date))}</div>
          </div>
        </div>
        <div class="body-content">
          ${m.bodyHtml || m.bodyText.replace(/\n/g, '<br>')}
        </div>
      </body></html>
    `;
  };

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

  // WebViewスクロール検知＋リンクインターセプトJS
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

      document.addEventListener('click', function(e) {
        var el = e.target;
        while (el && el.tagName !== 'A') el = el.parentElement;
        if (el && el.href && (el.href.startsWith('http') || el.href.startsWith('mailto'))) {
          e.preventDefault();
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'link', url: el.href}));
        }
      }, true);
    })();
    true;
  `;

  // アコーディオントグル
  const toggleExpand = (mailId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(mailId)) next.delete(mailId);
      else next.add(mailId);
      return next;
    });
  };

  // スレッド表示（2件以上の場合）
  const isThreadView = threadMailList.length > 1;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={{ flex: 1 }}>

        {/* ─── スレッド表示 ─── */}
        {isThreadView ? (
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
            {/* 件名（固定ヘッダー内） */}
            <View style={s.subjectArea}>
              <Text style={s.subject}>{email.subject || '（件名なし）'}</Text>
            </View>

            {/* 各メールアコーディオン */}
            {threadMailList.map((m, idx) => {
              const isExpanded = expandedIds.has(m.id);
              const mSender = m.from.name || m.from.address;
              return (
                <View key={m.id} style={s.accordionItem}>
                  {/* ヘッダー行（タップで本文トグル） */}
                  <TouchableOpacity
                    style={s.accordionHeader}
                    onPress={() => toggleExpand(m.id)}
                    activeOpacity={0.7}
                  >
                    <SenderAvatar fromEmail={m.from.address} fromName={m.from.name || ''} size={36} />
                    <View style={s.accordionSenderInfo}>
                      <Text style={[s.accordionSenderName, !m.isRead && { fontWeight: '700' }]} numberOfLines={1}>{mSender}</Text>
                      <Text style={s.accordionDate}>{formatFullDate(m.date)}</Text>
                    </View>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color="#8E8E93"
                    />
                  </TouchableOpacity>

                  {/* 本文（展開時のみ） */}
                  {isExpanded && (
                    <View style={s.accordionBody}>
                      {m.bodyHtml ? (
                        <WebView
                          source={{ html: buildHtmlContent(m) }}
                          style={{ height: 400 }}
                          scrollEnabled={false}
                          originWhitelist={['*']}
                          injectedJavaScript={scrollListenerJS}
                          onMessage={(e) => {
                            try {
                              const data = JSON.parse(e.nativeEvent.data);
                              if (data.type === 'link' && data.url) Linking.openURL(data.url).catch(() => {});
                            } catch {}
                          }}
                          onShouldStartLoadWithRequest={(req) => {
                            if (req.url.startsWith('about:') || req.url.startsWith('data:')) return true;
                            if (req.url.startsWith('http://') || req.url.startsWith('https://') || req.url.startsWith('mailto:')) {
                              Linking.openURL(req.url).catch(() => {});
                            }
                            return false;
                          }}
                        />
                      ) : (
                        <LinkifiedText style={s.bodyText} text={m.bodyText || '本文がありません'} />
                      )}
                    </View>
                  )}

                  {idx < threadMailList.length - 1 && <View style={s.accordionSep} />}
                </View>
              );
            })}
          </Animated.ScrollView>
        ) : (
          /* ─── 通常の1メール表示 ─── */
          <>
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
                    if (data.type === 'link' && data.url) Linking.openURL(data.url).catch(() => {});
                  } catch {}
                }}
                onShouldStartLoadWithRequest={(req) => {
                  if (req.url.startsWith('about:') || req.url.startsWith('data:')) return true;
                  if (req.url.startsWith('http://') || req.url.startsWith('https://') || req.url.startsWith('mailto:')) {
                    Linking.openURL(req.url).catch(() => {});
                  }
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
                <LinkifiedText style={s.bodyText} text={email.bodyText || '本文がありません'} />
              </Animated.ScrollView>
            )}
          </>
        )}

        {/* ─── フローティング ヘッダーボタン（スクロールで消える） ─── */}
        <Animated.View style={[s.floatHeader, { top: FLOAT_TOP, opacity: floatOpacity }]} pointerEvents="box-none">
          <BlurView intensity={72} tint="light" style={s.floatBack}>
            <TouchableOpacity style={s.floatBackBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={22} color="#007AFF" />
            </TouchableOpacity>
          </BlurView>
          <BlurView intensity={72} tint="light" style={s.floatPill}>
            <View style={s.floatPillInner}>
              <TouchableOpacity style={s.floatBtn} onPress={handleStar}>
                <Ionicons name={email.isStarred ? 'star' : 'star-outline'} size={19} color={email.isStarred ? '#FF9500' : '#3C3C43'} />
              </TouchableOpacity>
              <View style={s.floatDivider} />
              <TouchableOpacity style={s.floatBtn} onPress={handleSummarizeButton}>
                <Ionicons name="document-text-outline" size={19} color={openAiKey ? '#007AFF' : '#C7C7CC'} />
              </TouchableOpacity>
              <View style={s.floatDivider} />
              <TouchableOpacity style={s.floatBtn} onPress={() => setFilterVisible(true)}>
                <Ionicons name="funnel-outline" size={19} color="#3C3C43" />
              </TouchableOpacity>
            </View>
          </BlurView>
        </Animated.View>

        {/* ─── コンパクトヘッダーバー（スクロールで現れる） ─── */}
        <Animated.View style={[s.compactHeader, { opacity: compactHeaderOpacity }]} pointerEvents="box-none">
          <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
          <View style={s.compactHeaderInner}>
            <TouchableOpacity style={s.compactBack} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={22} color="#007AFF" />
            </TouchableOpacity>
            <Text style={s.compactTitle} numberOfLines={1}>{email.subject || '（件名なし）'}</Text>
            <View style={s.compactActions}>
              <TouchableOpacity style={s.compactBtn} onPress={handleStar}>
                <Ionicons name={email.isStarred ? 'star' : 'star-outline'} size={18} color={email.isStarred ? '#FF9500' : '#3C3C43'} />
              </TouchableOpacity>
              <TouchableOpacity style={s.compactBtn} onPress={handleSummarizeButton}>
                <Ionicons name="document-text-outline" size={18} color={openAiKey ? '#007AFF' : '#C7C7CC'} />
              </TouchableOpacity>
              <TouchableOpacity style={s.compactBtn} onPress={() => setFilterVisible(true)}>
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
            <TouchableOpacity style={s.toolbarBtn} onPress={() => router.push(`/compose?mode=reply&emailId=${activeEmail?.id ?? email.id}`)}>
              <Ionicons name="arrow-undo-outline" size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            {/* 全員に返信 */}
            <TouchableOpacity style={s.toolbarBtn} onPress={() => router.push(`/compose?mode=replyAll&emailId=${activeEmail?.id ?? email.id}`)}>
              <ReplyAllIcon size={22} color="#3C3C43" />
            </TouchableOpacity>
            <View style={s.toolbarDivider} />
            {/* 転送 */}
            <TouchableOpacity style={s.toolbarBtn} onPress={() => router.push(`/compose?mode=forward&emailId=${activeEmail?.id ?? email.id}`)}>
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
          accountId={selectedAccountId ?? ''}
          folders={folders}
          initialName={`${email.from.address} からのメール`}
          initialConditions={[{ field: 'from', operator: 'contains', value: email.from.address }]}
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

  // ─── スレッドアコーディオン ───
  accordionItem: {
    backgroundColor: '#fff',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  accordionSenderInfo: {
    flex: 1,
    minWidth: 0,
  },
  accordionSenderName: {
    fontSize: 14,
    color: '#1C1C1E',
    fontWeight: '400',
    marginBottom: 2,
  },
  accordionDate: {
    fontSize: 12,
    color: '#8E8E93',
  },
  accordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  accordionSep: {
    height: 0.5,
    backgroundColor: '#F0F0F0',
    marginHorizontal: 14,
  },

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

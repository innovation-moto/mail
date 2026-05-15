import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import WebView from 'react-native-webview';
import { useMailStore } from '../../store/mailStore';
import { getEmail } from '../../lib/db';
import type { Email } from '../../shared/types';

function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAvatarColor(name: string): string {
  const colors = ['#007AFF', '#34C759', '#AF52DE', '#FF9500', '#FF2D55', '#5856D6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + hash * 31;
  return colors[Math.abs(hash) % colors.length];
}

export default function EmailDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { markRead, starEmail, deleteEmail, selectedFolder } = useMailStore();

  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [useWebView, setUseWebView] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!id) return;
    (async () => {
      const found = await getEmail(id);
      setEmail(found);
      setLoading(false);
      if (found && !found.isRead) {
        markRead(found.id, found.uid, found.folder || selectedFolder);
      }
      // Default to WebView when HTML body is available
      if (found?.bodyHtml) setUseWebView(true);
    })();
  }, [id]);

  const handleStar = async () => {
    if (!email) return;
    const newStarred = !email.isStarred;
    await starEmail(email.id, email.uid, email.folder || selectedFolder, newStarred);
    setEmail((prev) => (prev ? { ...prev, isStarred: newStarred } : prev));
  };

  const handleDelete = () => {
    if (!email) return;
    Alert.alert('削除', 'このメールをゴミ箱に移動しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await deleteEmail(email.id, email.uid, email.folder || selectedFolder);
          router.back();
        },
      },
    ]);
  };

  const handleReply = () => {
    if (!email) return;
    router.push({
      pathname: '/compose',
      params: { mode: 'reply', emailId: email.id },
    });
  };

  const handleReplyAll = () => {
    if (!email) return;
    router.push({
      pathname: '/compose',
      params: { mode: 'replyAll', emailId: email.id },
    });
  };

  const handleForward = () => {
    if (!email) return;
    router.push({
      pathname: '/compose',
      params: { mode: 'forward', emailId: email.id },
    });
  };

  const openMenu = () => {
    setShowMenu(true);
    Animated.spring(menuAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 10 }).start();
  };

  const closeMenu = () => {
    Animated.timing(menuAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() =>
      setShowMenu(false),
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#007AFF" />
            <Text style={styles.backText}>戻る</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </SafeAreaView>
    );
  }

  if (!email) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#007AFF" />
            <Text style={styles.backText}>戻る</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.notFound}>
          <Ionicons name="mail-open-outline" size={48} color="#C7C7CC" />
          <Text style={styles.notFoundText}>メールが見つかりません</Text>
        </View>
      </SafeAreaView>
    );
  }

  const fromName = email.from.name || email.from.address;
  const avatarColor = getAvatarColor(fromName);
  const toStr = email.to.map((t) => t.name || t.address).join(', ');
  const ccStr = email.cc?.map((t) => t.name || t.address).join(', ');

  const htmlContent = email.bodyHtml
    ? `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=2.0">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, Helvetica Neue, sans-serif;
    font-size: 15px;
    color: #000;
    margin: 0;
    padding: 12px 16px 24px;
    line-height: 1.55;
    word-break: break-word;
  }
  img { max-width: 100%; height: auto; display: block; }
  a { color: #007AFF; }
  pre { white-space: pre-wrap; word-break: break-all; background: #f5f5f5; padding: 8px; border-radius: 4px; font-size: 13px; }
  blockquote { border-left: 3px solid #C7C7CC; margin-left: 0; padding-left: 12px; color: #6C6C70; }
  table { width: 100% !important; table-layout: fixed; }
</style>
</head>
<body>${email.bodyHtml}</body>
</html>`
    : null;

  const menuTranslateY = menuAnim.interpolate({ inputRange: [0, 1], outputRange: [200, 0] });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#007AFF" />
          <Text style={styles.backText}>受信トレイ</Text>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={handleStar}>
            <Ionicons
              name={email.isStarred ? 'star' : 'star-outline'}
              size={22}
              color={email.isStarred ? '#FF9500' : '#007AFF'}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={22} color="#FF3B30" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={openMenu}>
            <Ionicons name="ellipsis-horizontal-circle-outline" size={22} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main scroll content */}
      <View style={styles.body}>
        {/* Subject */}
        <View style={styles.subjectContainer}>
          <Text style={styles.subject}>{email.subject || '（件名なし）'}</Text>
          {email.aiSummary && (
            <View style={styles.aiSummaryBadge}>
              <Ionicons name="sparkles" size={13} color="#AF52DE" />
              <Text style={styles.aiSummaryText}>{email.aiSummary}</Text>
            </View>
          )}
        </View>

        {/* Sender info card */}
        <TouchableOpacity
          style={styles.senderCard}
          onPress={() => setShowDetails(!showDetails)}
          activeOpacity={0.8}
        >
          <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarText}>{(fromName.charAt(0) || '?').toUpperCase()}</Text>
          </View>
          <View style={styles.senderInfo}>
            <View style={styles.senderTopRow}>
              <Text style={styles.fromName} numberOfLines={1}>{fromName}</Text>
              <Text style={styles.dateText}>{formatFullDate(email.date)}</Text>
            </View>
            <Text style={styles.fromAddress} numberOfLines={1}>{email.from.address}</Text>
            {!showDetails && (
              <Text style={styles.toPreview} numberOfLines={1}>To: {toStr}</Text>
            )}
          </View>
          <Ionicons
            name={showDetails ? 'chevron-up' : 'chevron-down'}
            size={16}
            color="#C7C7CC"
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>

        {/* Expanded details */}
        {showDetails && (
          <View style={styles.detailsPanel}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>To</Text>
              <Text style={styles.detailValue}>{toStr}</Text>
            </View>
            {ccStr ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Cc</Text>
                <Text style={styles.detailValue}>{ccStr}</Text>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>日時</Text>
              <Text style={styles.detailValue}>{formatFullDate(email.date)}</Text>
            </View>
          </View>
        )}

        {/* Attachments */}
        {email.attachments?.length > 0 && (
          <View style={styles.attachmentsSection}>
            <Text style={styles.attachmentsTitle}>添付ファイル ({email.attachments.length})</Text>
            {email.attachments.map((att) => (
              <View key={att.id} style={styles.attachmentItem}>
                <Ionicons name="document-attach-outline" size={18} color="#007AFF" />
                <View style={styles.attachmentInfo}>
                  <Text style={styles.attachmentName} numberOfLines={1}>{att.filename}</Text>
                  <Text style={styles.attachmentSize}>{formatSize(att.size)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* View toggle */}
        {email.bodyHtml && (
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.viewToggleBtn, !useWebView && styles.viewToggleBtnActive]}
              onPress={() => setUseWebView(false)}
            >
              <Text style={[styles.viewToggleTxt, !useWebView && styles.viewToggleTxtActive]}>テキスト</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewToggleBtn, useWebView && styles.viewToggleBtnActive]}
              onPress={() => setUseWebView(true)}
            >
              <Text style={[styles.viewToggleTxt, useWebView && styles.viewToggleTxtActive]}>HTML</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Body */}
        {useWebView && htmlContent ? (
          <WebView
            source={{ html: htmlContent }}
            style={styles.webview}
            scalesPageToFit={false}
            javaScriptEnabled={false}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <ScrollView
            style={styles.textScroll}
            contentContainerStyle={styles.textContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.bodyText} selectable>
              {email.bodyText || '（本文なし）'}
            </Text>
          </ScrollView>
        )}
      </View>

      {/* Bottom action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleReply}>
          <Ionicons name="arrow-undo-outline" size={20} color="#007AFF" />
          <Text style={styles.actionText}>返信</Text>
        </TouchableOpacity>
        <View style={styles.actionDivider} />
        <TouchableOpacity style={styles.actionBtn} onPress={handleReplyAll}>
          <Ionicons name="arrow-undo-outline" size={20} color="#007AFF" />
          <Text style={styles.actionText}>全員返信</Text>
        </TouchableOpacity>
        <View style={styles.actionDivider} />
        <TouchableOpacity style={styles.actionBtn} onPress={handleForward}>
          <Ionicons name="arrow-redo-outline" size={20} color="#007AFF" />
          <Text style={styles.actionText}>転送</Text>
        </TouchableOpacity>
      </View>

      {/* More actions menu */}
      <Modal visible={showMenu} transparent animationType="none" onRequestClose={closeMenu}>
        <Pressable style={styles.menuOverlay} onPress={closeMenu}>
          <Animated.View style={[styles.menuSheet, { transform: [{ translateY: menuTranslateY }] }]}>
            <Pressable>
              <View style={styles.menuHandle} />
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  closeMenu();
                  setUseWebView(!useWebView);
                }}
              >
                <Ionicons name={useWebView ? 'text' : 'globe-outline'} size={20} color="#007AFF" />
                <Text style={styles.menuItemText}>
                  {useWebView ? 'テキスト表示に切替' : 'HTML表示に切替'}
                </Text>
              </TouchableOpacity>
              <View style={styles.menuSeparator} />
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  closeMenu();
                  handleDelete();
                }}
              >
                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                <Text style={[styles.menuItemText, { color: '#FF3B30' }]}>削除</Text>
              </TouchableOpacity>
              <View style={{ height: 16 }} />
              <TouchableOpacity style={[styles.menuItem, styles.menuCancel]} onPress={closeMenu}>
                <Text style={styles.menuCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <View style={{ height: 16 }} />
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
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
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  backText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: -2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  iconBtn: {
    padding: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  notFoundText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  body: {
    flex: 1,
  },

  // Subject
  subjectContainer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F0F0F0',
  },
  subject: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  aiSummaryBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    backgroundColor: '#F8F0FF',
    borderRadius: 8,
    padding: 8,
    gap: 6,
  },
  aiSummaryText: {
    flex: 1,
    fontSize: 13,
    color: '#6E3D8E',
    lineHeight: 18,
  },

  // Sender card
  senderCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F0F0F0',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  senderInfo: {
    flex: 1,
  },
  senderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fromName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
  },
  dateText: {
    fontSize: 11,
    color: '#8E8E93',
    flexShrink: 0,
  },
  fromAddress: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 1,
  },
  toPreview: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },

  // Details panel
  detailsPanel: {
    backgroundColor: '#F9F9FB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F0F0F0',
    gap: 4,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 8,
  },
  detailLabel: {
    fontSize: 13,
    color: '#8E8E93',
    width: 36,
    fontWeight: '500',
  },
  detailValue: {
    flex: 1,
    fontSize: 13,
    color: '#3C3C43',
    lineHeight: 18,
  },

  // Attachments
  attachmentsSection: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F0F0F0',
    gap: 6,
  },
  attachmentsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 4,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    padding: 10,
    gap: 10,
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentName: {
    fontSize: 14,
    color: '#000000',
    fontWeight: '500',
  },
  attachmentSize: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 1,
  },

  // View toggle
  viewToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    padding: 2,
  },
  viewToggleBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  viewToggleBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  viewToggleTxt: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '500',
  },
  viewToggleTxtActive: {
    color: '#000000',
    fontWeight: '600',
  },

  // Body
  webview: {
    flex: 1,
  },
  textScroll: {
    flex: 1,
  },
  textContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
  },
  bodyText: {
    fontSize: 15,
    color: '#000000',
    lineHeight: 23,
  },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    paddingVertical: 4,
    paddingBottom: 8,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    gap: 3,
  },
  actionDivider: {
    width: 0.5,
    backgroundColor: '#E5E5EA',
    marginVertical: 8,
  },
  actionText: {
    fontSize: 11,
    color: '#007AFF',
    fontWeight: '500',
  },

  // Menu modal
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  menuHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D1D6',
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
  },
  menuItemText: {
    fontSize: 16,
    color: '#000000',
  },
  menuSeparator: {
    height: 0.5,
    backgroundColor: '#E5E5EA',
  },
  menuCancel: {
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 0,
  },
  menuCancelText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
});

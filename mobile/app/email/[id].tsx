import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import WebView from 'react-native-webview';
import { useMailStore } from '../../store/mailStore';
import { getEmail } from '../../lib/db';
import type { Email } from '@/shared/types';

function formatFullDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EmailDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { markRead, starEmail, deleteEmail, selectedFolder } = useMailStore();

  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHtml, setShowHtml] = useState(false);

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

  const handleStar = async () => {
    if (!email) return;
    await starEmail(email.id, email.uid, email.folder || selectedFolder, !email.isStarred);
    setEmail((prev) => prev ? { ...prev, isStarred: !prev.isStarred } : prev);
  };

  const handleDelete = async () => {
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
    router.push('/compose');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </SafeAreaView>
    );
  }

  if (!email) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#007AFF" />
          <Text style={styles.backText}>戻る</Text>
        </TouchableOpacity>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>メールが見つかりません</Text>
        </View>
      </SafeAreaView>
    );
  }

  const fromName = email.from.name || email.from.address;
  const toStr = email.to.map((t) => t.name || t.address).join(', ');

  const htmlContent = email.bodyHtml
    ? `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, sans-serif; font-size: 15px; color: #000; margin: 0; padding: 12px; }
  img { max-width: 100%; height: auto; }
  a { color: #007AFF; }
  pre { white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>${email.bodyHtml}</body>
</html>`
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#007AFF" />
          <Text style={styles.backText}>受信トレイ</Text>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleStar} style={styles.iconButton}>
            <Ionicons
              name={email.isStarred ? 'star' : 'star-outline'}
              size={22}
              color={email.isStarred ? '#FF9500' : '#007AFF'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowHtml(!showHtml)}
            style={styles.iconButton}
          >
            <Ionicons
              name={showHtml ? 'code-slash' : 'globe-outline'}
              size={22}
              color="#007AFF"
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Subject */}
      <View style={styles.subjectContainer}>
        <Text style={styles.subject}>{email.subject || '（件名なし）'}</Text>
      </View>

      {/* Sender info */}
      <View style={styles.senderContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{fromName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.senderDetails}>
          <Text style={styles.fromName}>{fromName}</Text>
          <Text style={styles.fromAddress}>{email.from.address}</Text>
          <Text style={styles.toStr} numberOfLines={1}>To: {toStr}</Text>
          <Text style={styles.date}>{formatFullDate(email.date)}</Text>
        </View>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {htmlContent && showHtml ? (
          <WebView
            source={{ html: htmlContent }}
            style={styles.webview}
            scalesPageToFit={false}
            javaScriptEnabled={false}
          />
        ) : (
          <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
            <Text style={styles.bodyText}>{email.bodyText || '本文なし'}</Text>
          </ScrollView>
        )}
      </View>

      {/* Bottom action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionButton} onPress={handleReply}>
          <Ionicons name="arrow-undo" size={22} color="#007AFF" />
          <Text style={styles.actionText}>返信</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleReply}>
          <Ionicons name="arrow-redo" size={22} color="#007AFF" />
          <Text style={styles.actionText}>転送</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={22} color="#FF3B30" />
          <Text style={[styles.actionText, { color: '#FF3B30' }]}>削除</Text>
        </TouchableOpacity>
      </View>
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
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5EA',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  backText: {
    fontSize: 16,
    color: '#007AFF',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    padding: 8,
  },
  subjectContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F0F0F0',
  },
  subject: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 26,
  },
  senderContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F0F0F0',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  senderDetails: {
    flex: 1,
  },
  fromName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
  },
  fromAddress: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 1,
  },
  toStr: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  date: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  body: {
    flex: 1,
  },
  textScroll: {
    flex: 1,
  },
  textContent: {
    padding: 16,
  },
  bodyText: {
    fontSize: 15,
    color: '#000000',
    lineHeight: 22,
  },
  webview: {
    flex: 1,
  },
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    paddingBottom: 8,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  actionText: {
    fontSize: 11,
    color: '#007AFF',
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
  },
  notFoundText: {
    fontSize: 16,
    color: '#8E8E93',
  },
});

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Email } from '@/shared/types';
import SenderAvatar from './SenderAvatar';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) {
    const h = d.getHours() % 12 || 12;
    const m = d.getMinutes().toString().padStart(2, '0');
    const ampm = d.getHours() < 12 ? '午前' : '午後';
    return `${ampm}${h}:${m}`;
  }
  if (diff === 1) return '昨日';
  if (diff < 7) return ['日','月','火','水','木','金','土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getPreview(email: Email): string {
  const t = email.bodyText || email.bodyHtml.replace(/<[^>]+>/g, ' ');
  return t.replace(/\s+/g, ' ').trim().slice(0, 100);
}

interface Props {
  email: Email;
  onPress: () => void;
}

export default function EmailItem({ email, onPress }: Props) {
  const sender = email.from.name || email.from.address;
  const preview = getPreview(email);
  const isUnread = !email.isRead;
  const isHighPriority = email.aiPriority === 'high';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {/* 未読ドット */}
      <View style={styles.dotCol}>
        {isUnread && <View style={styles.dot} />}
      </View>

      {/* アバター */}
      <View style={av.wrap}>
        <SenderAvatar fromEmail={email.from.address} fromName={email.from.name || ''} size={36} />
      </View>

      {/* コンテンツ */}
      <View style={styles.body}>
        {/* 1行目: 送信者 + 日付 */}
        <View style={styles.top}>
          <Text style={[styles.sender, isUnread && styles.bold]} numberOfLines={1}>
            {sender}
          </Text>
          <View style={styles.topRight}>
            {email.isStarred && (
              <Ionicons name="star" size={12} color="#FF9500" style={{ marginRight: 2 }} />
            )}
            {email.hasAttachments && (
              <Ionicons name="attach" size={12} color="#8E8E93" style={{ marginRight: 2 }} />
            )}
            <Text style={styles.date}>{formatDate(email.date)}</Text>
            <Ionicons name="chevron-forward" size={13} color="#C7C7CC" style={{ marginLeft: 1 }} />
          </View>
        </View>

        {/* 2行目: 件名 */}
        <Text style={[styles.subject, isUnread && styles.subjectBold]} numberOfLines={1}>
          {email.subject || '（件名なし）'}
        </Text>

        {/* 3行目: プレビュー + バッジ */}
        <View style={styles.previewRow}>
          <Text style={styles.preview} numberOfLines={1}>{preview || '本文なし'}</Text>
          {isHighPriority && (
            <View style={styles.priorityDot} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const av = StyleSheet.create({
  wrap: { marginRight: 10, flexShrink: 0, marginTop: 1 },
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingRight: 14,
    backgroundColor: '#fff',
  },
  dotCol: { width: 22, alignItems: 'center', paddingTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#007AFF' },
  body: { flex: 1, gap: 2 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 1,
  },
  sender: { flex: 1, fontSize: 15, color: '#000', fontWeight: '400', marginRight: 6 },
  bold: { fontWeight: '700' },
  topRight: { flexDirection: 'row', alignItems: 'center' },
  date: { fontSize: 12, color: '#8E8E93' },
  subject: { fontSize: 14, color: '#000', fontWeight: '400' },
  subjectBold: { fontWeight: '600' },
  previewRow: { flexDirection: 'row', alignItems: 'center' },
  preview: { flex: 1, fontSize: 13, color: '#8E8E93', lineHeight: 17 },
  priorityDot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: '#FF3B30', marginLeft: 4, flexShrink: 0,
  },
});

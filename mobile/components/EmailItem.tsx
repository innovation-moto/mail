import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Email } from '@/shared/types';

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // Same day: show time
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${minutes} ${ampm}`;
  } else if (diffDays === 1) {
    return '昨日';
  } else if (diffDays < 7) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return days[date.getDay()];
  } else {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}/${day}`;
  }
}

function getPreviewText(email: Email): string {
  const text = email.bodyText || email.bodyHtml.replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim().slice(0, 100);
}

interface Props {
  email: Email;
  onPress: () => void;
}

export default function EmailItem({ email, onPress }: Props) {
  const preview = getPreviewText(email);
  const senderName = email.from.name || email.from.address;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Unread dot */}
      <View style={styles.dotColumn}>
        {!email.isRead && <View style={styles.unreadDot} />}
      </View>

      {/* Avatar */}
      <View style={[styles.avatar, email.isRead && styles.avatarRead]}>
        <Text style={styles.avatarText}>
          {senderName.charAt(0).toUpperCase()}
        </Text>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text
            style={[styles.senderName, !email.isRead && styles.senderNameUnread]}
            numberOfLines={1}
          >
            {senderName}
          </Text>
          <View style={styles.topRight}>
            {email.isStarred && (
              <Ionicons name="star" size={13} color="#FF9500" style={styles.starIcon} />
            )}
            {email.hasAttachments && (
              <Ionicons name="attach" size={13} color="#8E8E93" style={styles.attachIcon} />
            )}
            <Text style={styles.date}>{formatDate(email.date)}</Text>
            <Ionicons name="chevron-forward" size={14} color="#C7C7CC" />
          </View>
        </View>

        <Text
          style={[styles.subject, !email.isRead && styles.subjectUnread]}
          numberOfLines={1}
        >
          {email.subject || '（件名なし）'}
        </Text>

        <Text style={styles.preview} numberOfLines={1}>
          {preview || '本文なし'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  dotColumn: {
    width: 20,
    alignItems: 'center',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007AFF',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarRead: {
    backgroundColor: '#C7C7CC',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  senderName: {
    flex: 1,
    fontSize: 15,
    color: '#000000',
    fontWeight: '400',
    marginRight: 8,
  },
  senderNameUnread: {
    fontWeight: '700',
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  starIcon: {
    marginRight: 2,
  },
  attachIcon: {
    marginRight: 2,
  },
  date: {
    fontSize: 12,
    color: '#8E8E93',
    marginRight: 2,
  },
  subject: {
    fontSize: 14,
    color: '#000000',
    fontWeight: '400',
  },
  subjectUnread: {
    fontWeight: '600',
  },
  preview: {
    fontSize: 13,
    color: '#666666',
    lineHeight: 17,
  },
});

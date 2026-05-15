import React, { useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Email } from '../shared/types';

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  // Same calendar day
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return '昨日';

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return days[date.getDay()];
  }

  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
}

function getPreviewText(email: Email): string {
  const text = email.bodyText || email.bodyHtml.replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function getInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}

interface Props {
  email: Email;
  onPress: () => void;
  onStar?: () => void;
  onDelete?: () => void;
}

const SWIPE_THRESHOLD = 60;
const ACTION_WIDTH = 72;

export default function EmailItem({ email, onPress, onStar, onDelete }: Props) {
  const preview = getPreviewText(email);
  const senderName = email.from.name || email.from.address;
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOpen = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 5 && Math.abs(gestureState.dy) < 15,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(Math.max(gestureState.dx, -ACTION_WIDTH * 2));
        } else if (swipeOpen.current) {
          translateX.setValue(Math.min(0, -ACTION_WIDTH * 2 + gestureState.dx));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (!swipeOpen.current && gestureState.dx < -SWIPE_THRESHOLD) {
          // Open actions
          Animated.spring(translateX, {
            toValue: -ACTION_WIDTH * 2,
            useNativeDriver: true,
            tension: 60,
            friction: 8,
          }).start();
          swipeOpen.current = true;
        } else {
          // Close
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 60,
            friction: 8,
          }).start();
          swipeOpen.current = false;
        }
      },
    }),
  ).current;

  const closeSwipe = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 8,
    }).start();
    swipeOpen.current = false;
  };

  return (
    <View style={styles.wrapper}>
      {/* Swipe action buttons (revealed from right) */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.starBtn]}
          onPress={() => {
            closeSwipe();
            onStar?.();
          }}
        >
          <Ionicons
            name={email.isStarred ? 'star' : 'star-outline'}
            size={22}
            color="#FFFFFF"
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.deleteBtn]}
          onPress={() => {
            closeSwipe();
            onDelete?.();
          }}
        >
          <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Main row */}
      <Animated.View style={[styles.row, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <TouchableOpacity
          style={styles.touchable}
          onPress={() => {
            if (swipeOpen.current) {
              closeSwipe();
            } else {
              onPress();
            }
          }}
          activeOpacity={0.7}
        >
          {/* Unread dot */}
          <View style={styles.dotColumn}>
            {!email.isRead && <View style={styles.unreadDot} />}
          </View>

          {/* Avatar */}
          <View style={[styles.avatar, email.isRead && styles.avatarRead]}>
            <Text style={styles.avatarText}>{getInitial(senderName)}</Text>
          </View>

          {/* Content */}
          <View style={styles.content}>
            {/* Top row: sender + meta */}
            <View style={styles.topRow}>
              <Text
                style={[styles.senderName, !email.isRead && styles.senderNameUnread]}
                numberOfLines={1}
              >
                {senderName}
              </Text>
              <View style={styles.metaRow}>
                {email.isStarred && (
                  <Ionicons name="star" size={12} color="#FF9500" />
                )}
                {email.hasAttachments && (
                  <Ionicons name="attach" size={13} color="#8E8E93" />
                )}
                <Text style={styles.date}>{formatDate(email.date)}</Text>
                <Ionicons name="chevron-forward" size={13} color="#C7C7CC" />
              </View>
            </View>

            {/* Subject */}
            <Text
              style={[styles.subject, !email.isRead && styles.subjectUnread]}
              numberOfLines={1}
            >
              {email.subject || '（件名なし）'}
            </Text>

            {/* Preview */}
            <Text style={styles.preview} numberOfLines={1}>
              {preview || '本文なし'}
            </Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  actions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    width: 144,
  },
  actionBtn: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  starBtn: {
    backgroundColor: '#FF9500',
  },
  deleteBtn: {
    backgroundColor: '#FF3B30',
  },
  row: {
    backgroundColor: '#FFFFFF',
  },
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 11,
  },
  dotColumn: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginLeft: 2,
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
    marginBottom: 1,
  },
  senderName: {
    flex: 1,
    fontSize: 15,
    color: '#000000',
    fontWeight: '400',
    marginRight: 6,
  },
  senderNameUnread: {
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  date: {
    fontSize: 12,
    color: '#8E8E93',
  },
  subject: {
    fontSize: 14,
    color: '#3C3C43',
    fontWeight: '400',
    lineHeight: 18,
  },
  subjectUnread: {
    fontWeight: '600',
    color: '#000000',
  },
  preview: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 17,
  },
});

import React, { useRef } from 'react';
import {
  Animated, Easing, PanResponder, View, Text, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThreadSummary } from '@/shared/types';
import SenderAvatar from './SenderAvatar';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DELETE_BUTTON_WIDTH = 80;
// この位置を超えたら「開いた」と判定
const SNAP_OPEN_THRESHOLD = DELETE_BUTTON_WIDTH * 0.4;

function formatTime(ts: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  if (ts >= today) {
    return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } else if (ts >= yesterday) {
    return '昨日';
  } else {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
}

interface Props {
  thread: ThreadSummary;
  onPress: () => void;
  onDelete: () => void;
  onMove: () => void;
}

export function SwipeableThreadItem({ thread, onPress, onDelete, onMove }: Props) {
  const translateX   = useRef(new Animated.Value(0)).current;
  const rowHeight    = useRef(new Animated.Value(1)).current; // 削除アニメ用（1=通常, 0=消去）
  const currentX     = useRef(0);
  const isOpen       = useRef(false);
  const onDeleteRef  = useRef(onDelete);
  const onPressRef   = useRef(onPress);
  const onMoveRef    = useRef(onMove);
  onDeleteRef.current = onDelete;
  onPressRef.current  = onPress;
  onMoveRef.current   = onMove;

  const animateTo = (toValue: number, callback?: () => void) => {
    Animated.timing(translateX, {
      toValue,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(() => callback?.());
    currentX.current = toValue;
  };

  const snapOpen  = () => { isOpen.current = true;  animateTo(-DELETE_BUTTON_WIDTH); };
  const snapClose = () => { isOpen.current = false; animateTo(0); };

  const execDelete = () => {
    isOpen.current = false;
    // 1) 行を左にスライドアウト（ease-in で加速感）
    Animated.timing(translateX, {
      toValue: -SCREEN_WIDTH,
      duration: 220,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      // 2) 高さを 0 に縮めてリストが詰まる
      Animated.timing(rowHeight, {
        toValue: 0,
        duration: 160,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start(() => onDeleteRef.current());
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,

      onPanResponderMove: (_, g) => {
        const base = isOpen.current ? -DELETE_BUTTON_WIDTH : 0;
        const next = Math.min(Math.max(base + g.dx, -DELETE_BUTTON_WIDTH), 8);
        currentX.current = next;
        translateX.setValue(next);
      },

      onPanResponderRelease: () => {
        // 現在位置で判定（g.dx / g.vx に依存しない）
        if (isOpen.current) {
          // 開いている → 40px以上右に引いたら閉じる、それ以外は開いたまま
          currentX.current > -DELETE_BUTTON_WIDTH + 40 ? snapClose() : snapOpen();
        } else {
          // 閉じている → 40px以上左に引いたら開く、それ以外は閉じたまま
          currentX.current < -SNAP_OPEN_THRESHOLD ? snapOpen() : snapClose();
        }
      },

      onPanResponderTerminate: () => {
        // 親に横取りされた場合も現在位置で判定
        currentX.current < -SNAP_OPEN_THRESHOLD ? snapOpen() : snapClose();
      },
    })
  ).current;

  const isUnread   = thread.unreadCount > 0;
  const senderName = thread.latestFrom.name || thread.latestFrom.address;
  const timeStr    = formatTime(thread.latestDate);

  // rowHeight(0〜1) を実際の高さにマッピング（onLayout で取得するより scaleY の方が軽量）
  const containerStyle = {
    ...s.container,
    opacity: rowHeight,
    transform: [{ scaleY: rowHeight }],
  };

  return (
    <Animated.View style={containerStyle}>
      {/* 削除ボタン（右端固定） */}
      <TouchableOpacity style={s.deleteButton} onPress={execDelete} activeOpacity={0.8}>
        <Ionicons name="trash-outline" size={22} color="#fff" />
        <Text style={s.deleteLabel}>削除</Text>
      </TouchableOpacity>

      {/* スレッド行 */}
      <Animated.View style={[s.row, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <TouchableOpacity
          style={s.inner}
          onPress={() => { isOpen.current ? snapClose() : onPressRef.current(); }}
          onLongPress={() => onMoveRef.current()}
          activeOpacity={0.7}
        >
          <SenderAvatar fromEmail={thread.latestFrom.address} fromName={thread.latestFrom.name} size={40} />
          <View style={s.body}>
            <View style={s.row1}>
              <Text style={[s.sender, isUnread && s.bold]} numberOfLines={1}>{senderName}</Text>
              <View style={s.right}>
                {thread.emailCount > 1 && <Text style={s.count}>{thread.emailCount}</Text>}
                <Text style={s.time}>{timeStr}</Text>
              </View>
            </View>
            <View style={s.row2}>
              <Text style={[s.subject, isUnread && s.bold]} numberOfLines={1}>
                {thread.subject || '（件名なし）'}
              </Text>
              {isUnread && <View style={s.unreadDot} />}
              {thread.hasAttachments && <Ionicons name="attach" size={12} color="#8E8E93" />}
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container:    { overflow: 'hidden', backgroundColor: '#FF3B30' },
  deleteButton: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: DELETE_BUTTON_WIDTH, backgroundColor: '#FF3B30',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  deleteLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
  row:   { backgroundColor: '#fff' },
  inner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  body:  { flex: 1 },
  row1:  { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  row2:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sender:  { flex: 1, fontSize: 15, color: '#1C1C1E' },
  subject: { flex: 1, fontSize: 13, color: '#3C3C43' },
  bold:    { fontWeight: '700' },
  right:   { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  count:   { fontSize: 12, color: '#8E8E93', backgroundColor: '#E5E5EA', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  time:    { fontSize: 12, color: '#8E8E93' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#007AFF' },
});

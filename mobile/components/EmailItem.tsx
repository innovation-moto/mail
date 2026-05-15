import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Email } from '@/shared/types';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) {
    const h = d.getHours() % 12 || 12;
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
  if (diff === 1) return '昨日';
  if (diff < 7) return ['日','月','火','水','木','金','土'][d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function getPreview(email: Email): string {
  const t = email.bodyText || email.bodyHtml.replace(/<[^>]+>/g,' ');
  return t.replace(/\s+/g,' ').trim().slice(0,120);
}

interface Props {
  email: Email;
  onPress: () => void;
}

export default function EmailItem({ email, onPress }: Props) {
  const sender = email.from.name || email.from.address;
  const preview = getPreview(email);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.dotCol}>
        {!email.isRead && <View style={styles.dot} />}
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.sender, !email.isRead && styles.bold]} numberOfLines={1}>
            {sender}
          </Text>
          <View style={styles.right}>
            {email.isStarred && <Ionicons name="star" size={12} color="#FF9500" style={{marginRight:2}} />}
            {email.hasAttachments && <Ionicons name="attach" size={12} color="#8E8E93" style={{marginRight:2}} />}
            <Text style={styles.date}>{formatDate(email.date)}</Text>
            <Ionicons name="chevron-forward" size={13} color="#C7C7CC" style={{marginLeft:1}} />
          </View>
        </View>
        <Text style={[styles.subject, !email.isRead && styles.subjectBold]} numberOfLines={1}>
          {email.subject || '（件名なし）'}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>{preview || '本文なし'}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection:'row', alignItems:'flex-start', paddingVertical:11, paddingRight:14, backgroundColor:'#fff' },
  dotCol: { width:26, alignItems:'center', paddingTop:4 },
  dot: { width:8, height:8, borderRadius:4, backgroundColor:'#007AFF' },
  body: { flex:1, gap:2 },
  top: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:1 },
  sender: { flex:1, fontSize:15, color:'#000', fontWeight:'400', marginRight:8 },
  bold: { fontWeight:'700' },
  right: { flexDirection:'row', alignItems:'center' },
  date: { fontSize:12, color:'#8E8E93' },
  subject: { fontSize:14, color:'#000', fontWeight:'400' },
  subjectBold: { fontWeight:'600' },
  preview: { fontSize:13, color:'#8E8E93', lineHeight:17 },
});

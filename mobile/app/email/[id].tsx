import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import WebView from 'react-native-webview';
import { useMailStore } from '../../store/mailStore';
import { getEmail } from '../../lib/db';
import type { Email } from '@/shared/types';

function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleString('ja-JP', {
    year:'numeric', month:'long', day:'numeric', weekday:'short',
    hour:'2-digit', minute:'2-digit',
  });
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

export default function EmailDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { markRead, starEmail, deleteEmail, selectedFolder } = useMailStore();

  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHtml, setShowHtml] = useState(true);
  const [headerExpanded, setHeaderExpanded] = useState(false);

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

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <ActivityIndicator style={{flex:1}} />
      </SafeAreaView>
    );
  }

  if (!email) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#007AFF" />
          <Text style={s.backText}>戻る</Text>
        </TouchableOpacity>
        <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>
          <Text style={{color:'#8E8E93'}}>メールが見つかりません</Text>
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
    <body>${email.bodyHtml || email.bodyText.replace(/\n/g,'<br>')}</body></html>
  `;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* ヘッダー */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#007AFF" />
          <Text style={s.backText}>受信トレイ</Text>
        </TouchableOpacity>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.actionBtn} onPress={handleStar}>
            <Ionicons
              name={email.isStarred ? 'star' : 'star-outline'}
              size={22}
              color={email.isStarred ? '#FF9500' : '#8E8E93'}
            />
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={22} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 件名 */}
      <View style={s.subjectArea}>
        <Text style={s.subject}>{email.subject || '（件名なし）'}</Text>
      </View>

      {/* 送信者情報 */}
      <TouchableOpacity style={s.senderCard} onPress={() => setHeaderExpanded(v => !v)} activeOpacity={0.7}>
        <View style={s.senderAvatar}>
          <Text style={s.senderAvatarText}>{senderName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={s.senderInfo}>
          <Text style={s.senderName}>{senderName}</Text>
          {headerExpanded ? (
            <View>
              <Text style={s.senderSub}>{email.from.address}</Text>
              {toList && <Text style={s.senderSub}>宛先: {toList}</Text>}
              {email.cc?.length > 0 && (
                <Text style={s.senderSub}>CC: {email.cc.map(c=>c.name||c.address).join(', ')}</Text>
              )}
            </View>
          ) : (
            <Text style={s.senderSub} numberOfLines={1}>宛先: {toList || 'あなた'}</Text>
          )}
        </View>
        <View style={s.senderRight}>
          <Text style={s.senderDate}>{formatFullDate(email.date)}</Text>
          <Ionicons
            name={headerExpanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color="#8E8E93"
          />
        </View>
      </TouchableOpacity>

      {/* テキスト/HTML切替 */}
      {email.bodyHtml && email.bodyText && (
        <View style={s.toggle}>
          <TouchableOpacity
            style={[s.toggleBtn, !showHtml && s.toggleActive]}
            onPress={() => setShowHtml(false)}
          >
            <Text style={[s.toggleText, !showHtml && s.toggleActiveText]}>テキスト</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.toggleBtn, showHtml && s.toggleActive]}
            onPress={() => setShowHtml(true)}
          >
            <Text style={[s.toggleText, showHtml && s.toggleActiveText]}>HTML</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 本文 */}
      <View style={{flex:1}}>
        {showHtml && email.bodyHtml ? (
          <WebView
            source={{ html: htmlContent }}
            style={{flex:1}}
            scrollEnabled
            showsVerticalScrollIndicator={false}
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(req) => {
              if (req.url.startsWith('about:') || req.url.startsWith('data:')) return true;
              return false;
            }}
          />
        ) : (
          <ScrollView style={s.textScroll} contentContainerStyle={{padding:16,paddingBottom:120}}>
            <Text style={s.bodyText}>{email.bodyText || '本文がありません'}</Text>
          </ScrollView>
        )}
      </View>

      {/* アクションバー */}
      <View style={s.actionBar}>
        <TouchableOpacity
          style={s.barBtn}
          onPress={() => router.push(`/compose?mode=reply&emailId=${email.id}`)}
        >
          <Ionicons name="arrow-undo-outline" size={22} color="#007AFF" />
          <Text style={s.barBtnText}>返信</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.barBtn}
          onPress={() => router.push(`/compose?mode=replyAll&emailId=${email.id}`)}
        >
          <Ionicons name="arrow-undo-outline" size={22} color="#007AFF" />
          <Text style={s.barBtnText}>全員返信</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.barBtn}
          onPress={() => router.push(`/compose?mode=forward&emailId=${email.id}`)}
        >
          <Ionicons name="arrow-redo-outline" size={22} color="#007AFF" />
          <Text style={s.barBtnText}>転送</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:'#fff' },
  header: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:8, paddingVertical:8, borderBottomWidth:0.5, borderBottomColor:'#E5E5EA' },
  backBtn: { flexDirection:'row', alignItems:'center', paddingHorizontal:4, paddingVertical:4 },
  backText: { fontSize:16, color:'#007AFF', marginLeft:2 },
  headerActions: { flexDirection:'row', alignItems:'center' },
  actionBtn: { padding:8 },
  subjectArea: { paddingHorizontal:16, paddingVertical:14, borderBottomWidth:0.5, borderBottomColor:'#F0F0F0' },
  subject: { fontSize:20, fontWeight:'700', color:'#000', lineHeight:26 },
  senderCard: { flexDirection:'row', alignItems:'flex-start', paddingHorizontal:16, paddingVertical:12, borderBottomWidth:0.5, borderBottomColor:'#F0F0F0' },
  senderAvatar: { width:40, height:40, borderRadius:20, backgroundColor:'#007AFF', justifyContent:'center', alignItems:'center', marginRight:10, flexShrink:0 },
  senderAvatarText: { color:'#fff', fontSize:17, fontWeight:'700' },
  senderInfo: { flex:1 },
  senderName: { fontSize:15, fontWeight:'600', color:'#000', marginBottom:2 },
  senderSub: { fontSize:13, color:'#8E8E93', marginTop:1 },
  senderRight: { alignItems:'flex-end', marginLeft:8 },
  senderDate: { fontSize:12, color:'#8E8E93', marginBottom:3 },
  toggle: { flexDirection:'row', margin:10, backgroundColor:'#F2F2F7', borderRadius:8, padding:2 },
  toggleBtn: { flex:1, paddingVertical:6, alignItems:'center', borderRadius:6 },
  toggleActive: { backgroundColor:'#fff', shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.1, shadowRadius:2 },
  toggleText: { fontSize:13, color:'#8E8E93', fontWeight:'500' },
  toggleActiveText: { color:'#000', fontWeight:'600' },
  textScroll: { flex:1 },
  bodyText: { fontSize:15, color:'#1c1c1e', lineHeight:22 },
  actionBar: { flexDirection:'row', borderTopWidth:0.5, borderTopColor:'#E5E5EA', paddingVertical:8, paddingHorizontal:4, backgroundColor:'#fff' },
  barBtn: { flex:1, alignItems:'center', paddingVertical:6, gap:2 },
  barBtnText: { fontSize:12, color:'#007AFF', fontWeight:'500' },
});

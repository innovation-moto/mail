import React from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAccountStore } from '../store/accountStore';
import type { Account } from '@/shared/types';

function avatarColor(email: string): string {
  const colors = ['#007AFF','#34C759','#FF9500','#FF3B30','#AF52DE','#5856D6','#FF2D55','#00C7BE'];
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % colors.length;
  return colors[h];
}

export default function SettingsScreen() {
  const router = useRouter();
  const { accounts, selectedAccountId, removeAccount, selectAccount } = useAccountStore();

  const handleRemove = (account: Account) => {
    Alert.alert('アカウントを削除', `${account.email} を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: () => removeAccount(account.id),
      },
    ]);
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#007AFF" />
          <Text style={s.backText}>戻る</Text>
        </TouchableOpacity>
        <Text style={s.title}>設定</Text>
        <View style={{width:60}} />
      </View>

      <FlatList
        data={accounts}
        keyExtractor={a => a.id}
        ListHeaderComponent={
          <Text style={s.sectionLabel}>アカウント</Text>
        }
        renderItem={({ item: account }) => (
          <View style={s.accountCard}>
            <View style={[s.avatar, { backgroundColor: avatarColor(account.email) }]}>
              <Text style={s.avatarText}>{(account.name||account.email).charAt(0).toUpperCase()}</Text>
            </View>
            <View style={s.info}>
              <Text style={s.name}>{account.name || account.email}</Text>
              <Text style={s.email}>{account.email}</Text>
              <Text style={s.provider}>{account.imapHost}</Text>
            </View>
            <View style={s.actions}>
              {account.id !== selectedAccountId && (
                <TouchableOpacity onPress={() => selectAccount(account.id)} style={s.iconBtn}>
                  <Ionicons name="checkmark-circle-outline" size={22} color="#007AFF" />
                </TouchableOpacity>
              )}
              {account.id === selectedAccountId && (
                <View style={s.activeBadge}>
                  <Text style={s.activeBadgeText}>使用中</Text>
                </View>
              )}
              <TouchableOpacity onPress={() => handleRemove(account)} style={s.iconBtn}>
                <Ionicons name="trash-outline" size={22} color="#FF3B30" />
              </TouchableOpacity>
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        ListFooterComponent={
          <TouchableOpacity style={s.addBtn} onPress={() => router.push('/setup')}>
            <Ionicons name="add-circle" size={20} color="#007AFF" style={{marginRight:8}} />
            <Text style={s.addBtnText}>アカウントを追加</Text>
          </TouchableOpacity>
        }
        contentContainerStyle={{paddingBottom:40}}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:'#F2F2F7' },
  header: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:8, paddingVertical:12, backgroundColor:'#fff', borderBottomWidth:0.5, borderBottomColor:'#E5E5EA' },
  backBtn: { flexDirection:'row', alignItems:'center', paddingHorizontal:4 },
  backText: { fontSize:16, color:'#007AFF', marginLeft:2 },
  title: { fontSize:17, fontWeight:'600', color:'#000' },
  sectionLabel: { fontSize:13, fontWeight:'600', color:'#8E8E93', paddingHorizontal:16, paddingTop:20, paddingBottom:8, textTransform:'uppercase', letterSpacing:0.4 },
  accountCard: { flexDirection:'row', alignItems:'center', backgroundColor:'#fff', paddingHorizontal:16, paddingVertical:14 },
  avatar: { width:46, height:46, borderRadius:23, justifyContent:'center', alignItems:'center', marginRight:12 },
  avatarText: { color:'#fff', fontSize:18, fontWeight:'700' },
  info: { flex:1 },
  name: { fontSize:15, fontWeight:'600', color:'#000', marginBottom:2 },
  email: { fontSize:13, color:'#3C3C43', marginBottom:1 },
  provider: { fontSize:12, color:'#8E8E93' },
  actions: { flexDirection:'row', alignItems:'center', gap:4 },
  iconBtn: { padding:6 },
  activeBadge: { backgroundColor:'#E8F5E9', paddingHorizontal:8, paddingVertical:3, borderRadius:10, marginRight:4 },
  activeBadgeText: { fontSize:12, color:'#34C759', fontWeight:'600' },
  sep: { height:0.5, backgroundColor:'#E5E5EA' },
  addBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'#fff', paddingHorizontal:16, paddingVertical:14, marginTop:20, borderTopWidth:0.5, borderBottomWidth:0.5, borderColor:'#E5E5EA' },
  addBtnText: { fontSize:15, color:'#007AFF', fontWeight:'500' },
});

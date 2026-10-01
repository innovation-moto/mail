import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ScrollView, Modal, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createFilterRule, listFilterRules } from '../lib/db';
import { mailApi } from '../lib/api';
import { useAccountStore } from '../store/accountStore';
import type { FilterCondition, Folder } from '@/shared/types';

const FIELD_LABELS: Record<FilterCondition['field'], string> = {
  from: '差出人', to: '宛先', subject: '件名', body: '本文',
};
const OP_LABELS: Record<FilterCondition['operator'], string> = {
  contains: 'を含む', equals: '完全一致', startsWith: 'で始まる', endsWith: 'で終わる',
};

export function QuickFilterSheet({
  accountId,
  folders,
  initialName = '',
  initialConditions,
  onClose,
}: {
  accountId: string;
  folders: Folder[];
  initialName?: string;
  initialConditions?: FilterCondition[];
  onClose: () => void;
}) {
  const { accounts, getPassword } = useAccountStore();
  const [name, setName] = useState(initialName);
  const [conditions, setConditions] = useState<FilterCondition[]>(
    initialConditions ?? [{ field: 'from', operator: 'contains', value: '' }]
  );
  const [conditionType, setConditionType] = useState<'all' | 'any'>('any');
  const [actionFolder, setActionFolder] = useState('');
  const [actionMarkRead, setActionMarkRead] = useState(false);
  const [actionStarred, setActionStarred] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [folderPickerVisible, setFolderPickerVisible] = useState(false);

  function updateCondition(i: number, patch: Partial<FilterCondition>) {
    setConditions(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  async function handleSave() {
    if (!accountId || conditions.some(c => !c.value.trim())) {
      Alert.alert('エラー', 'すべての条件にキーワードを入力してください');
      return;
    }
    setSaving(true);
    try {
      await createFilterRule(accountId, {
        name: name || `${conditions[0].field} ${conditions[0].operator} "${conditions[0].value}"`,
        conditions,
        conditionType,
        actionFolder: actionFolder || null,
        actionMarkRead,
        actionStarred,
        active: true,
      });
      // IMAPに同期
      const account = accounts.find(a => a.id === accountId);
      if (account) {
        const password = await getPassword(accountId);
        if (password) {
          const allRules = await listFilterRules(accountId);
          mailApi.filterPush(account, password, allRules).catch(() => {});
        }
      }
      setSaved(true);
      setTimeout(() => onClose(), 900);
    } catch (err) {
      Alert.alert('エラー', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={f.overlay} activeOpacity={1} onPress={onClose} />
      <View style={f.sheet}>
        <View style={f.handle} />

        <View style={f.header}>
          <View style={f.headerLeft}>
            <Ionicons name="funnel" size={16} color="#007AFF" style={{ marginRight: 6 }} />
            <Text style={f.headerTitle}>フィルターを作成</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={f.closeBtn}>
            <Ionicons name="close" size={18} color="#8E8E93" />
          </TouchableOpacity>
        </View>

        <ScrollView style={f.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={f.label}>ルール名</Text>
          <TextInput
            style={f.input}
            value={name}
            onChangeText={setName}
            placeholder="ルール名（省略可）"
            placeholderTextColor="#C7C7CC"
          />

          <View style={f.condHeader}>
            <Text style={f.label}>条件</Text>
            <View style={f.segWrap}>
              {(['any', 'all'] as const).map(v => (
                <TouchableOpacity
                  key={v}
                  style={[f.seg, conditionType === v && f.segActive]}
                  onPress={() => setConditionType(v)}
                >
                  <Text style={[f.segText, conditionType === v && f.segActiveText]}>
                    {v === 'any' ? 'いずれか (OR)' : 'すべて (AND)'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {conditions.map((c, i) => (
            <View key={i} style={f.condRow}>
              <View style={f.pickerWrap}>
                {(Object.keys(FIELD_LABELS) as FilterCondition['field'][]).map(k => (
                  <TouchableOpacity
                    key={k}
                    style={[f.chip, c.field === k && f.chipActive]}
                    onPress={() => updateCondition(i, { field: k })}
                  >
                    <Text style={[f.chipText, c.field === k && f.chipActiveText]}>{FIELD_LABELS[k]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={f.pickerWrap}>
                {(Object.keys(OP_LABELS) as FilterCondition['operator'][]).map(k => (
                  <TouchableOpacity
                    key={k}
                    style={[f.chip, c.operator === k && f.chipActive]}
                    onPress={() => updateCondition(i, { operator: k })}
                  >
                    <Text style={[f.chipText, c.operator === k && f.chipActiveText]}>{OP_LABELS[k]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={f.condValueRow}>
                <TextInput
                  style={[f.input, { flex: 1, marginBottom: 0 }]}
                  value={c.value}
                  onChangeText={v => updateCondition(i, { value: v })}
                  placeholder="値を入力"
                  placeholderTextColor="#C7C7CC"
                  autoCapitalize="none"
                />
                {conditions.length > 1 && (
                  <TouchableOpacity
                    onPress={() => setConditions(prev => prev.filter((_, idx) => idx !== i))}
                    style={f.removeBtn}
                  >
                    <Ionicons name="close-circle" size={20} color="#FF3B30" />
                  </TouchableOpacity>
                )}
              </View>
              {i < conditions.length - 1 && <View style={f.condSep} />}
            </View>
          ))}

          <TouchableOpacity
            style={f.addCondBtn}
            onPress={() => setConditions(prev => [...prev, { field: 'from', operator: 'contains', value: '' }])}
          >
            <Ionicons name="add-circle-outline" size={15} color="#007AFF" style={{ marginRight: 4 }} />
            <Text style={f.addCondText}>条件を追加</Text>
          </TouchableOpacity>

          <Text style={[f.label, { marginTop: 16 }]}>アクション</Text>
          <View style={f.actionCard}>
            <Text style={f.actionLabel}>フォルダへ移動</Text>
            <TouchableOpacity style={f.folderPicker} onPress={() => setFolderPickerVisible(true)}>
              <Ionicons name="folder-outline" size={16} color="#8E8E93" style={{ marginRight: 8 }} />
              <Text style={[f.folderPickerText, !actionFolder && { color: '#C7C7CC' }]}>
                {actionFolder ? (folders.find(fold => fold.path === actionFolder)?.name || actionFolder) : '移動しない'}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#C7C7CC" />
            </TouchableOpacity>

            <Modal visible={folderPickerVisible} transparent animationType="fade" onRequestClose={() => setFolderPickerVisible(false)}>
              <TouchableOpacity style={f.pickerOverlay} activeOpacity={1} onPress={() => setFolderPickerVisible(false)}>
                <View style={f.pickerModal}>
                  <View style={f.pickerModalHeader}>
                    <Text style={f.pickerModalTitle}>フォルダを選択</Text>
                    <TouchableOpacity onPress={() => setFolderPickerVisible(false)}>
                      <Ionicons name="close" size={20} color="#8E8E93" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView bounces={false}>
                    <TouchableOpacity style={f.pickerItem} onPress={() => { setActionFolder(''); setFolderPickerVisible(false); }}>
                      <Ionicons name="ban-outline" size={18} color="#8E8E93" style={{ marginRight: 12 }} />
                      <Text style={[f.pickerItemText, !actionFolder && { fontWeight: '600', color: '#007AFF' }]}>移動しない</Text>
                      {!actionFolder && <Ionicons name="checkmark" size={16} color="#007AFF" />}
                    </TouchableOpacity>
                    <View style={{ height: 0.5, backgroundColor: '#F0F0F0', marginLeft: 46 }} />
                    {folders.map((fold, i) => (
                      <View key={fold.path}>
                        <TouchableOpacity style={f.pickerItem} onPress={() => { setActionFolder(fold.path); setFolderPickerVisible(false); }}>
                          <Ionicons name="folder-outline" size={18} color="#6366f1" style={{ marginRight: 12 }} />
                          <Text style={[f.pickerItemText, actionFolder === fold.path && { fontWeight: '600', color: '#007AFF' }]}>
                            {fold.name || fold.path}
                          </Text>
                          {actionFolder === fold.path && <Ionicons name="checkmark" size={16} color="#007AFF" />}
                        </TouchableOpacity>
                        {i < folders.length - 1 && <View style={{ height: 0.5, backgroundColor: '#F0F0F0', marginLeft: 46 }} />}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>

            <TouchableOpacity style={f.toggle} onPress={() => setActionMarkRead(v => !v)}>
              <View style={[f.checkbox, actionMarkRead && f.checkboxChecked]}>
                {actionMarkRead && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <Text style={f.toggleText}>既読にする</Text>
            </TouchableOpacity>

            <TouchableOpacity style={f.toggle} onPress={() => setActionStarred(v => !v)}>
              <View style={[f.checkbox, actionStarred && f.checkboxChecked]}>
                {actionStarred && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <Text style={f.toggleText}>スターを付ける</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View style={f.footer}>
          <TouchableOpacity style={f.cancelBtn} onPress={onClose}>
            <Text style={f.cancelText}>キャンセル</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[f.saveBtn, (saving || saved) && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving || saved}
          >
            {saving && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
            <Text style={f.saveText}>{saved ? '✓ 保存しました' : '保存'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const f = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    maxHeight: '88%', paddingBottom: 34,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D1D1D6', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: 16 },
  label: { fontSize: 11, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, color: '#000', marginBottom: 8, backgroundColor: '#FAFAFA',
  },
  condHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  segWrap: { flexDirection: 'row', backgroundColor: '#F2F2F7', borderRadius: 8, padding: 2 },
  seg: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  segActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  segText: { fontSize: 11, color: '#8E8E93', fontWeight: '500' },
  segActiveText: { color: '#000', fontWeight: '600' },
  condRow: { backgroundColor: '#F9F9F9', borderRadius: 10, padding: 10, marginBottom: 8 },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#F0F0F5', borderWidth: 1, borderColor: '#E5E5EA' },
  chipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  chipText: { fontSize: 12, color: '#3C3C43', fontWeight: '500' },
  chipActiveText: { color: '#fff', fontWeight: '600' },
  condValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeBtn: { padding: 2 },
  condSep: { height: 0.5, backgroundColor: '#E5E5EA', marginVertical: 8 },
  addCondBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  addCondText: { fontSize: 14, color: '#007AFF', fontWeight: '500' },
  actionCard: { backgroundColor: '#F9F9F9', borderRadius: 10, padding: 12, marginBottom: 12 },
  actionLabel: { fontSize: 12, color: '#8E8E93', fontWeight: '500', marginBottom: 6 },
  folderPicker: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10,
    backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 11, marginBottom: 10,
  },
  folderPickerText: { flex: 1, fontSize: 14, color: '#000' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerModal: {
    backgroundColor: '#fff', borderRadius: 14, width: '100%', maxHeight: 400,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 12,
  },
  pickerModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  pickerModalTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  pickerItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  pickerItemText: { flex: 1, fontSize: 15, color: '#1C1C1E' },
  toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: '#C7C7CC', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  checkboxChecked: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  toggleText: { fontSize: 14, color: '#1C1C1E' },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#F0F0F0' },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center' },
  cancelText: { fontSize: 15, color: '#3C3C43', fontWeight: '500' },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#007AFF', alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  saveText: { fontSize: 15, color: '#fff', fontWeight: '600' },
});

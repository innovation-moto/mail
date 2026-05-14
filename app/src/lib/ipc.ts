import { supabase } from './supabase';
import type {
  AccountConfig,
  ComposeData,
  AiTone,
  CalendarEvent,
  Settings,
  FilterRule,
  Signature,
} from '@/types/shared';

export const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;

export function getAPI() {
  if (!isElectron) throw new Error('Not in Electron');
  return window.electronAPI;
}

// Web用：Supabaseセッショントークンを取得してAPIリクエスト
async function webFetch(path: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ElectronとWebで共通のAPIインターフェース
export const api = {
  accounts: {
    list: () => isElectron
      ? getAPI().accounts.list()
      : webFetch('/api/accounts'),
    create: (config: AccountConfig) => isElectron
      ? getAPI().accounts.create(config)
      : webFetch('/api/accounts', { method: 'POST', body: JSON.stringify(config) }),
    update: (id: string, config: Partial<AccountConfig>) => isElectron
      ? getAPI().accounts.update(id, config)
      : webFetch(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(config) }),
    delete: (id: string) => isElectron
      ? getAPI().accounts.delete(id)
      : webFetch(`/api/accounts/${id}`, { method: 'DELETE' }),
    test: (config: AccountConfig) => isElectron
      ? getAPI().accounts.test(config)
      : Promise.resolve({ imap: true, smtp: true }), // Web版ではアカウント追加時に自動テスト
    connectMicrosoft: (name: string) => isElectron
      ? getAPI().accounts.connectMicrosoft(name)
      : Promise.reject(new Error('Web版では未対応')),
  },
  mail: {
    fetchFolders: (accountId: string) => isElectron
      ? getAPI().mail.fetchFolders(accountId)
      : webFetch(`/api/mail/folders?accountId=${accountId}`),
    fetchEmails: (accountId: string, folder: string, limit = 50, offset = 0) => isElectron
      ? getAPI().mail.fetchEmails(accountId, folder, limit, offset)
      : webFetch(`/api/mail/emails?accountId=${accountId}&folder=${encodeURIComponent(folder)}&limit=${limit}&offset=${offset}`),
    fetchEmail: (emailId: string) => isElectron
      ? getAPI().mail.fetchEmail(emailId)
      : webFetch(`/api/mail/email?emailId=${encodeURIComponent(emailId)}`),
    sync: (accountId: string, folder?: string) => isElectron
      ? getAPI().mail.sync(accountId, folder)
      : webFetch('/api/mail/sync', { method: 'POST', body: JSON.stringify({ accountId, folder: folder || 'INBOX' }) }),
    send: (data: ComposeData) => isElectron
      ? getAPI().mail.send(data)
      : webFetch('/api/mail/send', { method: 'POST', body: JSON.stringify(data) }),
    markRead: (emailId: string, isRead: boolean) => isElectron
      ? getAPI().mail.markRead(emailId, isRead)
      : webFetch('/api/mail/flags', { method: 'POST', body: JSON.stringify({ action: 'markRead', emailId, value: isRead }) }),
    markAllRead: (accountId: string, folder: string) => isElectron
      ? getAPI().mail.markAllRead(accountId, folder)
      : webFetch('/api/mail/flags', { method: 'POST', body: JSON.stringify({ action: 'markAllRead', accountId, folder }) }),
    star: (emailId: string, isStarred: boolean) => isElectron
      ? getAPI().mail.star(emailId, isStarred)
      : webFetch('/api/mail/flags', { method: 'POST', body: JSON.stringify({ action: 'star', emailId, value: isStarred }) }),
    pin: (emailId: string, isPinned: boolean) => isElectron
      ? getAPI().mail.pin(emailId, isPinned)
      : webFetch('/api/mail/flags', { method: 'POST', body: JSON.stringify({ action: 'pin', emailId, value: isPinned }) }),
    delete: (emailId: string) => isElectron
      ? getAPI().mail.delete(emailId)
      : webFetch('/api/mail/flags', { method: 'POST', body: JSON.stringify({ action: 'delete', emailId }) }),
    move: (emailId: string, folder: string) => isElectron
      ? getAPI().mail.move(emailId, folder)
      : webFetch('/api/mail/flags', { method: 'POST', body: JSON.stringify({ action: 'move', emailId, folder }) }),
    search: (accountId: string, query: string) => isElectron
      ? getAPI().mail.search(accountId, query)
      : webFetch(`/api/mail/search?accountId=${accountId}&query=${encodeURIComponent(query)}`),
    getUnreadCounts: (accountId: string) => isElectron
      ? getAPI().mail.getUnreadCounts(accountId)
      : webFetch(`/api/mail/unreadCounts?accountId=${accountId}`),
    fetchAttachments: (emailId: string) => isElectron
      ? getAPI().mail.fetchAttachments(emailId)
      : Promise.resolve(null),
    markSpam: (emailId: string) => isElectron
      ? getAPI().mail.markSpam(emailId)
      : webFetch('/api/mail/flags', { method: 'POST', body: JSON.stringify({ action: 'move', emailId, folder: '[Gmail]/Spam' }) }),
    downloadAttachment: (attachmentId: string) => isElectron
      ? getAPI().mail.downloadAttachment(attachmentId)
      : Promise.resolve(null),
  },
  ai: {
    generateReply: (emailId: string, tone: AiTone) => isElectron
      ? getAPI().ai.generateReply(emailId, tone)
      : webFetch('/api/ai/generate-reply', { method: 'POST', body: JSON.stringify({ emailId, tone }) }).then((r) => r.reply as string),
    summarize: (emailId: string) => isElectron
      ? getAPI().ai.summarize(emailId)
      : webFetch('/api/ai/summarize', { method: 'POST', body: JSON.stringify({ emailId }) }),
    classify: (emailId: string) => isElectron
      ? getAPI().ai.classify(emailId)
      : webFetch('/api/ai/classify', { method: 'POST', body: JSON.stringify({ emailId }) }),
    smartSearch: (accountId: string, query: string) => isElectron
      ? getAPI().ai.smartSearch(accountId, query)
      : Promise.reject(new Error('スマート検索はWeb版では未対応です')),
    detectCalendarEvent: (emailId: string) => isElectron
      ? getAPI().ai.detectCalendarEvent(emailId)
      : webFetch('/api/ai/detect-calendar', { method: 'POST', body: JSON.stringify({ emailId }) }).then((r) => r.event ?? null),
    openCalendarEvent: (event: CalendarEvent) => isElectron
      ? getAPI().ai.openCalendarEvent(event)
      : Promise.resolve(null),
    setApiKey: (key: string) => isElectron
      ? getAPI().ai.setApiKey(key)
      : Promise.resolve(null),
    getApiKey: () => isElectron
      ? getAPI().ai.getApiKey()
      : Promise.resolve(''),
    isEnabled: () => isElectron
      ? getAPI().ai.isEnabled()
      : Promise.resolve(true),
  },
  blocklist: {
    list: (accountId: string) => isElectron
      ? getAPI().blocklist.list(accountId)
      : Promise.resolve([]),
    add: (accountId: string, pattern: string, type: 'address' | 'domain') => isElectron
      ? getAPI().blocklist.add(accountId, pattern, type)
      : Promise.resolve(null),
    remove: (id: string, accountId: string) => isElectron
      ? getAPI().blocklist.remove(id, accountId)
      : Promise.resolve(null),
  },
  settings: {
    get: () => isElectron
      ? getAPI().settings.get()
      : webFetch('/api/settings'),
    set: (key: string, value: string) => isElectron
      ? getAPI().settings.set(key, value)
      : webFetch('/api/settings', { method: 'POST', body: JSON.stringify({ [key]: value }) }),
    setAll: (settings: Partial<Settings>) => isElectron
      ? getAPI().settings.setAll(settings)
      : webFetch('/api/settings', { method: 'POST', body: JSON.stringify(settings) }),
  },
  filters: {
    list: (accountId: string) => isElectron
      ? getAPI().filters.list(accountId)
      : Promise.resolve([]),
    create: (accountId: string, data: Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>) => isElectron
      ? getAPI().filters.create(accountId, data)
      : Promise.resolve(null),
    update: (id: string, data: Partial<Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>>) => isElectron
      ? getAPI().filters.update(id, data)
      : Promise.resolve(null),
    delete: (id: string) => isElectron
      ? getAPI().filters.delete(id)
      : Promise.resolve(null),
  },
  folders: {
    create: (accountId: string, path: string) => isElectron
      ? getAPI().folders.create(accountId, path)
      : Promise.resolve(null),
    delete: (accountId: string, path: string) => isElectron
      ? getAPI().folders.delete(accountId, path)
      : Promise.resolve(null),
  },
  signatures: {
    list: (accountId?: string) => isElectron
      ? getAPI().signatures.list(accountId)
      : Promise.resolve([]),
    getDefault: (accountId: string) => isElectron
      ? getAPI().signatures.getDefault(accountId)
      : Promise.resolve(null),
    create: (data: Omit<Signature, 'id' | 'createdAt'>) => isElectron
      ? getAPI().signatures.create(data)
      : Promise.resolve(null),
    update: (id: string, data: Partial<Omit<Signature, 'id' | 'createdAt'>>) => isElectron
      ? getAPI().signatures.update(id, data)
      : Promise.resolve(null),
    delete: (id: string) => isElectron
      ? getAPI().signatures.delete(id)
      : Promise.resolve(null),
  },
  on(channel: string, callback: (...args: unknown[]) => void) {
    if (isElectron) return getAPI().on(channel, callback);
    return () => {}; // Web版ではno-op
  },
};

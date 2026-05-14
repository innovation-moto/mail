import type {
  Account,
  AccountConfig,
  Email,
  Folder,
  ComposeData,
  BlockEntry,
  Settings,
  TestConnectionResult,
  AiTone,
  AiClassifyResult,
  AiSummarizeResult,
  SmartSearchResult,
  SyncResult,
  FilterRule,
  CalendarEvent,
  Signature,
} from '@/types/shared';

interface ElectronAPI {
  accounts: {
    list: () => Promise<Account[]>;
    create: (config: AccountConfig) => Promise<Account>;
    update: (id: string, config: Partial<AccountConfig>) => Promise<Account>;
    delete: (id: string) => Promise<void>;
    test: (config: AccountConfig) => Promise<TestConnectionResult>;
    connectMicrosoft: (name: string) => Promise<Account>;
  };
  mail: {
    fetchFolders: (accountId: string) => Promise<Folder[]>;
    fetchEmails: (accountId: string, folder: string, limit?: number, offset?: number) => Promise<Email[]>;
    fetchEmail: (emailId: string) => Promise<Email | null>;
    sync: (accountId: string, folder?: string) => Promise<SyncResult>;
    send: (data: ComposeData) => Promise<void>;
    markRead: (emailId: string, isRead: boolean) => Promise<void>;
    markAllRead: (accountId: string, folder: string) => Promise<void>;
    star: (emailId: string, isStarred: boolean) => Promise<void>;
    pin: (emailId: string, isPinned: boolean) => Promise<void>;
    delete: (emailId: string) => Promise<void>;
    move: (emailId: string, folder: string) => Promise<void>;
    search: (accountId: string, query: string) => Promise<Email[]>;
    getUnreadCounts: (accountId: string) => Promise<Record<string, number>>;
    fetchAttachments: (emailId: string) => Promise<Email | null>;
    markSpam: (emailId: string) => Promise<string>;
    downloadAttachment: (attachmentId: string) => Promise<string | null>;
  };
  ai: {
    detectCalendarEvent: (emailId: string) => Promise<CalendarEvent | null>;
    openCalendarEvent: (event: CalendarEvent) => Promise<void>;
    generateReply: (emailId: string, tone: AiTone) => Promise<string>;
    summarize: (emailId: string) => Promise<AiSummarizeResult>;
    classify: (emailId: string) => Promise<AiClassifyResult>;
    smartSearch: (accountId: string, query: string) => Promise<SmartSearchResult>;
    setApiKey: (apiKey: string) => Promise<void>;
    getApiKey: () => Promise<string>;
    isEnabled: () => Promise<boolean>;
  };
  blocklist: {
    list: (accountId: string) => Promise<BlockEntry[]>;
    add: (accountId: string, pattern: string, type: 'address' | 'domain') => Promise<BlockEntry[]>;
    remove: (id: string, accountId: string) => Promise<BlockEntry[]>;
  };
  settings: {
    get: () => Promise<Settings>;
    set: (key: string, value: string) => Promise<Settings>;
    setAll: (settings: Partial<Settings>) => Promise<Settings>;
  };
  filters: {
    list: (accountId: string) => Promise<FilterRule[]>;
    create: (accountId: string, data: Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>) => Promise<FilterRule>;
    update: (id: string, data: Partial<Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>>) => Promise<FilterRule>;
    delete: (id: string) => Promise<void>;
  };
  folders: {
    create: (accountId: string, path: string) => Promise<void>;
    delete: (accountId: string, path: string) => Promise<void>;
  };
  signatures: {
    list: (accountId?: string) => Promise<Signature[]>;
    getDefault: (accountId: string) => Promise<Signature | null>;
    create: (data: Omit<Signature, 'id' | 'createdAt'>) => Promise<Signature[]>;
    update: (id: string, data: Partial<Omit<Signature, 'id' | 'createdAt'>>) => Promise<Signature[]>;
    delete: (id: string) => Promise<Signature[]>;
  };
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};

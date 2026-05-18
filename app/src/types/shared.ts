export interface FilterCondition {
  field: 'from' | 'to' | 'subject' | 'body';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith';
  value: string;
}

export interface FilterRule {
  id: string;
  accountId: string;
  name: string;
  conditions: FilterCondition[];
  conditionType: 'all' | 'any';
  actionFolder: string | null;
  actionMarkRead: boolean;
  actionStarred: boolean;
  active: boolean;
  createdAt: number;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  avatar?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  oauthExpiresAt?: number;
  createdAt: number;
}

export interface AccountConfig {
  name: string;
  email: string;
  password: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export interface EmailAddress {
  name: string;
  address: string;
}

export interface Attachment {
  id: string;
  emailId: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface Email {
  id: string;
  accountId: string;
  uid: number;
  messageId: string;
  folder: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  hasAttachments: boolean;
  aiCategory: string | null;
  aiPriority: 'high' | 'medium' | 'low' | null;
  aiSummary: string | null;
  aiActions: string[] | null;
  threadId: string | null;
  attachments: Attachment[];
}

export interface Folder {
  path: string;
  name: string;
  delimiter: string;
  flags: string[];
  specialUse: string | null;
  unreadCount: number;
}

export interface ComposeData {
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyToMessageId?: string;
  forwardFrom?: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}

export interface BlockEntry {
  id: string;
  accountId: string;
  pattern: string;
  type: 'address' | 'domain';
  createdAt: number;
}

export interface ThreadSummary {
  threadId: string;
  subject: string;
  latestFrom: { name: string; address: string };
  latestDate: number;
  emailCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  latestEmailId: string;
  aiPriority: string | null;
  folder: string;
}

export interface Signature {
  id: string;
  accountId: string | null;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: number;
}

export interface Settings {
  aiEnabled: boolean;
  geminiApiKey: string;
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  notifyHighOnly: boolean;
  syncIntervalSec: number;
}

export type AiTone = 'polite' | 'casual' | 'brief';
export type AiCategory = 'important' | 'task' | 'info' | 'newsletter' | 'promotion' | 'other';
export type AiPriority = 'high' | 'medium' | 'low';

export interface AiClassifyResult {
  category: AiCategory;
  priority: AiPriority;
}

export interface AiSummarizeResult {
  summary: string;
  actions: string[];
}

export interface SmartSearchResult {
  emails: Email[];
  answer: string;
}

export interface SyncResult {
  added: number;
  updated: number;
}

export interface CalendarEvent {
  title: string;
  startDate: string;
  endDate: string;
  location: string;
  isOnline: boolean;
  description: string;
}

export interface TestConnectionResult {
  imap: boolean;
  smtp: boolean;
  imapError?: string;
  smtpError?: string;
}

export const PROVIDER_PRESETS: Record<string, Partial<AccountConfig>> = {
  gmail: {
    provider: 'gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  outlook: {
    provider: 'outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  yahoo: {
    provider: 'yahoo',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  custom: {
    provider: 'custom',
    imapPort: 993,
    imapSecure: true,
    smtpPort: 587,
    smtpSecure: false,
  },
};

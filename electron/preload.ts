import { contextBridge, ipcRenderer } from 'electron';

const api = {
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    create: (config: unknown) => ipcRenderer.invoke('accounts:create', config),
    update: (id: string, config: unknown) => ipcRenderer.invoke('accounts:update', id, config),
    delete: (id: string) => ipcRenderer.invoke('accounts:delete', id),
    connectMicrosoft: (name: string) => ipcRenderer.invoke('accounts:connectMicrosoft', name),
    test: (config: unknown) => ipcRenderer.invoke('accounts:test', config),
  },
  mail: {
    fetchFolders: (accountId: string) => ipcRenderer.invoke('mail:fetchFolders', accountId),
    fetchEmails: (accountId: string, folder: string, limit?: number, offset?: number) =>
      ipcRenderer.invoke('mail:fetchEmails', accountId, folder, limit, offset),
    fetchEmail: (emailId: string) => ipcRenderer.invoke('mail:fetchEmail', emailId),
    sync: (accountId: string, folder?: string) => ipcRenderer.invoke('mail:sync', accountId, folder),
    send: (data: unknown) => ipcRenderer.invoke('mail:send', data),
    markRead: (emailId: string, isRead: boolean) => ipcRenderer.invoke('mail:markRead', emailId, isRead),
    markAllRead: (accountId: string, folder: string) => ipcRenderer.invoke('mail:markAllRead', accountId, folder),
    star: (emailId: string, isStarred: boolean) => ipcRenderer.invoke('mail:star', emailId, isStarred),
    pin: (emailId: string, isPinned: boolean) => ipcRenderer.invoke('mail:pin', emailId, isPinned),
    delete: (emailId: string) => ipcRenderer.invoke('mail:delete', emailId),
    move: (emailId: string, folder: string) => ipcRenderer.invoke('mail:move', emailId, folder),
    search: (accountId: string, query: string) => ipcRenderer.invoke('mail:search', accountId, query),
    getUnreadCounts: (accountId: string) => ipcRenderer.invoke('mail:getUnreadCounts', accountId),
    fetchAttachments: (emailId: string) => ipcRenderer.invoke('mail:fetchAttachments', emailId),
    markSpam: (emailId: string) => ipcRenderer.invoke('mail:markSpam', emailId),
    downloadAttachment: (attachmentId: string) => ipcRenderer.invoke('mail:downloadAttachment', attachmentId),
  },
  ai: {
    generateReply: (emailId: string, tone: string) => ipcRenderer.invoke('ai:generateReply', emailId, tone),
    summarize: (emailId: string) => ipcRenderer.invoke('ai:summarize', emailId),
    classify: (emailId: string) => ipcRenderer.invoke('ai:classify', emailId),
    smartSearch: (accountId: string, query: string) => ipcRenderer.invoke('ai:smartSearch', accountId, query),
    detectCalendarEvent: (emailId: string) => ipcRenderer.invoke('ai:detectCalendarEvent', emailId),
    openCalendarEvent: (event: unknown) => ipcRenderer.invoke('ai:openCalendarEvent', event),
    setApiKey: (apiKey: string) => ipcRenderer.invoke('ai:setApiKey', apiKey),
    getApiKey: () => ipcRenderer.invoke('ai:getApiKey'),
    isEnabled: () => ipcRenderer.invoke('ai:isEnabled'),
  },
  blocklist: {
    list: (accountId: string) => ipcRenderer.invoke('blocklist:list', accountId),
    add: (accountId: string, pattern: string, type: 'address' | 'domain') =>
      ipcRenderer.invoke('blocklist:add', accountId, pattern, type),
    remove: (id: string, accountId: string) => ipcRenderer.invoke('blocklist:remove', id, accountId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    setAll: (settings: unknown) => ipcRenderer.invoke('settings:setAll', settings),
  },
  filters: {
    list: (accountId: string) => ipcRenderer.invoke('filters:list', accountId),
    create: (accountId: string, data: unknown) => ipcRenderer.invoke('filters:create', accountId, data),
    update: (id: string, data: unknown) => ipcRenderer.invoke('filters:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('filters:delete', id),
  },
  folders: {
    create: (accountId: string, path: string) => ipcRenderer.invoke('folders:create', accountId, path),
    delete: (accountId: string, path: string) => ipcRenderer.invoke('folders:delete', accountId, path),
  },
  signatures: {
    list: (accountId?: string) => ipcRenderer.invoke('signatures:list', accountId),
    getDefault: (accountId: string) => ipcRenderer.invoke('signatures:getDefault', accountId),
    create: (data: unknown) => ipcRenderer.invoke('signatures:create', data),
    update: (id: string, data: unknown) => ipcRenderer.invoke('signatures:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('signatures:delete', id),
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_: unknown, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  favicon: {
    get: (domain: string, senderName?: string) => ipcRenderer.invoke('favicon:get', domain, senderName),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;

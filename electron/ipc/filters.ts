import { ipcMain, safeStorage } from 'electron';
import { FilterRule } from '../../shared/types';
import { listFilters, createFilter, updateFilter, deleteFilter } from '../db/queries/filters';
import { getAccount, getEncryptedPassword } from '../db/queries/accounts';
import { createFolder, deleteFolder, fetchFolders } from '../services/imap';

function getPassword(accountId: string): string {
  const enc = getEncryptedPassword(accountId);
  if (!enc) throw new Error('パスワードが見つかりません');
  return safeStorage.decryptString(enc);
}

export function registerFilterHandlers(): void {
  ipcMain.handle('filters:list', (_e, accountId: string) => {
    return listFilters(accountId);
  });

  ipcMain.handle('filters:create', (_e, accountId: string, data: Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>) => {
    return createFilter(accountId, data);
  });

  ipcMain.handle('filters:update', (_e, id: string, data: Partial<FilterRule>) => {
    updateFilter(id, data);
  });

  ipcMain.handle('filters:delete', (_e, id: string) => {
    deleteFilter(id);
  });

  ipcMain.handle('folders:create', async (_e, accountId: string, folderPath: string) => {
    const account = getAccount(accountId);
    if (!account) throw new Error('アカウントが見つかりません');
    const password = getPassword(accountId);
    await createFolder(account, password, folderPath);
  });

  ipcMain.handle('folders:delete', async (_e, accountId: string, folderPath: string) => {
    const account = getAccount(accountId);
    if (!account) throw new Error('アカウントが見つかりません');
    const password = getPassword(accountId);
    await deleteFolder(account, password, folderPath);
  });
}

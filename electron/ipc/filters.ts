import { ipcMain, safeStorage } from 'electron';
import { FilterRule } from '../../shared/types';
import { listFilters, createFilter, updateFilter, deleteFilter, getFilterAccountId } from '../db/queries/filters';
import { getAccount, getEncryptedPassword } from '../db/queries/accounts';
import { createFolder, deleteFolder, fetchFolders } from '../services/imap';
import { pushFilterRulesToImap } from '../services/filterSync';

function getPassword(accountId: string): string {
  const enc = getEncryptedPassword(accountId);
  if (!enc) throw new Error('パスワードが見つかりません');
  return safeStorage.decryptString(enc);
}

/** フィルタールール変更後にIMAPへ非同期push */
function pushAfterChange(accountId: string): void {
  const account = getAccount(accountId);
  if (!account) return;
  let password: string;
  try { password = getPassword(accountId); } catch { return; }
  const rules = listFilters(accountId);
  pushFilterRulesToImap(account, password, rules).catch((e) => {
    console.warn('[filterSync] push failed:', (e as Error).message);
  });
}

export function registerFilterHandlers(): void {
  ipcMain.handle('filters:list', (_e, accountId: string) => {
    return listFilters(accountId);
  });

  ipcMain.handle('filters:create', (_e, accountId: string, data: Omit<FilterRule, 'id' | 'accountId' | 'createdAt'>) => {
    const rule = createFilter(accountId, data);
    pushAfterChange(accountId);
    return rule;
  });

  ipcMain.handle('filters:update', (_e, id: string, data: Partial<FilterRule>) => {
    const accountId = getFilterAccountId(id);
    updateFilter(id, data);
    if (accountId) pushAfterChange(accountId);
  });

  ipcMain.handle('filters:delete', (_e, id: string) => {
    const accountId = getFilterAccountId(id);
    deleteFilter(id);
    if (accountId) pushAfterChange(accountId);
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

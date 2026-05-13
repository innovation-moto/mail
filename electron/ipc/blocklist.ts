import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { listBlocklist, addBlockEntry, removeBlockEntry } from '../db/queries/blocklist';

export function registerBlocklistHandlers(): void {
  ipcMain.handle('blocklist:list', (_e, accountId: string) => {
    return listBlocklist(accountId);
  });

  ipcMain.handle('blocklist:add', (_e, accountId: string, pattern: string, type: 'address' | 'domain') => {
    const id = uuidv4();
    addBlockEntry(id, accountId, pattern, type);
    return listBlocklist(accountId);
  });

  ipcMain.handle('blocklist:remove', (_e, id: string, accountId: string) => {
    removeBlockEntry(id);
    return listBlocklist(accountId);
  });
}

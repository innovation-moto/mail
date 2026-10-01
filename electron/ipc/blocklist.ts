import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { listBlocklist, addBlockEntry, removeBlockEntry } from '../db/queries/blocklist';
import { getDb } from '../db/index';

function moveExistingEmailsToTrash(accountId: string, pattern: string, type: 'address' | 'domain'): void {
  const db = getDb();
  const addr = pattern.toLowerCase();
  if (type === 'address') {
    db.prepare(`
      UPDATE emails SET folder = 'Trash', is_read = 1
      WHERE account_id = ? AND lower(from_address) = ? AND folder != 'Trash'
    `).run(accountId, addr);
  } else {
    db.prepare(`
      UPDATE emails SET folder = 'Trash', is_read = 1
      WHERE account_id = ? AND lower(from_address) LIKE ? AND folder != 'Trash'
    `).run(accountId, `%@${addr}`);
  }
}

export function registerBlocklistHandlers(): void {
  ipcMain.handle('blocklist:list', (_e, accountId: string) => {
    return listBlocklist(accountId);
  });

  ipcMain.handle('blocklist:add', (_e, accountId: string, pattern: string, type: 'address' | 'domain') => {
    const id = uuidv4();
    addBlockEntry(id, accountId, pattern, type);
    moveExistingEmailsToTrash(accountId, pattern, type);
    return listBlocklist(accountId);
  });

  ipcMain.handle('blocklist:remove', (_e, id: string, accountId: string) => {
    removeBlockEntry(id);
    return listBlocklist(accountId);
  });
}

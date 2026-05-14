import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { listSignatures, getDefaultSignature, insertSignature, updateSignature, deleteSignature, Signature } from '../db/queries/signatures';

export function registerSignatureHandlers(): void {
  ipcMain.handle('signatures:list', (_e, accountId?: string) => listSignatures(accountId));
  ipcMain.handle('signatures:getDefault', (_e, accountId: string) => getDefaultSignature(accountId));
  ipcMain.handle('signatures:create', (_e, data: Omit<Signature, 'id' | 'createdAt'>) => {
    const id = uuidv4();
    insertSignature(id, data);
    return listSignatures();
  });
  ipcMain.handle('signatures:update', (_e, id: string, data: Partial<Omit<Signature, 'id' | 'createdAt'>>) => {
    updateSignature(id, data);
    return listSignatures();
  });
  ipcMain.handle('signatures:delete', (_e, id: string) => {
    deleteSignature(id);
    return listSignatures();
  });
}

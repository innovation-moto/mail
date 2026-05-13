import { ipcMain, safeStorage } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { AccountConfig, TestConnectionResult } from '../../shared/types';
import {
  listAccounts,
  insertAccount,
  updateAccount,
  deleteAccount,
  getEncryptedPassword,
} from '../db/queries/accounts';
import { testImapConnection } from '../services/imap';
import { testSmtpConnection } from '../services/smtp';

export function registerAccountHandlers(): void {
  ipcMain.handle('accounts:list', () => listAccounts());

  ipcMain.handle('accounts:create', async (_e, config: AccountConfig) => {
    const encrypted = safeStorage.encryptString(config.password);
    const id = uuidv4();
    insertAccount(id, {
      name: config.name,
      email: config.email,
      provider: config.provider,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapSecure: config.imapSecure,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpSecure: config.smtpSecure,
    }, encrypted);
    return listAccounts().find((a) => a.id === id);
  });

  ipcMain.handle('accounts:update', async (_e, id: string, config: Partial<AccountConfig>) => {
    const encPwd = config.password ? safeStorage.encryptString(config.password) : undefined;
    updateAccount(id, {
      name: config.name,
      email: config.email,
      provider: config.provider,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapSecure: config.imapSecure,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpSecure: config.smtpSecure,
    }, encPwd);
    return listAccounts().find((a) => a.id === id);
  });

  ipcMain.handle('accounts:delete', (_e, id: string) => {
    deleteAccount(id);
  });

  ipcMain.handle('accounts:test', async (_e, config: AccountConfig): Promise<TestConnectionResult> => {
    const [imapResult, smtpResult] = await Promise.all([
      testImapConnection(config.imapHost, config.imapPort, config.imapSecure, config.email, config.password),
      testSmtpConnection(config.smtpHost, config.smtpPort, config.smtpSecure, config.email, config.password),
    ]);
    return {
      imap: imapResult.ok,
      smtp: smtpResult.ok,
      imapError: imapResult.error,
      smtpError: smtpResult.error,
    };
  });
}

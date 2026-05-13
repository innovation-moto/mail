import { ipcMain, safeStorage } from 'electron';
import { AiTone } from '../../shared/types';
import { getEmail, updateAiFields, getRecentEmailsForSearch } from '../db/queries/emails';
import { getSetting, setSetting } from '../db/queries/settings';
import { initGemini, generateReply, summarizeEmail, classifyEmail, smartSearch } from '../services/gemini';

function ensureAiEnabled(): void {
  const enabled = getSetting('ai_enabled');
  if (enabled !== 'true') throw new Error('AI機能が無効です。設定画面で有効にしてください。');
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:generateReply', async (_e, emailId: string, tone: AiTone) => {
    ensureAiEnabled();
    const email = getEmail(emailId);
    if (!email) throw new Error('メールが見つかりません');
    return generateReply(email.subject, email.bodyText, tone);
  });

  ipcMain.handle('ai:summarize', async (_e, emailId: string) => {
    ensureAiEnabled();
    const email = getEmail(emailId);
    if (!email) throw new Error('メールが見つかりません');
    const result = await summarizeEmail(email.subject, email.bodyText);
    updateAiFields(emailId, { summary: result.summary, actions: result.actions });
    return result;
  });

  ipcMain.handle('ai:classify', async (_e, emailId: string) => {
    ensureAiEnabled();
    const email = getEmail(emailId);
    if (!email) throw new Error('メールが見つかりません');
    const result = await classifyEmail(email.subject, email.bodyText, email.from.address);
    updateAiFields(emailId, { category: result.category, priority: result.priority });
    return result;
  });

  ipcMain.handle('ai:smartSearch', async (_e, accountId: string, query: string) => {
    ensureAiEnabled();
    const emails = getRecentEmailsForSearch(accountId, 200);
    return smartSearch(query, emails);
  });

  ipcMain.handle('ai:setApiKey', (_e, apiKey: string) => {
    setSetting('gemini_api_key', apiKey);
    setSetting('ai_enabled', 'true');
    initGemini(apiKey);
  });

  ipcMain.handle('ai:getApiKey', () => {
    return getSetting('gemini_api_key') ?? '';
  });

  ipcMain.handle('ai:isEnabled', () => {
    return getSetting('ai_enabled') === 'true';
  });
}

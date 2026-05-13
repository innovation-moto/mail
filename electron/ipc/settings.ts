import { ipcMain } from 'electron';
import { getAllSettings, setSetting } from '../db/queries/settings';
import { Settings } from '../../shared/types';

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => getAllSettings());

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    setSetting(key, value);
    return getAllSettings();
  });

  ipcMain.handle('settings:setAll', (_e, settings: Partial<Settings>) => {
    if (settings.theme !== undefined) setSetting('theme', settings.theme);
    if (settings.notificationsEnabled !== undefined) setSetting('notifications_enabled', String(settings.notificationsEnabled));
    if (settings.notifyHighOnly !== undefined) setSetting('notify_high_only', String(settings.notifyHighOnly));
    if (settings.syncIntervalSec !== undefined) setSetting('sync_interval_sec', String(settings.syncIntervalSec));
    return getAllSettings();
  });
}

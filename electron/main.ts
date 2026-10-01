import { app, BrowserWindow, nativeTheme, shell, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { getDb, closeDb } from './db/index';
import { registerAccountHandlers } from './ipc/accounts';
import { registerMailHandlers } from './ipc/mail';
import { registerAiHandlers } from './ipc/ai';
import { registerBlocklistHandlers } from './ipc/blocklist';
import { registerSettingsHandlers } from './ipc/settings';
import { registerFilterHandlers } from './ipc/filters';
import { registerSignatureHandlers } from './ipc/signatures';
import { startSync, stopSync, syncAllAccounts } from './services/sync';
import { getTotalUnreadCount } from './db/queries/emails';
import { getSetting } from './db/queries/settings';
import { initGemini } from './services/gemini';
import { listAccounts, getEncryptedPassword } from './db/queries/accounts';
import { listFilters } from './db/queries/filters';
import { pushFilterRulesToImap, pushFolderStateToImap } from './services/filterSync';
import { safeStorage } from 'electron';

const isDev = !app.isPackaged;

/** 起動時に全アカウントのフィルタールールをIMAPにpushする */
async function pushAllFilterRulesOnStartup(): Promise<void> {
  const accounts = listAccounts();
  for (const account of accounts) {
    try {
      const enc = getEncryptedPassword(account.id);
      if (!enc) continue;
      const password = safeStorage.decryptString(enc);
      const rules = listFilters(account.id);
      if (rules.length === 0) continue;
      await pushFilterRulesToImap(account, password, rules);
      // フォルダ状態（移動済みメールのUID→フォルダマッピング）も同期
      await pushFolderStateToImap(account, password, account.id);
    } catch (e) {
      console.warn(`[filterSync] startup push failed for ${account.email}:`, (e as Error).message);
    }
  }
}

// Prevent unhandled promise rejections (e.g. IMAP socket timeouts) from
// surfacing as Electron error dialogs. Log them to the console instead.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Prevent uncaught exceptions (e.g. IMAP Socket timeout) from
// crashing the main process and showing the error dialog.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function getTrayIconPath(): string {
  if (isDev) {
    return path.join(__dirname, '../../build/icon.png');
  }
  // パッケージ済み: electron-builder が Resources/ 直下に icon.png を置く
  return path.join(process.resourcesPath, 'icon.png');
}

function updateTrayMenu(): void {
  if (!tray) return;
  const unread = getTotalUnreadCount();
  const label = unread > 0 ? `IM Mail（未読 ${unread}件）` : 'IM Mail';
  const menu = Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    {
      label: '開く',
      click: () => {
        if (!mainWindow) createWindow();
        mainWindow?.show();
        mainWindow?.focus();
        app.focus({ steal: true });
      },
    },
    { type: 'separator' },
    { label: '終了', click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray(): void {
  const img = nativeImage.createFromPath(getTrayIconPath());
  const icon = img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
  icon.setTemplateImage(true); // macOS: ダーク/ライトモード自動対応
  tray = new Tray(icon);
  tray.setToolTip('IM Mail');
  updateTrayMenu();

  tray.on('click', () => {
    if (!mainWindow) createWindow();
    mainWindow?.show();
    mainWindow?.focus();
    app.focus({ steal: true });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(app.getAppPath(), '..', 'app', 'out', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  // ×ボタンで閉じてもウィンドウを非表示にしてトレイに常駐
  mainWindow.on('close', (event) => {
    if (!(app as any).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initializeApp(): void {
  // Initialize DB
  getDb();

  // Register all IPC handlers
  registerAccountHandlers();
  registerMailHandlers();
  registerAiHandlers();
  registerBlocklistHandlers();
  registerSettingsHandlers();
  registerFilterHandlers();
  registerSignatureHandlers();

  // Initialize AI if API key exists
  const apiKey = getSetting('openai_api_key') || getSetting('gemini_api_key');
  if (apiKey) {
    try { initGemini(apiKey); } catch {}
  }
}

app.whenReady().then(() => {
  initializeApp();
  createTray();
  createWindow();

  // ログイン時に自動起動（初回のみ設定）
  if (app.isPackaged && process.platform === 'darwin') {
    const loginSettings = app.getLoginItemSettings();
    if (!loginSettings.openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    }
  }

  if (mainWindow) {
    // 起動時にDBの未読数をバッジに反映
    try { app.setBadgeCount(getTotalUnreadCount()); } catch { /* 無視 */ }
    // Initial sync after 2 seconds
    setTimeout(() => syncAllAccounts(mainWindow ?? undefined).catch(console.error), 2000);
    startSync(mainWindow);
    // 起動時にフィルタールールをIMAPへpush（スマホ同期用）
    setTimeout(() => pushAllFilterRulesOnStartup(), 5000);
  }

  app.on('activate', () => {
    // Dock アイコンクリックでウィンドウを再表示
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // macOS: トレイに常駐するので終了しない
  if (process.platform !== 'darwin') {
    stopSync();
    app.quit();
  }
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
  stopSync();
  closeDb();
});

// Handle theme changes
nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});

import { app, BrowserWindow, nativeTheme, shell } from 'electron';
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
import { getSetting } from './db/queries/settings';
import { initGemini } from './services/gemini';

const isDev = !app.isPackaged;

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
  createWindow();

  if (mainWindow) {
    // Initial sync after 2 seconds
    setTimeout(() => syncAllAccounts(mainWindow ?? undefined).catch(console.error), 2000);
    startSync(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopSync();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopSync();
  closeDb();
});

// Handle theme changes
nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});

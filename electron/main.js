const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Discord RPC (optional — graceful if missing) ────────────────────────────
let discordRpc = null;
let rpcClient = null;
let rpcReady = false;

try {
  discordRpc = require('discord-rpc');
  const clientId = '1505291486974181588';
  rpcClient = new discordRpc.Client({ transport: 'ipc' });
} catch (e) {
  console.log('[PLAYD] Discord RPC not available (discord-rpc not installed)');
}

// ── State ───────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;

const IS_DEV = !app.isPackaged;
const WEBUI_PATH = IS_DEV
  ? path.join(__dirname, '..', 'artifacts', 'audio-player', 'dist', 'public')
  : path.join(process.resourcesPath, 'webui');

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'PLAYD',
    icon: path.join(WEBUI_PATH, 'favicon.png'),
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the built PWA
  const indexPath = path.join(WEBUI_PATH, 'index.html');
  if (fs.existsSync(indexPath)) {
    mainWindow.loadFile(indexPath);
  } else {
    console.error('[PLAYD] Build not found. Run `pnpm build` first.');
    mainWindow.loadURL('data:text/html,<h1>PLAYD — Build not found</h1><p>Run <code>pnpm build</code> in the repo root first.</p>');
  }

  // Remove default menu bar
  mainWindow.setMenuBarVisibility(false);

  // Handle close — minimize to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Tray Icon ────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(WEBUI_PATH, 'favicon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    // Create a simple 16x16 colored icon as fallback
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('PLAYD');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show PLAYD',
      click: () => {
        if (mainWindow) mainWindow.show();
        else createWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) mainWindow.show();
    else createWindow();
  });
}

// ── IPC Handlers ────────────────────────────────────────────────────────────
function setupIpc() {
  // Discord RPC: update presence
  ipcMain.on('rpc-update', (event, data) => {
    updateDiscordPresence(data);
  });

  // Discord RPC: clear presence (pause / stop)
  ipcMain.on('rpc-clear', () => {
    clearDiscordPresence();
  });
}

// ── Discord RPC ─────────────────────────────────────────────────────────────
async function connectDiscordRpc() {
  if (!rpcClient || rpcReady) return;
  try {
    await rpcClient.connect({ clientId: '1505291486974181588' });
    rpcReady = true;
    console.log('[PLAYD] Discord RPC connected');
  } catch (e) {
    console.log('[PLAYD] Discord RPC connection failed (Discord not running?)');
  }
}

function updateDiscordPresence(data) {
  if (!rpcClient || !rpcReady) return;

  try {
    rpcClient.setActivity({
      details: data.title || 'Unknown Track',
      state: data.artist ? `${data.artist} — ${data.album || ''}` : undefined,
      largeImageKey: 'playd_logo',       // needs Discord dev portal asset upload
      largeImageText: 'PLAYD',
      smallImageKey: 'playing',
      smallImageText: 'Playing',
      startTimestamp: data.startTime || Date.now(),
      endTimestamp: data.endTime || undefined,
      instance: false,
    });
    console.log('[PLAYD] RPC presence updated:', data.title);
  } catch (e) {
    console.error('[PLAYD] RPC update failed:', e);
  }
}

function clearDiscordPresence() {
  if (!rpcClient || !rpcReady) return;
  try {
    rpcClient.clearActivity();
  } catch (e) {
    // ignore
  }
}

// ── App Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  setupIpc();
  connectDiscordRpc();

  // Register global media keys (optional — adds native keyboard shortcuts)
  globalShortcut.register('MediaPlayPause', () => {
    mainWindow?.webContents.send('media-key', 'playPause');
  });
  globalShortcut.register('MediaNextTrack', () => {
    mainWindow?.webContents.send('media-key', 'next');
  });
  globalShortcut.register('MediaPreviousTrack', () => {
    mainWindow?.webContents.send('media-key', 'prev');
  });
});

app.on('will-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (rpcClient) {
    try { rpcClient.destroy(); } catch {}
  }
});

app.on('window-all-closed', () => {
  // Don't quit on macOS unless explicitly asked
  if (process.platform !== 'darwin') {
    // Actually don't quit — we have a tray
  }
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});

console.log('[PLAYD] Desktop app starting...');
console.log('[PLAYD] Web UI path:', WEBUI_PATH);

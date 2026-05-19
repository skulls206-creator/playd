const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Discord RPC (optional — graceful if missing) ────────────────────────────
let rpcClient = null;
let rpcReady = false;

try {
  const { Client } = require('discord-rpc');
  rpcClient = new Client({ transport: 'ipc' });
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

// ── Launch a tiny static server for the PWA ──────────────────────────────────
const http = require('http');
function mimeLookup(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject', '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mjs': 'application/javascript',
    '.map': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}
let server = null;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      // Normalize the URL — strip query strings and decode
      const reqPath = req.url.split('?')[0];

      // ── SPA fallback: if the request doesn't look like a file, serve index.html ──
      const hasExtension = /\.[a-zA-Z0-9]+$/.test(reqPath);

      if (!hasExtension) {
        // SPA route — serve index.html so React Router / wouter can handle it
        const indexPath = path.join(WEBUI_PATH, 'index.html');
        return fs.readFile(indexPath, (err, data) => {
          if (err) {
            res.writeHead(500);
            res.end('Internal error');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data);
        });
      }

      // ── Static file ──────────────────────────────────────────────────────────
      let filePath = reqPath;
      if (filePath === '/') filePath = '/index.html';
      const fullPath = path.join(WEBUI_PATH, filePath);

      fs.readFile(fullPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const contentType = mimeLookup(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    // Use a random available port
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`[PLAYD] Static server on http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

// ── Window ──────────────────────────────────────────────────────────────────
async function createWindow() {
  const port = await startServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'PLAYD',
    icon: path.join(WEBUI_PATH, 'favicon.png'),
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,              // Prevent renderer from accessing Node.js APIs
      webSecurity: true,           // Enforce same-origin policy
    },
  });

  // Load from the local HTTP server
  mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

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
    if (server) {
      server.close();
      server = null;
    }
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
  ipcMain.on('rpc-update', (event, data) => {
    updateDiscordPresence(data);
  });
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
      largeImageKey: 'playd_logo',
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
app.whenReady().then(async () => {
  await createWindow();
  createTray();
  setupIpc();
  connectDiscordRpc();

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
  if (server) {
    server.close();
  }
});

app.on('window-all-closed', () => {
  // Don't quit — we have a tray
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});

console.log('[PLAYD] Desktop app starting...');
console.log('[PLAYD] Web UI path:', WEBUI_PATH);

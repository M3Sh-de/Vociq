'use strict';
const { app, BrowserWindow, BrowserView, ipcMain, shell, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

let win, tsView = null, tsVisible = false;
const TS_WEB = 'https://web.teamspeak.com/';

app.commandLine.appendSwitch('enable-features', 'WebRTC');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 740, minWidth: 900, minHeight: 580,
    frame: false, backgroundColor: '#0f0f0f',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
  });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => checkForUpdates());
  win.on('resize', () => { if (tsVisible) layoutTSView(); });
}

// ── Auto Updater ──────────────────────────────────────────────────────────────
function checkForUpdates() {
  if (!app.isPackaged) {
    win?.webContents.send('update-status', { type: 'dev', msg: '' });
    return;
  }
  autoUpdater.checkForUpdates().catch(err => {
    win?.webContents.send('update-status', { type: 'error', msg: err.message });
  });
}

autoUpdater.on('checking-for-update', () =>
  win?.webContents.send('update-status', { type: 'checking', msg: 'Suche nach Updates...' }));

autoUpdater.on('update-not-available', i =>
  win?.webContents.send('update-status', { type: 'up-to-date', msg: `Vociq v${i.version} — Aktuell` }));

autoUpdater.on('update-available', i =>
  win?.webContents.send('update-status', { type: 'available', msg: `Update verfügbar: v${i.version}`, version: i.version }));

autoUpdater.on('download-progress', p =>
  win?.webContents.send('update-status', { type: 'downloading', msg: `Download: ${Math.round(p.percent)}%`, percent: Math.round(p.percent), speed: Math.round(p.bytesPerSecond / 1024) }));

autoUpdater.on('update-downloaded', i =>
  win?.webContents.send('update-status', { type: 'ready', msg: `v${i.version} bereit — Neustart zum Installieren`, version: i.version }));

autoUpdater.on('error', e =>
  win?.webContents.send('update-status', { type: 'error', msg: `Update-Fehler: ${e.message}` }));

// ── TeamSpeak BrowserView ─────────────────────────────────────────────────────
function createTSView() {
  if (tsView) return;
  tsView = new BrowserView({
    webPreferences: { contextIsolation: false, nodeIntegration: false }
  });
  win.addBrowserView(tsView);
  tsView.webContents.session.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['microphone', 'audioCapture', 'speakers', 'media', 'mediaKeySystem'].includes(permission));
  });
  tsView.webContents.on('did-finish-load', () => win.webContents.send('ts-loaded'));
  tsView.webContents.on('did-fail-load', (_, code, desc) => win.webContents.send('ts-error', `[${code}] ${desc}`));
}

function layoutTSView() {
  if (!tsView || !win) return;
  const [w, h] = win.getContentSize();
  tsView.setBounds({ x: 0, y: 38, width: w, height: h - 38 });
  tsView.setAutoResize({ width: true, height: true });
}

function showTSView(url) {
  createTSView(); layoutTSView();
  win.setTopBrowserView(tsView); tsVisible = true;
  if (tsView.webContents.getURL() !== url) tsView.webContents.loadURL(url);
}

function hideTSView() {
  if (!tsView) return;
  win.removeBrowserView(tsView);
  tsView.webContents.loadURL('about:blank');
  tsView = null; tsVisible = false;
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.on('win-min',        () => win.minimize());
ipcMain.on('win-max',        () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('win-close',      () => win.close());
ipcMain.on('copy',           (_, t) => clipboard.writeText(t));
ipcMain.on('open-ts3',       (_, ip, port) => shell.openExternal(`ts3server://${ip}?port=${port || 9987}`));
ipcMain.on('install-update', () => autoUpdater.quitAndInstall(false, true));
ipcMain.on('check-update',   () => checkForUpdates());

ipcMain.on('ts-show', (_, ip, port) => {
  const addr = ip + (port && port !== '9987' ? `:${port}` : '');
  showTSView(`${TS_WEB}?connect=${encodeURIComponent(addr)}`);
  win.webContents.send('ts-panel-state', true);
});
ipcMain.on('ts-hide',        () => { hideTSView(); win.webContents.send('ts-panel-state', false); });
ipcMain.on('ts-reload',      () => tsView?.webContents.reload());
ipcMain.on('ts-home',        () => tsView?.webContents.loadURL(TS_WEB));
ipcMain.on('ts-open-native', (_, ip, port) => shell.openExternal(`ts3server://${ip}?port=${port || 9987}`));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

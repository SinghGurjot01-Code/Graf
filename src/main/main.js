import { app, BrowserWindow, Menu, nativeTheme, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceManager } from './workspace-manager.js';
import { IntegrationManager } from './integration-manager.js';
import { registerIpc } from './ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let workspace;
let integrations;
let tray;
let quitting = false;
let shutdownDone = false;
let pendingSecondInstance = false;

function getCorePath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'core') : path.resolve(__dirname, '../../core');
}
function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function createTray() {
  if (tray) return tray;
  const logoPath = path.join(app.getAppPath(), 'assets', 'brand', 'Logo.png');
  const image = nativeImage.createFromPath(logoPath);
  if (image.isEmpty()) return null;
  try {
    tray = new Tray(image.resize({ width: 18, height: 18 }));
    tray.setToolTip('Graf · Your codebase has a memory now');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Graf', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Graf', click: () => { app.quit(); } }
    ]));
    tray.on('double-click', showWindow);
    return tray;
  } catch (error) { console.warn('System tray is unavailable:', error.message); tray = null; return null; }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1120, minHeight: 700,
    backgroundColor: '#050506', show: false,
    title: 'Graf',
    icon: path.join(app.getAppPath(), 'assets', 'brand', process.platform === 'win32' ? 'graf.ico' : 'Logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.removeMenu();
  const hiddenStart = process.argv.includes('--hidden') && workspace.getPreferences().closeToTray;
  // Register before loading: ready-to-show can fire before loadFile() resolves, which would leave the window hidden forever.
  let revealed = false;
  const reveal = () => {
    if (revealed || !mainWindow) return;
    revealed = true;
    if (!hiddenStart || pendingSecondInstance) mainWindow.show();
    pendingSecondInstance = false;
  };
  mainWindow.once('ready-to-show', reveal);
  await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  setTimeout(reveal, 2500); // safety net if ready-to-show never arrives
  mainWindow.on('close', event => {
    if (!quitting && workspace?.getPreferences().closeToTray && tray) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWindow) showWindow(); else pendingSecondInstance = true; });
  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    workspace = new WorkspaceManager({ userDataPath: app.getPath('userData') });
    await workspace.init();
    integrations = new IntegrationManager({ app, corePath: getCorePath() });
    createTray();
    registerIpc({
      workspace,
      integrations,
      getMainWindow: () => mainWindow,
      getPreferences: () => workspace.getPreferences(),
      setPreferences: patch => workspace.setPreferences(patch),
      getTrayState: () => tray,
      setLoginItem: enabled => app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: app.getPath('exe'), args: ['--hidden'] })
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Graf', submenu: [{ role: 'about', label: 'About Graf' }, { type: 'separator' }, { role: 'quit', label: 'Quit Graf' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }
    ]));
    await createWindow();
    app.on('activate', async () => { if (BrowserWindow.getAllWindows().length === 0) await createWindow(); else showWindow(); });
  }).catch(error => { console.error('Graf startup failed:', error); app.quit(); });
}

app.on('before-quit', async event => {
  if (!workspace) return;
  if (shutdownDone) return;
  quitting = true;
  event.preventDefault();
  try { await workspace.shutdown(); } finally { shutdownDone = true; tray?.destroy(); tray = null; app.exit(0); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && (!workspace?.getPreferences().closeToTray || !tray)) app.quit(); });

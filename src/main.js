'use strict';

const { app, BrowserWindow, ipcMain, dialog, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const state = require('./state');
const settings = require('./settings');
const api = require('./api');
const { DownloadManager } = require('./downloadManager');

let indexStop = false; // set by 'index-stop' to halt an in-progress API crawl

// Shown in the macOS menu bar (dev). The Dock name in dev comes from the Electron
// bundle and can't be changed without packaging; the packaged app uses productName.
app.setName('Eliis Archiver');

let manager = null; // active streaming download session
let mainWin = null;
let loginWin = null;
let authPoll = null;

// Persistent session shared by the login window (so login survives restarts) and
// by the API/download requests (so they're authenticated).
const PARTITION = 'persist:eliis';
const HOME_URL = 'https://eliis.eu/';
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 800,
    backgroundColor: '#1b1d23',
    title: 'Eliis Archiver',
    icon: ICON_PATH, // used on Windows/Linux; macOS uses the bundle/Dock icon
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

async function isAuthed() {
  return api.isAuthed(session.fromPartition(PARTITION));
}

// Open the login popup (only used for logging in). Polls the API and closes
// itself once the session is authenticated, notifying the main window.
function openLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }
  loginWin = new BrowserWindow({
    width: 520,
    height: 720,
    parent: mainWin || undefined,
    title: 'Eliis — Logi sisse',
    backgroundColor: '#ffffff',
    webPreferences: { partition: PARTITION },
  });
  loginWin.webContents.setWindowOpenHandler(() => ({ action: 'allow' })); // OAuth popups
  loginWin.loadURL(HOME_URL);
  loginWin.on('closed', () => {
    loginWin = null;
    if (authPoll) { clearInterval(authPoll); authPoll = null; }
  });

  if (authPoll) clearInterval(authPoll);
  authPoll = setInterval(async () => {
    if (await isAuthed()) {
      clearInterval(authPoll); authPoll = null;
      if (loginWin && !loginWin.isDestroyed()) loginWin.close();
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('auth-ok');
    }
  }, 2500);
}

app.whenReady().then(async () => {
  // Dev: show our icon in the macOS Dock (packaged apps use the bundle icon).
  if (process.platform === 'darwin' && app.dock) {
    const img = nativeImage.createFromPath(ICON_PATH);
    if (!img.isEmpty()) app.dock.setIcon(img);
  }

  mainWin = createWindow();

  // Let the renderer request the login popup (e.g. session expired).
  ipcMain.handle('open-login', () => { openLoginWindow(); return true; });

  // Log out: clear the session (cookies + storage) for the eliis partition.
  ipcMain.handle('logout', async () => {
    await session.fromPartition(PARTITION).clearStorageData();
    return true;
  });

  // List the guardian's children (for the picker). Empty list if not logged in.
  ipcMain.handle('get-children', async () => {
    try {
      const sess = session.fromPartition(PARTITION);
      return { ok: true, ...(await api.getChildren(sess)) };
    } catch (e) {
      openLoginWindow(); // not authenticated — prompt login
      return { ok: false, error: String((e && e.message) || e), children: [] };
    }
  });

  // App-level settings restored on startup (e.g. the last-used folder). A folder
  // that no longer exists is dropped so the UI doesn't restore a dead path.
  ipcMain.handle('get-settings', () => {
    const s = settings.load();
    if (s.lastOutDir && !fs.existsSync(s.lastOutDir)) s.lastOutDir = null;
    return s;
  });

  // Pick an output folder (and remember it for next launch).
  ipcMain.handle('choose-output', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      title: 'Choose where to save the archive',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled) return null;
    settings.save({ lastOutDir: r.filePaths[0] });
    return r.filePaths[0];
  });

  // Resume support: read any saved state for a folder.
  ipcMain.handle('load-state', (_e, outDir) => (outDir ? state.load(outDir) : null));

  // Open (or reuse) the pipeline for a folder. Indexing and downloading both
  // run through this one manager so they can operate in parallel.
  ipcMain.handle('session-open', (evt, { outDir }) => {
    if (!manager || manager.outDir !== outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      const sess = session.fromPartition(PARTITION);
      manager = new DownloadManager({ outDir, sess, sender: evt.sender });
    } else {
      manager.sender = evt.sender;
    }
    return true;
  });

  // Index step: persist metadata + links (for resume) and queue the media.
  // Writes sidecars/diary immediately; downloads only run when downloading is on.
  // Used by the download-only path to (re)queue already-indexed items.
  ipcMain.handle('index-enqueue', (_e, { outDir, items }) => {
    state.appendItems(outDir, items, { phase: 'indexing' });
    if (manager) manager.enqueue(items);
    return true;
  });

  ipcMain.handle('index-stop', () => { indexStop = true; return true; });

  // Index via the eliis.eu API: walk the child's guardian feed, assign stable
  // indices (reusing known ones so filenames don't change on resume), persist to
  // state, and feed the download pipeline — all in the main process.
  ipcMain.handle('index-api', async (evt, { outDir, kindergartenId, childId, childName }) => {
    indexStop = false;
    fs.mkdirSync(outDir, { recursive: true });
    const sess = session.fromPartition(PARTITION);
    if (!manager || manager.outDir !== outDir) {
      manager = new DownloadManager({ outDir, sess, sender: evt.sender });
    } else {
      manager.sender = evt.sender;
    }

    const st = state.load(outDir);
    const known = new Map((st && st.items ? st.items : []).map((it) => [it.url, it.index]));
    let nextIdx = -1;
    for (const v of known.values()) if (typeof v === 'number') nextIdx = Math.max(nextIdx, v);
    nextIdx += 1;

    let res;
    try {
      res = await api.crawlFeed({
        sess, kindergartenId, childId, childName,
        shouldStop: () => indexStop,
        onItems: (items) => {
          const withIdx = items.map((it) => {
            let index = known.get(it.url);
            if (index === undefined) { index = nextIdx++; known.set(it.url, index); }
            return { ...it, index };
          });
          state.appendItems(outDir, withIdx, { phase: 'indexing' });
          if (manager) manager.enqueue(withIdx);
        },
      });
    } catch (e) {
      if (manager) manager.writeManifest();
      openLoginWindow(); // likely a session expiry mid-crawl
      return { stopped: true, total: known.size, error: String((e && e.message) || e) };
    }

    state.setMeta(outDir, { phase: res.stopped ? 'indexing' : 'indexed' });
    if (manager) manager.writeManifest();
    return res; // { stopped, total }
  });

  // Toggle the file downloader on/off (independent of indexing).
  ipcMain.handle('download-start', (_e, { outDir }) => {
    state.setMeta(outDir, { phase: 'downloading' });
    if (manager) manager.setDownloading(true);
    return true;
  });
  ipcMain.handle('download-stop', () => {
    if (manager) manager.setDownloading(false);
    return true;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // After handlers are registered, show the login popup if not authenticated.
  if (!(await isAuthed())) openLoginWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

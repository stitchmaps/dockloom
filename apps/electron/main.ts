import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeploymentCore } from '../../packages/core/index';
import { ServerStore } from './store';
import type { DockloomAPI } from '../../packages/shared/types';

if (process.env.DOCKLOOM_DATA_DIR) app.setPath('userData', path.resolve(process.env.DOCKLOOM_DATA_DIR));
const core = new DeploymentCore();
let win: BrowserWindow;
const store = new ServerStore(app.getPath('userData'));
const api: DockloomAPI = {
  listServers: () => store.list(), saveServer: s => store.save(s), removeServer: id => store.remove(id),
  async sshAliases() {
    try {
      const text = await readFile(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
      return [...new Set(text.split(/\r?\n/).flatMap(line => /^\s*Host\s+(.+)$/i.exec(line)?.[1].split(/\s+/).filter(h => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(h)) ?? []))];
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  },
  inspect: async id => core.inspect(await store.get(id)),
  logs: async (id, cid) => core.logs(await store.get(id), cid),
  action: async (id, cid, action) => core.action(await store.get(id), cid, action),
  async chooseDirectory() { const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; },
  async chooseKey() { const result = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Select an SSH private key (path only)' }); return result.canceled ? null : result.filePaths[0]; },
  plan: async (id, req) => core.plan(await store.get(id), req),
  deploy: async (id, req) => core.deploy(await store.get(id), req),
  planCompose: async (id, req) => core.planCompose(await store.get(id), req),
  deployCompose: async (id, req) => core.deployCompose(await store.get(id), req),
  releases: async id => core.releases(await store.get(id)),
  rollback: async (id, name, release) => core.rollback(await store.get(id), name, release),
  jobs: async id => core.jobs(await store.get(id)),
  job: async (id, jid) => core.job(await store.get(id), jid),
  importCompose: async (id, req) => core.importCompose(await store.get(id), req),
  async openExternal(url) { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Only HTTP(S) links without credentials can be opened'); await shell.openExternal(u.href); },
};
function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 920, minWidth: 1000, minHeight: 700, title: 'Dockloom', icon: path.join(__dirname, '../assets/icon.png'), backgroundColor: '#010102', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const dev = !app.isPackaged && process.env.DOCKLOOM_DEV_URL;
  if (dev) { const url = new URL(dev); if (url.origin !== 'http://127.0.0.1:5173') throw new Error('Invalid development origin'); void win.loadURL(url.href); }
  else void win.loadFile(path.join(__dirname, '../dist/index.html'));
}
app.whenReady().then(() => {
  for (const key of Object.keys(api) as (keyof DockloomAPI)[]) {
    ipcMain.handle(`dockloom:${key}`, async (event, ...args: unknown[]) => {
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted IPC sender');
      return (api[key] as (...args: unknown[]) => unknown)(...args);
    });
  }
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

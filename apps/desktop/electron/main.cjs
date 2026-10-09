// Electron shell. Starts the local Quillgon server (plain Node, so native modules
// like better-sqlite3 load without an Electron rebuild) and opens the UI it serves.
const { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
let server = null;
let win = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const node = process.env.QUILLGON_NODE || 'node';
    const tsx = require.resolve('tsx', { paths: [root] });
    const cli = path.join(root, 'packages', 'cli', 'src', 'main.ts');
    const args = ['--import', require('node:url').pathToFileURL(tsx).href, cli, 'serve', '--port', '0'];
    if (process.env.QUILLGON_PROJECT) args.push('--dir', process.env.QUILLGON_PROJECT);
    server = spawn(node, args, { cwd: root, env: { ...process.env, FORCE_COLOR: '0' } });
    let out = '';
    server.stdout.on('data', (d) => {
      out += d.toString();
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    server.stderr.on('data', (d) => process.stderr.write(d));
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
}

async function createWindow() {
  const url = process.env.VITE_DEV_SERVER_URL || (await startServer());
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: 'Quillgon',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#110e0b' : '#f9f6f1',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url: u }) => (shell.openExternal(u), { action: 'deny' }));
  await win.loadURL(url);
  // QUILLGON_SCREENSHOT=file.png: capture the window once it has rendered, then quit (smoke test).
  if (process.env.QUILLGON_SCREENSHOT) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      require('node:fs').writeFileSync(process.env.QUILLGON_SCREENSHOT, img.toPNG());
      app.quit();
    }, 2500);
  }
}

ipcMain.handle('choose-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.on('reveal', (_e, p) => shell.showItemInFolder(p));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => server && server.kill());

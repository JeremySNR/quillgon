// Electron shell. Starts the local Quillgon server and opens the UI it serves.
//
// - From a source checkout (`pnpm desktop`) the server is a plain Node process running the CLI
//   through tsx, so better-sqlite3 loads without an Electron rebuild. That needs `node` on PATH
//   (or QUILLGON_NODE).
// - In a packaged app the server is one bundled file, resources/server/server.mjs (built by
//   scripts/prepare-package.mjs), run by Electron's own Node (ELECTRON_RUN_AS_NODE=1) against a
//   better-sqlite3 rebuilt for Electron. Nothing outside the app is needed.
//
// The window may only ever show the server's origin: other navigations are blocked, new windows
// are refused (http, https and mailto links open in the default browser), and every permission
// request is denied.
const { app, BrowserWindow, dialog, ipcMain, session, shell, nativeTheme } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..', '..');
const STARTUP_TIMEOUT_MS = Number(process.env.QUILLGON_STARTUP_TIMEOUT_MS) || 30_000;
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

let server = null; // the running server process
let appOrigin = null; // e.g. http://127.0.0.1:53817, the only origin the window may show
let win = null;
let quitting = false;

const tail = (text, lines = 15) => text.trimEnd().split('\n').slice(-lines).join('\n');

function sameOrigin(url) {
  try {
    return appOrigin !== null && new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function openExternal(url) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return;
  }
  if (EXTERNAL_PROTOCOLS.has(protocol)) shell.openExternal(url).catch(() => {});
}

/** How to run the server: the bundle with Electron's Node when packaged, else node + tsx. */
function serverCommand() {
  const dir = process.env.QUILLGON_PROJECT ? ['--dir', path.resolve(process.env.QUILLGON_PROJECT)] : [];
  // QUILLGON_SERVER_BUNDLE=/abs/path/to/apps/desktop/out/server/server.mjs runs the bundled server from a
  // source checkout too (after `pnpm -C apps/desktop bundle`), to test it without packaging.
  if (app.isPackaged || process.env.QUILLGON_SERVER_BUNDLE) {
    const bundle = process.env.QUILLGON_SERVER_BUNDLE ? path.resolve(process.env.QUILLGON_SERVER_BUNDLE) : path.join(process.resourcesPath, 'server', 'server.mjs');
    if (!fs.existsSync(bundle)) throw new Error(`The bundled server is missing (${bundle}). Reinstall Quillgon.`);
    return {
      command: process.execPath,
      args: [bundle, '--port', '0', ...dir],
      cwd: app.getPath('home'),
      env: { ELECTRON_RUN_AS_NODE: '1', QUILLGON_PARENT_STDIN: '1', QUILLGON_FIXTURE_DIR: path.join(path.dirname(bundle), 'fixtures', 'novella') },
      notFound: 'Reinstall Quillgon.',
    };
  }
  let tsx;
  try {
    tsx = require.resolve('tsx', { paths: [root] });
  } catch {
    throw new Error(`tsx is not installed in ${root}. Run \`pnpm install\` in the repository first.`);
  }
  const command = process.env.QUILLGON_NODE || 'node';
  return {
    command,
    args: ['--import', pathToFileURL(tsx).href, path.join(root, 'packages', 'cli', 'src', 'main.ts'), 'serve', '--port', '0', ...dir],
    cwd: root,
    env: {},
    notFound: process.env.QUILLGON_NODE
      ? 'Set QUILLGON_NODE to the full path of a Node.js 22 (or newer) binary, or unset it to use `node` from your PATH.'
      : 'Install Node.js 22 or newer and make sure `node` is on your PATH, or set QUILLGON_NODE to the full path of a node binary.',
  };
}

/** Starts the server and resolves with its URL once it prints one. */
function startServer() {
  return new Promise((resolve, reject) => {
    const spec = serverCommand();
    const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: { ...process.env, FORCE_COLOR: '0', ...spec.env }, windowsHide: true });
    server = child;
    let stdout = '';
    let stderr = '';
    let started = false;
    let failed = false;
    const fail = (message) => {
      if (started || failed) return;
      failed = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      if (server === child) server = null;
      reject(new Error(stderr.trim() ? `${message}\n\nServer output:\n${tail(stderr)}` : message));
    };
    const timer = setTimeout(() => fail(`The Quillgon server did not start within ${STARTUP_TIMEOUT_MS / 1000} seconds.`), STARTUP_TIMEOUT_MS);

    child.stdout.on('data', (d) => {
      if (started || failed) return;
      stdout += d.toString();
      const m = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        started = true;
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
    child.stderr.on('data', (d) => {
      process.stderr.write(d);
      stderr = (stderr + d.toString()).slice(-16_000);
    });
    // Our end of the server's stdin: an EPIPE here must not crash the shell.
    child.stdin.on('error', () => {});
    child.on('error', (err) => {
      fail(err.code === 'ENOENT' ? `Could not run "${spec.command}": it was not found. ${spec.notFound}` : `Could not start the Quillgon server (${spec.command}): ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      if (!started) return fail(`The Quillgon server stopped before it was ready (${signal ?? `exit code ${code}`}).`);
      if (server === child) server = null;
      if (!quitting) serverCrashed(code, signal, stderr);
    });
  });
}

function fatal(err) {
  dialog.showErrorBox('Quillgon could not start', err instanceof Error ? err.message : String(err));
  quitting = true;
  app.quit();
}

async function serverCrashed(code, signal, stderr) {
  const options = {
    type: 'error',
    buttons: ['Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    title: 'Quillgon',
    message: 'The Quillgon server stopped unexpectedly.',
    detail: `It ended with ${signal ?? `exit code ${code}`}. Changes you had not yet saved in the window may be lost.${stderr.trim() ? `\n\n${tail(stderr)}` : ''}`,
  };
  const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (quitting) return;
  if (response !== 0) return app.quit();
  try {
    await show(await startServer());
  } catch (err) {
    fatal(err);
  }
}

async function show(url) {
  appOrigin = new URL(url).origin;
  if (!win || win.isDestroyed()) createWindow();
  await win.loadURL(url);
}

function createWindow() {
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
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => (win = null));
}

async function start() {
  // Deny every permission (camera, microphone, notifications, geolocation…); the UI needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  await show(process.env.VITE_DEV_SERVER_URL || (await startServer()));

  // QUILLGON_SCREENSHOT=file.png: capture the window once it has rendered, then quit (smoke test).
  if (process.env.QUILLGON_SCREENSHOT) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.QUILLGON_SCREENSHOT, img.toPNG());
      app.quit();
    }, 2500);
  }
}

// Every web contents (the window, and anything it might create) stays on the server's origin.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url = e.url) => {
    if (sameOrigin(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  contents.on('will-redirect', (e, url = e.url) => {
    if (!sameOrigin(url)) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

// IPC is only answered for the app's own pages.
const fromApp = (e) => !!e.senderFrame && sameOrigin(e.senderFrame.url);
ipcMain.handle('choose-folder', async (e) => {
  if (!fromApp(e)) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.on('reveal', (e, p) => {
  if (fromApp(e) && typeof p === 'string' && path.isAbsolute(p)) shell.showItemInFolder(p);
});

app.whenReady().then(start).catch(fatal);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => (quitting = true));
app.on('quit', () => server && server.kill());

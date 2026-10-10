// Stages everything electron-builder packs (see electron-builder.config.cjs). Run after `vite build`.
//
//   out/app/      the Electron shell: package.json, electron/main.cjs, electron/preload.cjs (→ app.asar)
//   out/server/   the core server as one bundled file plus what it reads at runtime (→ resources/server)
//     server.mjs                   electron/server-entry.mjs + @quillgon/* + npm deps, bundled by esbuild
//     ui/                          the built UI
//     fixtures/novella/            the sample novella (/api/open-sample copies it)
//     shared.md, <agent>/prompt.md the agents' built-in prompts (read relative to server.mjs)
//     node_modules/better-sqlite3  the one native dependency, rebuilt for Electron's ABI
//
// The dev path (`pnpm desktop`: plain Node + tsx from the source tree) does not use any of this.
// Env: QUILLGON_VERSION=1.2.3 (or v1.2.3) sets the app version; default is apps/desktop/package.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rebuild } from '@electron/rebuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const root = path.resolve(appDir, '..', '..');
const out = path.join(appDir, 'out');
const outApp = path.join(out, 'app');
const outServer = path.join(out, 'server');
const requireApp = createRequire(path.join(appDir, 'package.json'));
const desktopPkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const electronPkg = requireApp('electron/package.json');
const version = (process.env.QUILLGON_VERSION || desktopPkg.version).replace(/^v/, '');

const step = (msg) => console.log(`\n● ${msg}`);
const copy = (from, to, filter) => fs.cpSync(from, to, { recursive: true, dereference: true, filter });
const noEngine = (src) => !src.split(path.sep).includes('.engine');

// --- 0. reset the staging area (keep the rebuilt native module; it is slow to build)
fs.rmSync(outApp, { recursive: true, force: true });
fs.mkdirSync(outServer, { recursive: true });
for (const entry of fs.readdirSync(outServer)) if (entry !== 'node_modules') fs.rmSync(path.join(outServer, entry), { recursive: true, force: true });

// --- 1. the server bundle
step('Bundling the server with esbuild');
const result = await build({
  entryPoints: [path.join(appDir, 'electron', 'server-entry.mjs')],
  outfile: path.join(outServer, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Native addon, loaded through `bindings`: it ships as a real package next to server.mjs.
  // (@openai/codex-sdk is plain JS and is bundled; the Codex binary it looks for is not shipped.)
  external: ['better-sqlite3'],
  // Bundled CommonJS dependencies call require() for Node built-ins; give the ESM bundle one.
  banner: { js: "import { createRequire as __quillgonCreateRequire } from 'node:module';\nconst require = __quillgonCreateRequire(import.meta.url);" },
  legalComments: 'external',
  logLevel: 'warning',
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`  server.mjs and licences: ${(bytes / 1e6).toFixed(1)} MB`);

// --- 2. files the server reads at runtime
step('Copying the UI, the sample novella and the agent prompts');
const ui = path.join(appDir, 'dist');
if (!fs.existsSync(path.join(ui, 'index.html'))) throw new Error(`No built UI at ${ui}. Run \`vite build\` first (pnpm -C apps/desktop build).`);
copy(ui, path.join(outServer, 'ui'));
copy(path.join(root, 'fixtures', 'novella'), path.join(outServer, 'fixtures', 'novella'), noEngine);
// packages/agents/src/agents/define.ts reads <its dir>/shared.md and <its dir>/<agent>/prompt.md;
// in the bundle "its dir" is the directory of server.mjs.
const agentsDir = path.join(root, 'packages', 'agents', 'src', 'agents');
copy(agentsDir, outServer, (src) => fs.statSync(src).isDirectory() || src.endsWith('.md'));

// --- 3. better-sqlite3, rebuilt for Electron
const requireCore = createRequire(path.join(root, 'packages', 'core', 'package.json'));
const sqlitePkgPath = requireCore.resolve('better-sqlite3/package.json');
const sqliteVersion = JSON.parse(fs.readFileSync(sqlitePkgPath, 'utf8')).version;
fs.writeFileSync(
  path.join(outServer, 'package.json'),
  JSON.stringify({ name: 'quillgon-server', version, private: true, type: 'module', dependencies: { 'better-sqlite3': sqliteVersion } }, null, 2) + '\n',
);
const modules = path.join(outServer, 'node_modules');
const addon = path.join(modules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const stampFile = path.join(modules, '.quillgon-native.json');
const stamp = JSON.stringify({ electron: electronPkg.version, platform: process.platform, arch: process.arch, betterSqlite3: sqliteVersion });
const cached = fs.existsSync(addon) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp;

if (cached) {
  step(`better-sqlite3 ${sqliteVersion} already built for Electron ${electronPkg.version} (${process.platform}-${process.arch})`);
} else {
  step(`Rebuilding better-sqlite3 ${sqliteVersion} for Electron ${electronPkg.version} (${process.platform}-${process.arch})`);
  fs.rmSync(modules, { recursive: true, force: true });
  // Copy the package and its runtime dependencies (bindings → file-uri-to-path), not the
  // install-time ones (prebuild-install is run from the workspace copy below).
  const installOnly = new Set(['prebuild-install']);
  const seen = new Set();
  const copyPackage = (pkgJsonPath) => {
    const dir = path.dirname(pkgJsonPath);
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (seen.has(pkg.name)) return;
    seen.add(pkg.name);
    const skip = new Set(['node_modules', 'build', 'prebuilds'].map((d) => path.join(dir, d)));
    copy(dir, path.join(modules, pkg.name), (src) => !skip.has(src));
    const req = createRequire(pkgJsonPath);
    for (const dep of Object.keys(pkg.dependencies ?? {})) if (!installOnly.has(dep)) copyPackage(req.resolve(`${dep}/package.json`));
  };
  copyPackage(sqlitePkgPath);

  // A prebuilt binary from the better-sqlite3 release, if one exists for this Electron ABI
  // (what `npm install` would do); otherwise compile it, which needs a C/C++ toolchain, Python 3
  // and the Electron headers from electronjs.org.
  const prebuild = spawnSync(
    process.execPath,
    [createRequire(sqlitePkgPath).resolve('prebuild-install/bin.js'), '--runtime', 'electron', '--target', electronPkg.version, '--arch', process.arch, '--platform', process.platform],
    { cwd: path.join(modules, 'better-sqlite3'), stdio: 'inherit' },
  );
  if (prebuild.status === 0 && fs.existsSync(addon)) {
    console.log('  using the prebuilt binary');
  } else {
    console.log('  no prebuilt binary for this Electron; building from source');
    try {
      await rebuild({ buildPath: outServer, electronVersion: electronPkg.version, arch: process.arch, onlyModules: ['better-sqlite3'], force: true, buildFromSource: true });
    } catch (err) {
      throw new Error(`Could not build better-sqlite3 for Electron ${electronPkg.version}: ${err.message}\nThis needs a C/C++ toolchain, Python 3 and network access to https://www.electronjs.org/headers.`);
    }
  }
  if (!fs.existsSync(addon)) throw new Error(`Rebuild finished but ${addon} is missing`);

  // Keep only what loads at runtime: lib/ and the compiled addon (drops ~10 MB of SQLite sources).
  const pkgDir = path.join(modules, 'better-sqlite3');
  for (const d of ['deps', 'src', 'binding.gyp']) fs.rmSync(path.join(pkgDir, d), { recursive: true, force: true });
  const keep = path.join(pkgDir, 'better_sqlite3.node.tmp');
  fs.renameSync(addon, keep);
  fs.rmSync(path.join(pkgDir, 'build'), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(addon), { recursive: true });
  fs.renameSync(keep, addon);
  fs.writeFileSync(stampFile, stamp);
}

// Prove the addon loads in Electron's Node before anything is packed.
const electronBin = requireApp('electron');
const check = spawnSync(
  electronBin,
  ['-e', "const D = require('better-sqlite3'); const db = new D(':memory:'); console.log('sqlite', db.prepare('select sqlite_version() v').get().v); db.close();"],
  { cwd: outServer, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' },
);
if (check.status !== 0) {
  fs.rmSync(stampFile, { force: true }); // rebuild next time
  throw new Error(`better-sqlite3 does not load in Electron ${electronPkg.version}:\n${check.stderr || check.error}`);
}
console.log(`  loads in Electron ${electronPkg.version}: ${check.stdout.trim()}`);

// --- 4. the Electron shell
step('Staging the Electron shell');
fs.mkdirSync(path.join(outApp, 'electron'), { recursive: true });
for (const f of ['main.cjs', 'preload.cjs']) fs.copyFileSync(path.join(appDir, 'electron', f), path.join(outApp, 'electron', f));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(outApp, 'package.json'),
  JSON.stringify(
    {
      name: 'quillgon',
      productName: 'Quillgon',
      // Linux: the .desktop file name, and Electron's app_id / WM_CLASS, so docks match the window.
      desktopName: 'quillgon.desktop',
      version,
      description: rootPkg.description,
      license: 'MIT',
      author: { name: 'Quillgon contributors' },
      homepage: 'https://github.com/JeremySNR/quillgon',
      main: 'electron/main.cjs',
    },
    null,
    2,
  ) + '\n',
);
console.log(`\nStaged Quillgon ${version} in ${path.relative(root, out)}/`);

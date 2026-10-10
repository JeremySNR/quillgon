// `pnpm dev`: the API server and the Vite dev server, sharing one per-launch API token.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const root = path.resolve(app, '..', '..');
const require = createRequire(path.join(app, 'package.json'));
// Resolve everything before starting anything, so a failure cannot orphan a child.
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const env = { ...process.env, QUILLGON_TOKEN: process.env.QUILLGON_TOKEN || randomBytes(24).toString('base64url') };

const children = [
  spawn(process.execPath, ['--import', 'tsx', path.join(root, 'packages', 'cli', 'src', 'main.ts'), 'serve', '--port', '4317'], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, [viteBin], { cwd: app, env, stdio: 'inherit' }),
];

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exitCode = code ?? 0;
};
for (const c of children) c.on('exit', (code) => stop(code));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(0));

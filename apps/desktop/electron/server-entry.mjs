// Entry point of the server inside a packaged app. scripts/prepare-package.mjs bundles it
// (with @quillgon/server and every workspace and npm dependency except better-sqlite3) into
// out/server/server.mjs, which ships as resources/server/server.mjs. main.cjs runs it with
// Electron's own Node (ELECTRON_RUN_AS_NODE=1), so a packaged app needs neither Node nor tsx.
//
// Files it expects next to itself (all staged by prepare-package.mjs):
//   ui/                     the built UI (vite build)
//   fixtures/novella/       the sample novella, copied by /api/open-sample
//   shared.md, <agent>/prompt.md   the agents' built-in prompts (read relative to this file)
//   node_modules/better-sqlite3    rebuilt for Electron's ABI
//
// Usage: server.mjs [--port 0] [--dir <book>]. Prints "Quillgon on http://127.0.0.1:<port>".
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NovelServer } from '@quillgon/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

process.env.QUILLGON_FIXTURE_DIR ||= path.join(here, 'fixtures', 'novella');

const server = new NovelServer({ staticDir: process.env.QUILLGON_STATIC_DIR || path.join(here, 'ui') });
const dir = flag('dir');
if (dir) server.open(path.resolve(dir));
const port = await server.listen(Number(flag('port') ?? 4317));
console.log(`Quillgon on http://127.0.0.1:${port}${dir ? `  (${path.resolve(dir)})` : ''}`);

// Started by the Electron shell: exit when the shell goes away, even if it was killed and
// never got to stop us (its end of our stdin closes then).
if (process.env.QUILLGON_PARENT_STDIN === '1') {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('error', () => process.exit(0));
  process.stdin.resume();
}

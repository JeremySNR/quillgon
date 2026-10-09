#!/usr/bin/env node
// Thin launcher so `novel` works without a build step, from any directory.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.join(here, '..', 'src', 'main.ts');
const tsx = import.meta.resolve('tsx');
const r = spawnSync(process.execPath, ['--import', tsx, main, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);

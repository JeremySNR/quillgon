import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GraphStore } from '@quillgon/core';
import { copyFixture } from '../../core/test/helpers.js';
import { parseArgs } from '../src/args.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(here, '../src/main.ts');

describe('argument parsing', () => {
  it('boolean flags never swallow the next argument', () => {
    expect(parseArgs(['write', '--yes', 's01'])).toEqual({ flags: { yes: true }, args: ['write', 's01'] });
    expect(parseArgs(['init', 'book', '--offline', '--title', 'The Book'])).toEqual({ flags: { offline: true, title: 'The Book' }, args: ['init', 'book'] });
  });
  it('takes values after = or as the next argument, and stops at --', () => {
    expect(parseArgs(['export', '--format=epub', '--dir', 'x'])).toEqual({ flags: { format: 'epub', dir: 'x' }, args: ['export'] });
    expect(parseArgs(['read', '--outline=false'])).toEqual({ flags: { outline: false }, args: ['read'] });
    expect(parseArgs(['spark', '--', '--not-a-flag'])).toEqual({ flags: {}, args: ['spark', '--not-a-flag'] });
  });
});

async function book() {
  const dir = copyFixture();
  const s = GraphStore.open(dir, { memoryIndex: true });
  await s.repo.init();
  await s.checkpoint('Fixture');
  s.close();
  return dir;
}

function cli(dir: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', main, ...args, '--dir', dir], {
    encoding: 'utf8',
    input: '', // no terminal: stdin is a pipe
    env: { ...process.env, QUILLGON_OFFLINE: '1', HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'ql-home-')), FORCE_COLOR: '0', ...env },
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const commits = (dir: string) => spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();

describe('quillgon CLI', () => {
  it('validates and reports status', async () => {
    const dir = await book();
    expect(cli(dir, ['validate'])).toMatchObject({ code: 0 });
    const status = cli(dir, ['status']);
    expect(status.code).toBe(0);
    expect(status.out).toMatch(/12/);
  });

  it('a piped run never accepts a change on its own; --yes does', async () => {
    const dir = await book();
    // A scripted $EDITOR: Mara no longer knows who holds the debts at the end of s04.
    const editor = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ed-')), 'edit.mjs');
    fs.writeFileSync(editor, "import fs from 'node:fs';\nconst f = process.argv[2];\nfs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\\n').filter((l) => !l.includes('eliza-holds-debts')).join('\\n'));\n");
    const env = { EDITOR: `"${process.execPath}" "${editor}"`, VISUAL: '' };
    const before = commits(dir);

    const piped = cli(dir, ['change', 'state:mara@s04'], env);
    expect(piped.code).toBe(1);
    expect(piped.out).toMatch(/needs an answer.*--yes/s);
    expect(commits(dir)).toBe(before);
    expect(fs.existsSync(path.join(dir, '.engine', 'ripple'))).toBe(false);

    fs.rmSync(path.join(dir, 'characters'), { recursive: true });
    spawnSync('git', ['checkout', '--', '.'], { cwd: dir });
    const yes = cli(dir, ['change', 'state:mara@s04', '--yes'], env);
    expect(yes.code, yes.out).toBe(0);
    const log = spawnSync('git', ['log', '--format=%s'], { cwd: dir, encoding: 'utf8' }).stdout;
    expect(log).toMatch(/^Ripple round 1:/m);
  });
});

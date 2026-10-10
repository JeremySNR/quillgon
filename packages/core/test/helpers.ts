import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/novella');

/** Copy the fixture novella to a temp dir so tests can write to it. */
export function copyFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novella-'));
  fs.cpSync(FIXTURE, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.engine`) });
  return dir;
}

export function edit(dir: string, rel: string, fn: (text: string) => string) {
  const p = path.join(dir, rel);
  // Fixture mutations use LF patterns, including on Windows Git checkouts.
  fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')));
}

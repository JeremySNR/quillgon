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

/** A silent 16 kHz mono 16-bit WAV of the given length. */
export function silentWav(seconds: number): Uint8Array {
  const samples = Math.round(16000 * seconds);
  const buf = new Uint8Array(44 + samples * 2);
  const v = new DataView(buf.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (buf[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  return buf;
}

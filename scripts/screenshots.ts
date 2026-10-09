/**
 * Visual check: serves the built UI against a copy of the sample novella and captures
 * every main view in dark and light. `pnpm build && pnpm tsx scripts/screenshots.ts`
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'docs', 'screenshots');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-home-'));
process.env.HOME = home;
process.env.NOVEL_OFFLINE = process.env.NOVEL_OFFLINE ?? '1';
const { NovelServer } = await import('@novel/server');

const server = new NovelServer({ staticDir: path.resolve(here, '..', 'apps', 'desktop', 'dist') });
const port = await server.listen(0);
const base = `http://127.0.0.1:${port}`;
const api = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(`${base}/api${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
};
const waitJob = async (p: string, body: unknown = {}) => {
  const { job } = await api('POST', p, body);
  for (;;) {
    const j = await api('GET', `/jobs/${job}`);
    if (j.state === 'done') return j.result;
    if (j.state === 'error') throw new Error(j.error);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const exe = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const errors: string[] = [];

async function shoot(name: string, hash: string, theme: 'dark' | 'light', prep?: (page: import('playwright-core').Page) => Promise<void>, size = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(`${base}/#/${hash}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  if (prep) await prep(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${name}-${theme}.png`) });
  await ctx.close();
}

// Welcome, before any project is open.
await shoot('welcome', '', 'dark');

await api('POST', '/open-sample');
// A reader run and a continuity check so the dashboard and report have data.
await waitJob('/quality/reader');
await waitJob('/quality/continuity', { model: false });

for (const theme of ['dark', 'light'] as const) {
  await shoot('overview', 'dashboard', theme);
  await shoot('outline', 'outline', theme);
  await shoot('scene', 'scene/s04', theme);
}
await shoot('build', 'build/structure', 'dark');
await shoot('threads', 'threads', 'dark');
await shoot('characters', 'characters/mara', 'dark');
await shoot('reader', 'reader', 'dark', async (page) => {
  await page.locator('.chart .pt').nth(4).click();
});
await shoot('palette', 'dashboard', 'dark', async (page) => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('ledg');
});

// A ripple: Mara no longer learns about the debts in s04.
const scene = await api('GET', '/scenes/s04');
const snap = scene.states.find((s: any) => s.character === 'mara').after;
const { change } = await api('PUT', '/characters/mara/state/s04', { snapshot: { ...snap, knows: snap.knows.filter((f: string) => f !== 'eliza-holds-debts') } });
await api('POST', '/ripple/start', { change });
await waitJob('/ripple/propose');
await api('POST', '/ripple/accept', { scene: 's06' });
await waitJob('/ripple/propose-prose', { scene: 's06' });
for (const theme of ['dark', 'light'] as const) {
  await shoot('ripple', 'ripple', theme, async (page) => {
    await page.getByRole('option').filter({ hasText: 's06' }).click();
  });
}
await shoot('ripple-card', 'ripple', 'dark', async (page) => {
  await page.getByRole('option').filter({ hasText: 's11' }).click();
});
await shoot('overview-ripple', 'dashboard', 'dark');
await shoot('narrow', 'scene/s10', 'dark', undefined, { width: 1100, height: 760 });

await browser.close();
server.close();
console.log(errors.length ? `Console errors:\n${errors.join('\n')}` : 'No console errors.');
console.log(`Screenshots in ${out}`);
process.exit(errors.length ? 1 : 0);

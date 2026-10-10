/** Real-browser regression checks and screenshots for the editorial refresh.
 * Run after `pnpm build`: CHROME=/usr/bin/chromium pnpm tsx scripts/ui-refresh.ts
 * Uses a disposable sample manuscript and offline models; no API key is needed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { GraphStore } from '@quillgon/core';
import { NovelServer } from '@quillgon/server';

process.env.QUILLGON_OFFLINE = '1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillgon-ui-'));
const out = path.join(root, 'docs/screenshots/ui-refresh');
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'fixtures/novella'), dir, { recursive: true });
const seed = GraphStore.open(dir, { noIndex: true });
await seed.repo.init();
await seed.commit('Sample manuscript');
seed.close();
const server = new NovelServer({ staticDir: path.join(root, 'apps/desktop/dist') });
const base = `http://127.0.0.1:${await server.listen(0)}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
const errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
const api = async (method: string, route: string, body?: unknown) => {
  const r = await fetch(`${base}/api${route}`, { method, headers: { 'content-type': 'application/json', 'x-quillgon-token': server.token }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(r.ok, `${method} ${route}: ${r.status}`);
  return r.json();
};
const until = async (check: () => Promise<boolean>, label: string) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out: ${label}`);
};
const capture = async (name: string, route: string) => {
  await page.goto(`${base}/#/${route}`);
  await page.waitForSelector('.sidebar');
  if (route.startsWith('scene')) await page.waitForSelector('.cm-content');
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
};

try {
  await page.goto(base);
  await page.waitForSelector('.welcome h1');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, 'welcome.png') });
  // Open through the UI, then continue to an actual scene.
  await page.getByPlaceholder('/path/to/book').fill(dir);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Continue writing', exact: true }).click();
  await page.waitForSelector('.cm-content');
  assert.ok(page.url().endsWith('/scene/s01'));
  await page.getByRole('button', { name: 'Scene details', exact: true }).click();
  assert.ok(await page.getByRole('complementary', { name: 'Scene card' }).isVisible());
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await until(async () => (await page.locator('.app').getAttribute('class'))!.includes('focus'), 'focus mode');
  await page.getByRole('button', { name: 'Scene details', exact: true }).click();
  assert.ok(await page.getByRole('complementary', { name: 'Scene card' }).isVisible());
  await page.getByRole('button', { name: 'Close scene details' }).click();

  const original = (await api('GET', '/scenes/s01')).prose.body;
  const marker = 'A quiet moment before the tide turns.';
  await page.getByRole('textbox', { name: 'Scene prose' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`\n\n${marker}`);
  await until(async () => (await api('GET', '/scenes/s01')).prose.body.includes(marker), 'autosave reaches API');
  await page.reload();
  await page.getByRole('textbox', { name: 'Scene prose' }).click();
  // CodeMirror virtualizes off-screen paragraphs; scroll to the edited passage.
  await page.keyboard.press('Control+End');
  await until(async () => (await page.locator('.cm-content').textContent())!.includes(marker), 'saved prose after reload');
  await api('PUT', '/scenes/s01/prose', { body: original });
  await api('POST', '/scenes/s01/mark-in-sync');
  console.log('PASS: open manuscript, continue writing, inspector, focus, autosave, reload');

  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search scenes, characters, threads, or type a command…').fill('Short Weight');
  await page.keyboard.press('Enter');
  await until(async () => (await page.locator('.scene-heading').textContent()) === 'Short Weight', 'command palette navigation');
  await page.goto(`${base}/#/dashboard`);
  await page.getByRole('button', { name: 'Continue writing', exact: true }).click();
  assert.ok(page.url().endsWith('/scene/s04'), 'continue writing remembers the last scene');
  await page.goto(`${base}/#/outline`);
  await page.getByRole('button', { name: 'Funeral Eve', exact: true }).click();
  await page.waitForSelector('.cm-content');
  assert.ok(page.url().endsWith('/scene/s01'));
  console.log('PASS: theme persistence, keyboard search, remembered scene, manuscript links');

  await capture('desk-dark', 'dashboard');
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  for (const [name, route] of [
    ['desk-light', 'dashboard'], ['editor', 'scene/s04'], ['manuscript', 'outline'],
    ['planning', 'build/structure'], ['characters', 'characters'], ['threads', 'threads'],
    ['ledger', 'threads/ledger'], ['reader', 'reader'], ['settings', 'settings/style'], ['history', 'history'],
  ]) await capture(name, route);
  await capture('editor', 'scene/s04');
  await page.getByRole('button', { name: 'Scene details', exact: true }).click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(out, 'editor-details.png') });
  await page.getByRole('button', { name: 'Close scene details' }).click();

  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [name, route] of [['desk', 'dashboard'], ['editor', 'scene/s04'], ['manuscript', 'outline'], ['settings', 'settings/style']]) {
      await capture(`${name}-${width}`, route);
      const overflow = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth, main: document.querySelector('.main')!.scrollWidth, client: document.querySelector('.main')!.clientWidth }));
      assert.ok(overflow.body <= width + 1, `${route} overflows at ${width}: ${JSON.stringify(overflow)}`);
      assert.ok(overflow.main <= overflow.client + 1, `${route} main panel overflows at ${width}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: all views, 900px and 390px layouts, no browser errors');
  console.log(`Screenshots: ${out}`);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

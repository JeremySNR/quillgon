/** Browser → local API → saved cover → preview/download, with a mocked paid image endpoint. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { NovelServer } from '@quillgon/server';
import { copyFixture } from '../packages/core/test/helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.QUILLGON_OFFLINE = '0';
process.env.OPENAI_API_KEY = 'mock-cover-key';
process.env.OPENAI_BASE_URL = 'https://covers-test.invalid/v1';
const dir = copyFixture();
const server = new NovelServer({ staticDir: path.join(root, 'apps/desktop/dist') });
server.open(dir);
server.engine!.store.saveBook({ ...server.engine!.store.book, models: { frontier: { provider: 'openai', model: 'gpt-6.1-sol' } } });
const originalFetch = globalThis.fetch;
let requests = 0;
let lastPrompt = '';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGo0AAAAASUVORK5CYII=';
globalThis.fetch = async (input, init) => {
  if (String(input) === 'https://covers-test.invalid/v1/images/generations') {
    requests++;
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, 'gpt-image-2.5-sunburst');
    lastPrompt = payload.prompt;
    return Response.json({ data: [{ b64_json: png }] });
  }
  return originalFetch(input, init);
};
const base = `http://127.0.0.1:${await server.listen(0)}`;
const executablePath = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`${base}/#/covers`);
  await page.getByRole('heading', { name: 'Book covers', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Generate from my book', exact: true }).click();
  await page.getByRole('link', { name: 'Download PNG' }).waitFor();
  assert.equal(requests, 1);
  assert(lastPrompt.includes("The Tidekeeper's Ledger"));
  await page.getByLabel('Thumbnail check').check();
  assert.equal(await page.locator('.cover-preview img').evaluate(el => Math.round(el.getBoundingClientRect().width)), 100);
  await page.getByLabel('Author name').fill('A. Writer');
  await page.getByLabel('Art direction', { exact: true }).selectOption('printmaking');
  await page.getByLabel('Your creative direction').fill('Red ink, no faces');
  await page.getByLabel('Include title and author lettering').uncheck();
  await page.getByRole('button', { name: 'Generate with my direction' }).click();
  await page.locator('.cover-gallery button').nth(1).waitFor();
  assert.equal(requests, 2);
  assert(lastPrompt.includes('Red ink, no faces'));
  assert(lastPrompt.includes('No letters or text anywhere'));
  const href = await page.getByRole('link', { name: 'Download PNG' }).getAttribute('href');
  const downloaded = await originalFetch(`${base}${href}`);
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.match(downloaded.headers.get('content-disposition')!, /attachment/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), Buffer.from(png, 'base64'));
  await page.reload();
  await page.locator('.cover-gallery button').nth(1).waitFor();
  assert.equal(fs.readdirSync(path.join(dir, 'covers')).filter(f => f.endsWith('.png')).length, 2);
  const screenshot = path.join(os.tmpdir(), 'quillgon-covers-smoke.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`Cover flow passed: automatic and custom generation, persistence, preview, thumbnail and PNG download. Screenshot: ${screenshot}`);
} finally {
  globalThis.fetch = originalFetch;
  await browser.close();
  server.close();
}

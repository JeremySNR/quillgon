/**
 * Phase 7/8 acceptance in a real browser, driving the UI only (offline models):
 *  A. The phase 5 ripple scenario: change what Mara knows in s04 from the knowledge grid,
 *     review the ripple, accept one card and reject the other, accept a prose diff,
 *     apply the round, and confirm it was committed.
 *  B. A new book from the welcome screen through every Build gate to a reader run.
 *
 *   pnpm build && pnpm tsx scripts/e2e-ui.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-e2e-'));
process.env.NOVEL_OFFLINE = '1';
const { NovelServer } = await import('@novel/server');
const server = new NovelServer({ staticDir: path.resolve(here, '..', 'apps', 'desktop', 'dist') });
const base = `http://127.0.0.1:${await server.listen(0)}`;
const api = async (p: string) => (await fetch(`${base}/api${p}`)).json() as Promise<any>;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
page.on('console', (m) => process.env.DBG && console.log('    console:', m.type(), m.text().slice(0, 200)));
page.on('response', async (q) => process.env.DBG && q.url().includes('/api/') && !q.url().includes('/events') && console.log('    res', q.request().method(), q.url().split('/api')[1], q.status()));
const step = (s: string) => console.log(`  ✓ ${s}`);
const until = async (fn: () => Promise<boolean>, what: string, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`timed out waiting for ${what}`);
};

try {
  // ---------------------------------------------------------------- A
  console.log('A. Ripple scenario in the UI');
  await page.goto(base);
  await page.getByRole('button', { name: 'Open the sample novella' }).click();
  await page.getByRole('heading', { name: "The Tidekeeper's Ledger" }).waitFor();
  step('opened the sample from the welcome screen');

  await page.goto(`${base}/#/characters/mara`);
  const row = page.locator('table.matrix tr', { hasText: 'Eliza Trevaskis holds the debts' });
  await row.getByRole('button', { name: 'Forget at s04' }).click();
  await page.getByText('2 scenes affected').waitFor();
  step('cleared a square in Mara’s knowledge grid; impact toast shows 2 scenes');
  await page.getByRole('button', { name: 'Review ripple' }).click();
  await page.getByText('2 affected scenes').waitFor();
  step('ripple review opened with 2 affected scenes');

  await page.getByRole('button', { name: /Review 2 scenes/ }).click();
  await until(async () => (await page.getByRole('option').filter({ hasText: 'Proposed' }).count()) === 2, 'proposals');
  await until(async () => (await page.locator('.review').getAttribute('data-busy')) === '', 'review to settle');
  step('reviser proposed card changes for both');

  await page.getByRole('option').filter({ hasText: 's06' }).click();
  await page.getByRole('button', { name: /^Accept/ }).first().waitFor();
  await page.waitForTimeout(300);
  if (process.env.DBG) console.log('    state:', await page.evaluate(() => JSON.stringify((document.querySelector('.review') as HTMLElement)?.dataset)));
  if (process.env.DBG) console.log('    active:', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  await page.keyboard.press('a');
  await page.getByText('Card accepted.').waitFor();
  await page.getByRole('option').filter({ hasText: 's11' }).click();
  await page.getByRole('button', { name: /^Reject/ }).click();
  await page.getByText('Card rejected').waitFor();
  step('accepted s06 (keyboard) and rejected s11 individually');

  await page.getByRole('option').filter({ hasText: 's06' }).click();
  await page.getByRole('button', { name: 'Revise the prose' }).click();
  await page.getByRole('button', { name: /Accept prose/ }).waitFor();
  if (!(await page.locator('.prose-diff del').count())) throw new Error('expected a prose diff with deletions');
  await page.getByRole('button', { name: /Accept prose/ }).click();
  await page.getByText('Prose accepted.').waitFor();
  step('reviewed and accepted the prose diff for s06');

  await page.getByRole('button', { name: /Apply round 1/ }).click();
  await page.getByText('Ripple complete').waitFor();
  const hist = await api('/history?limit=3');
  if (!hist[0].message.startsWith('Ripple round 1')) throw new Error(`last commit was "${hist[0].message}"`);
  const s06 = await api('/scenes/s06');
  if (s06.sync.state !== 'in_sync') throw new Error(`s06 is ${s06.sync.state}`);
  step(`round applied and committed: "${hist[0].message.split('\n')[0]}"`);

  // ---------------------------------------------------------------- B
  console.log('B. A new book through every gate in the UI');
  await page.evaluate(() => fetch('/api/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: '~/Novels/Glasshouse', title: 'The Glasshouse', target_words: 12000, offline: true }) }));
  await page.goto(`${base}/#/build`);
  await page.getByPlaceholder(/harbourmaster drowns/).fill('A glasshouse whose orchids are watered every night, though the house has been empty for a year.');
  await page.getByRole('button', { name: 'Show me ideas' }).click();
  await until(async () => (await page.locator('article.idea').count()) > 3, 'ideas');
  await page.locator('article.idea').first().getByRole('button', { name: 'Keep' }).click();
  await until(async () => (await page.getByRole('button', { name: /Kept · 1/ }).count()) === 1, 'one kept idea');
  await page.locator('.rung').first().getByRole('button', { name: 'Draft options' }).click();
  await page.locator('.option-card').first().click();
  await page.getByRole('button', { name: 'Use this premise' }).click();
  await page.getByPlaceholder(/Cornwall, 1926/).waitFor();
  step('idea: diverged, kept an idea, chose a logline, handed it to the intent');
  await page.getByPlaceholder(/Cornwall, 1926/).fill('When Ines Varga inherits her grandmother’s glasshouse, she finds the orchids are watered every night by someone. Her neighbour Teo says the house has been empty for a year.');
  await page.getByRole('button', { name: 'Ask me what you need to know' }).click();
  const answers = page.locator('.card textarea:not(.prose)');
  await answers.first().waitFor();
  const n = await answers.count();
  for (let i = 0; i < n; i++) await answers.nth(i).fill(['grief and inheritance', 'Bittersweet', 'Never explain the watering.', 'Hushed and humid'][i] ?? 'Yes');
  await page.getByRole('button', { name: 'Draft the intent' }).click();
  await page.getByRole('button', { name: 'Approve and continue' }).click();
  await page.getByRole('heading', { name: 'Pin what must happen' }).waitFor();
  step('intent: interview answered, intent approved');

  await page.getByPlaceholder(/Jory confesses/).fill('Ines finds the watering can still wet at dawn');
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await page.getByRole('button', { name: /Propose the turning points/ }).click();
  await page.getByRole('heading', { name: 'Proposed turning points' }).waitFor();
  while (await page.getByRole('button', { name: 'Accept', exact: true }).count()) {
    await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
    await page.waitForTimeout(150);
  }
  await page.getByRole('button', { name: 'Continue to structure' }).click();
  step('plot points: pinned one, accepted the proposals');

  await page.getByRole('button', { name: 'Propose three structures' }).click();
  await until(async () => (await page.locator('article.alt').count()) === 3, 'three structures');
  await page.getByRole('button', { name: 'Critique them first' }).click();
  await until(async () => (await page.locator('.alt-critique').count()) === 3, 'a critique of each structure');
  await page.locator('article.alt').nth(1).getByRole('button', { name: 'Pick this one' }).click();
  await page.getByText('Two ways to tell this chapter').waitFor();
  step('structure: three alternatives shown and critiqued, picked the unexpected one');

  await page.getByRole('button', { name: 'Propose two beat sequences' }).click();
  await until(async () => (await page.locator('article.alt').count()) === 2, 'two beat sequences');
  await page.locator('article.alt').nth(0).getByRole('button', { name: 'Pick this one' }).click();
  await page.getByRole('button', { name: 'Use defaults for the rest' }).click();
  await page.getByRole('heading', { name: 'Write the scenes' }).waitFor();
  step('cards: picked one chapter, defaulted the rest');

  await page.getByRole('button', { name: /Write all/ }).click();
  await page.getByRole('button', { name: 'Continue to review' }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await page.getByRole('button', { name: 'Run the first reader' }).click();
  await page.getByRole('heading', { name: 'Reader report' }).waitFor();
  await page.locator('svg.chart').waitFor();
  const proj = await api('/project');
  if (proj.book.stage !== 'complete') throw new Error(`stage is ${proj.book.stage}`);
  if (proj.totals.bySync.in_sync !== proj.totals.scenes) throw new Error('not every scene is in sync');
  step(`prose written (${proj.totals.scenes} scenes, all in sync) and the reader report rendered`);
  await page.screenshot({ path: path.resolve(here, '..', 'docs', 'screenshots', 'e2e-final.png') });
} catch (e) {
  await page.screenshot({ path: path.join(os.tmpdir(), 'e2e-failure.png') });
  if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
  console.error(`✗ ${(e as Error).message}\n  screenshot: ${path.join(os.tmpdir(), 'e2e-failure.png')}`);
  process.exitCode = 1;
}
if (errors.length) (console.error('Page errors:\n' + errors.join('\n')), (process.exitCode = 1));
await browser.close();
server.close();
process.exit(process.exitCode ?? 0);

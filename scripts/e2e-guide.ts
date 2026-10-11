/**
 * A guide and its research in a real browser, driving the UI only (offline models):
 *  A. Start a guide (coaching) from the welcome screen: its own sidebar and opening questions.
 *  B. Research offline: the author's own notes read (facts quoted exactly, a question raised and
 *     sent to the next session); a run that stays on this computer; the shelf (a comparable
 *     book kept, how this one differs).
 *  C. An interview: a lesson filed by its parts on the lesson ladder.
 *  D. Shaping and drafting: guide shapes, chapters proposed and adopted, a chapter drafted with
 *     a gap for the missing example and a sum that does not add up flagged.
 *     An AI-writing habit typed into the draft is underlined and cleaned up from the style panel.
 *  E. Before you publish: the sum listed, a note to the reader; the guide's settings.
 *
 *   pnpm build && pnpm tsx scripts/e2e-guide.ts [screenshot-dir]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromePath } from './browser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-guide-'));
process.env.QUILLGON_OFFLINE = '1';
const shots = process.argv[2];
const { NovelServer } = await import('@quillgon/server');
const server = new NovelServer({ staticDir: path.resolve(here, '..', 'apps', 'desktop', 'dist') });
const base = `http://127.0.0.1:${await server.listen(0)}`;
const browser = await chromium.launch({ executablePath: chromePath() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
const step = (s: string) => console.log(`  ✓ ${s}`);
const shot = async (name: string) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }));
const bookDir = path.join(process.env.HOME, 'Books', 'Close-More');
const nav = (label: string) => page.locator('nav .nav-item', { hasText: label });

try {
  console.log('A. A new guide');
  await page.goto(base);
  await page.getByRole('radio', { name: /A guide/ }).click();
  await page.getByRole('button', { name: 'Coaching or sales' }).click();
  await page.getByLabel('Who is it for?').fill('New B2B sales reps who freeze on the follow-up call');
  await page.getByLabel('What will they be able to do after reading it?').fill('Book twice as many second meetings');
  await page.getByLabel('Your name').fill('Sam Reed');
  await page.getByLabel('Title').fill('Close More');
  await page.getByLabel('Models').selectOption('offline');
  await shot('welcome-guide');
  await page.getByRole('button', { name: 'Create book' }).click();
  await page.getByRole('heading', { name: 'Sessions', exact: true }).waitFor();
  await nav('Research').waitFor();
  await nav('Before you publish').waitFor();
  if (await nav('Timeline').count()) throw new Error('a guide should have no timeline');
  await page.getByText('Who is this book for?').waitFor();
  step('created a guide: Sessions, Research and Before you publish in the sidebar, no timeline; reader questions queued');

  console.log('B. Research');
  await nav('Research').click();
  await page.getByRole('heading', { name: 'Research', exact: true }).waitFor();
  await page.getByText(/Offline: nothing leaves this computer/).waitFor();
  step('offline research says nothing leaves this computer');
  await page.getByRole('button', { name: /Your material/ }).click();
  await page.getByLabel('Name').fill('course notes');
  await page.getByLabel('Material').fill('# The five-touch plan\n\nI call five times over 14 days before I let a lead go.\n\nMost buyers ask about price within the first 10 minutes of a call.');
  await page.getByRole('button', { name: 'Add and read it' }).click();
  await page.getByText('course-notes.md').waitFor();
  step('read the author’s own notes');
  await page.getByRole('button', { name: /^Evidence/ }).click();
  await page.getByText('I call five times over 14 days before I let a lead go.').first().waitFor();
  await page.getByText('Quote found in your file').first().waitFor();
  step('facts quoted exactly from the notes, each checked');
  await page.getByRole('button', { name: /^Questions/ }).click();
  await page.getByText(/Your notes cover "The five-touch plan"/).waitFor();
  await page.getByRole('button', { name: 'Ask me in a session' }).first().click();
  await page.getByText('Added to your next session').waitFor();
  step('a question from the notes was sent to the next session');
  await page.locator('.research-run').getByRole('button', { name: 'Research' }).click();
  await page.getByText(/Research done/).waitFor();
  await page.getByRole('button', { name: 'Runs' }).click();
  await page.locator('.list-item', { hasText: 'Quick' }).first().click();
  await page.getByText(/Offline: nothing leaves this computer/).nth(1).waitFor();
  step('an offline run finished without touching the network, and its log is kept');

  // A comparable book, as a live run would have filed it.
  // Past the server's quiet window after its own writes, so the watcher picks the edit up.
  await page.waitForTimeout(1500);
  const lib = path.join(bookDir, 'research', 'library.yaml');
  const yaml = fs.readFileSync(lib, 'utf8');
  fs.writeFileSync(
    lib,
    yaml.replace(
      /^comps: \[\]$/m,
      'comps:\n  - id: comp-follow-up-book\n    title: The Follow-Up Book\n    authors: [J. Smith]\n    year: "2015"\n    promise: Win more deals by following up.\n    framework: The five-touch plan\n    structure: Short chapters, a script in each\n    praise: [practical]\n    complaints: [US examples only]',
    ),
  );
  for (let i = 0; i < 20 && !(await page.getByText('The Follow-Up Book').count()); i++) {
    await page.waitForTimeout(500);
    await page.reload();
    await page.getByRole('button', { name: /The shelf/ }).click();
  }
  await page.getByText('The Follow-Up Book').waitFor();
  await page.getByText('− US examples only').waitFor();
  await page.getByLabel('How yours differs').fill('Mine is for UK reps, with British scripts.');
  await page.getByRole('button', { name: 'Keep' }).click();
  await page.locator('.comp-card .badge', { hasText: 'Kept' }).waitFor();
  if (!/Mine is for UK reps/.test(fs.readFileSync(lib, 'utf8'))) throw new Error('difference not saved');
  step('the shelf: a comparable book with what readers dislike, kept, with how this one differs');
  await shot('research-shelf');

  console.log('C. An interview');
  await nav('Sessions').click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('.gw-turn').first().waitFor();
  await page
    .getByLabel('Your answer')
    .fill('The third call is where deals are won. First, you open with what changed since last time. Then you ask one question about their deadline. Most people give up after two calls. It works because buyers are busy, not uninterested. Call fifty leads five times each: 20% of 50 is 12 meetings.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.ladder li.yes', { hasText: 'The steps' }).waitFor();
  await page.locator('.ladder li', { hasText: 'A real case' }).waitFor();
  if (await page.locator('.ladder li', { hasText: 'Who was there' }).count()) throw new Error('a lesson should not show memoir rungs');
  step('the answer was filed as a lesson: idea, steps, mistakes, why it works');
  await page.locator('.gw-text', { hasText: 'last time you used it' }).waitFor();
  step('the next question asks for a real case');
  await shot('guide-session');
  await page.getByRole('button', { name: 'End session' }).click();
  await page.locator('.session-summary').waitFor();

  console.log('D. Shaping and drafting');
  await nav('Shaping the book').click();
  await page.getByRole('radio', { name: /Framework/ }).waitFor();
  await page.getByRole('radio', { name: /Problem by problem/ }).waitFor();
  await page.getByRole('button', { name: 'Propose chapters' }).click();
  await page.getByText('Proposed: Framework').waitFor();
  await page.getByRole('button', { name: 'Use these chapters' }).click();
  const row = page.locator('.trow', { hasText: 'The third call' });
  await row.getByRole('button', { name: /Draft (it|anyway)/ }).click();
  await row.getByRole('button', { name: 'Open draft' }).waitFor({ timeout: 20000 });
  await row.getByRole('button', { name: 'Open draft' }).click();
  await page.locator('.notes-pane').waitFor();
  await page.locator('.notes-pane .badge', { hasText: 'No example' }).waitFor();
  await page.locator('.notes-pane .badge', { hasText: 'Sum' }).waitFor();
  await page.locator('.note-text', { hasText: /comes to 10, not 12/ }).waitFor();
  step('drafted: a gap where the example should be, and 20% of 50 flagged (10, not 12)');
  await shot('guide-draft');

  // An AI-writing habit typed into the draft is underlined, and cleaned up from the style panel.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nIt wasn’t the price. It was the timing.');
  await page.locator('.cm-tell').first().waitFor();
  step('an AI habit typed into the draft is underlined');
  await page.locator('.style-chip').click();
  await page.getByRole('button', { name: /Clean up 1 AI habit/ }).click();
  await page.getByText(/AI habits: 1 → 0/).waitFor();
  await page.waitForTimeout(400);
  await shot('ai-habits');
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.waitForFunction(() => {
    const t = document.querySelector('.cm-content')?.textContent ?? '';
    return !t.includes('wasn’t the price') && t.includes('It was the timing.');
  });
  step('cleaned up: the staged contrast is gone, the point kept');

  console.log('E. Before you publish');
  await nav('Before you publish').click();
  await page.getByRole('heading', { name: 'Before you publish' }).waitFor();
  await page.locator('.share-section', { hasText: 'Figures, advice and sums' }).getByText(/20% of 50 is 12/).waitFor();
  await page.getByText('A note to the reader').waitFor();
  await page.locator('textarea[aria-label="Author\'s note"]').waitFor();
  const note = await page.locator('textarea[aria-label="Author\'s note"]').inputValue();
  if (!/comes from my own work/.test(note)) throw new Error(`unexpected note: ${note}`);
  step('the sum is listed before publishing; the note to the reader is written from the guide');
  await shot('guide-publish');
  await page.locator('.nav-item[title="Settings"]').click();
  await page.getByRole('heading', { name: 'Guide' }).waitFor();
  await page.getByLabel('Your method, if it has a name').fill('The third-call close');
  await page.getByRole('heading', { name: 'Guide' }).locator('xpath=ancestor::div[contains(@class,"card")]').getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);
  if (!/third-call close/.test(fs.readFileSync(path.join(bookDir, 'book.yaml'), 'utf8'))) throw new Error('guide settings not saved');
  step('the guide’s settings saved');

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('\nGuide e2e passed.');
} catch (e) {
  await page.screenshot({ path: path.join(os.tmpdir(), 'e2e-guide-failure.png') }).catch(() => undefined);
  console.error(`\n✗ ${(e as Error).message}\n  screenshot: ${path.join(os.tmpdir(), 'e2e-guide-failure.png')}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}

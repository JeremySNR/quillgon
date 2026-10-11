/**
 * Life stories in a real browser, driving the UI only (offline models, a fake microphone):
 *  A. Start a life story from the welcome screen for someone else's life.
 *  B. An interview session: the agenda, typed and spoken answers (the spoken one kept as a
 *     recording), a story filed with its ladder, "That's all I remember", undo, end.
 *  C. Shaping the book: chapters proposed from the stories and adopted; a chapter drafted from
 *     its stories with margin notes; a gap answered in the editor.
 *  D. A revision round: feedback in the author's words, the plan read back, a change reviewed
 *     and applied; the gap filled, "whilst" a rule for the whole book; the chapter approved.
 *
 *   pnpm build && pnpm tsx scripts/e2e-life.ts [screenshot-dir]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromePath } from './browser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ne-life-'));
process.env.QUILLGON_OFFLINE = '1';
process.env.QUILLGON_OFFLINE_TRANSCRIPT = 'Um, the machines were so loud you could not hear yourself think.';
const shots = process.argv[2];
const { NovelServer } = await import('@quillgon/server');
const server = new NovelServer({ staticDir: path.resolve(here, '..', 'apps', 'desktop', 'dist') });
const base = `http://127.0.0.1:${await server.listen(0)}`;
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
const step = (s: string) => console.log(`  ✓ ${s}`);
const shot = async (name: string) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }));
const bookDir = path.join(process.env.HOME, 'Books', 'Harehills');

try {
  console.log('A. A new life story');
  await page.goto(base);
  await page.getByRole('radio', { name: /A life story/ }).click();
  await page.getByRole('button', { name: 'Someone else’s' }).click();
  await page.getByLabel('Their name').fill('Margaret Ellis');
  await page.getByLabel('Title').fill('Harehills');
  await page.getByLabel('Models').selectOption('offline');
  await shot('welcome-life');
  await page.getByRole('button', { name: 'Create book' }).click();
  await page.getByRole('heading', { name: 'Sessions', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Shaping the book' }).waitFor();
  step('created a life story; the sidebar shows Sessions and Shaping the book');
  await page.getByText('If your life were a book').waitFor();
  step('the opening questions are queued');
  await shot('sessions-start');

  console.log('B. An interview session');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('.gw-text', { hasText: 'If your life were a book' }).waitFor();
  step('the session opened with an agenda and the first question');
  await page.getByLabel('Your answer').fill("In 1962 I started at Burton's on Hudson Road. Jean Pickles sat next to me and showed me the felling.");
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('New person: Jean Pickles').waitFor();
  await page.locator('.ladder li.yes', { hasText: 'What happened' }).waitFor();
  step('the answer was filed: a new person, a story on the ladder');

  await page.getByRole('button', { name: 'Talk' }).click();
  await page.getByRole('button', { name: 'Stop dictating' }).waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop dictating' }).click();
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Your answer"]') as HTMLTextAreaElement)?.value.includes('machines were so loud'));
  step('a spoken answer landed in the box, tidied');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.author-turn audio').first().waitFor();
  step('the recording was kept with the answer');
  await shot('session');

  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(400);
  step('undid what the last answer filed');
  await page.getByRole('button', { name: 'That’s all I remember' }).click();
  await page.locator('.gw-text', { hasText: 'That’s fine.' }).waitFor();
  step('"That’s all I remember" moved on');
  await page.getByRole('button', { name: 'End session' }).click();
  await page.locator('.session-summary').waitFor();
  step('ended the session with a summary');
  const rec = fs.readdirSync(path.join(bookDir, 'audio', 'session-1'));
  if (!rec.length) throw new Error('no recording kept');
  if (fs.readFileSync(path.join(bookDir, '.gitignore'), 'utf8').indexOf('audio/') < 0) throw new Error('audio not git-ignored');
  step(`recording on disk (${rec.length}), audio/ kept out of git`);

  console.log('C. Shaping and drafting');
  // A second session gives the book a story with a date and a place.
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.locator('.gw-turn').first().waitFor();
  // The session opens on the story from last time; move on to a new one.
  await page.getByRole('button', { name: 'Move on' }).click();
  await page.locator('.gw-text', { hasText: 'That’s fine.' }).waitFor();
  await page.getByLabel('Your answer').fill('In 1955 we went to Scarborough on the train with Mum and Dad. Peter Ellis was sick on the way home.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.ladder-card').waitFor();
  await page.getByRole('button', { name: 'End session' }).click();
  await page.locator('.session-summary').waitFor();
  await page.locator('nav .nav-item', { hasText: 'Shaping the book' }).click();
  await page.getByRole('heading', { name: 'Shaping the book' }).waitFor();
  await page.getByRole('button', { name: 'Propose chapters' }).click();
  await page.getByText('Proposed: Chronological').waitFor();
  await page.getByRole('button', { name: 'Use these chapters' }).click();
  await page.locator('.trow .c1', { hasText: 'The 1950s' }).waitFor();
  step('chapters proposed by decade and adopted');
  await shot('shaping');
  const row = page.locator('.trow', { hasText: 'The 1950s' });
  await row.getByRole('button', { name: /Draft (it|anyway)/ }).click();
  await row.getByRole('button', { name: 'Open draft' }).waitFor({ timeout: 20000 });
  step('drafted the chapter; it is waiting on the author’s notes');
  await row.getByRole('button', { name: 'Open draft' }).click();
  await page.locator('.notes-pane').waitFor();
  await page.locator('.cm-gap').first().waitFor();
  step('the draft opened with margin notes and its gap marked in the text');
  await shot('draft-notes');
  const gap = page.locator('.note-card', { hasText: 'Where did this happen?' });
  await gap.getByLabel('Your answer').fill('On the front at Scarborough, by the harbour');
  await gap.getByRole('button', { name: 'Answer' }).click();
  await page.locator('.note-card', { hasText: 'Where did this happen?' }).waitFor({ state: 'detached' });
  step('answered the gap');

  console.log('D. A revision round');
  await page.getByLabel('What to change').fill("I'd never say whilst.");
  await page.getByRole('button', { name: 'Revise' }).click();
  await page.getByRole('heading', { name: /what I’ll change/ }).waitFor();
  await page.getByText('Rule for the book').waitFor();
  step('the ghostwriter read back a plan: an edit and a rule for the book');
  await shot('revision');
  await page.locator('.change-block').first().getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('button', { name: 'Apply the round' }).click();
  await page.locator('.notes-pane').waitFor();
  await page.waitForFunction(() => !document.querySelector('.cm-content')?.textContent?.includes('[TK:'));
  step('applied: the gap is filled with the answer');
  const sheet = fs.readFileSync(path.join(bookDir, 'style', 'style.yaml'), 'utf8');
  if (!/whilst/.test(sheet)) throw new Error('rule not in the style sheet');
  step('"whilst" is now a never-word for the whole book');
  await page.locator('nav .nav-item', { hasText: 'Shaping the book' }).click();
  const r1950 = page.locator('.trow', { hasText: 'The 1950s' });
  await r1950.getByRole('button', { name: 'Approve' }).click();
  await r1950.getByText('Signed off').waitFor();
  step('the chapter is signed off');
  await shot('shaping-approved');

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('\nLife story e2e passed.');
} catch (e) {
  await shot('failure');
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

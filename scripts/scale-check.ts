/**
 * Scale check: grows the sample novella to novel length and reports how big each agent's
 * prompt gets and how long store writes take. Context that grows with the book (rather
 * than with the scene) is what makes an 80,000-word draft slow and expensive.
 *
 *   pnpm scale-check            # 96 scenes (8 copies of the sample), 400 extra facts
 *   pnpm scale-check --copies 4 # smaller
 *   pnpm scale-check --json     # machine-readable
 *   pnpm scale-check --max-prompt 8000   # exit 1 if any prompt at the last scene is bigger (CI)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, extractInput, GraphStore, readerWindow, reviseCardInput, sceneOrder, writerContext } from '@quillgon/core';
import { OfflineSuite } from '@quillgon/agents';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const copies = arg('copies', 8);
const extraFacts = arg('facts', 400);
const json = process.argv.includes('--json');
const maxPrompt = arg('max-prompt', 0);
const tokens = (x: unknown) => Math.round((typeof x === 'string' ? x : JSON.stringify(x)).length / 4);

// ---------------------------------------------------------------- build a long book
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-scale-'));
fs.cpSync(path.resolve(here, '..', 'fixtures', 'novella'), dir, { recursive: true, filter: (s) => !s.includes(`${path.sep}.engine`) });
const store = GraphStore.open(dir, { memoryIndex: true });
const st = structuredClone(store.project.structure);
let n = 100;
for (let k = 1; k < copies; k++) {
  const act = { id: `act-x${k}`, title: `Act ${k + 1}`, chapters: [] as typeof st.acts[number]['chapters'] };
  for (const ch of st.acts.flatMap((a) => a.chapters).filter((c) => !c.id.includes('-x'))) {
    const scenes: string[] = [];
    for (const sid of ch.scenes) {
      const s = store.scene(sid);
      const id = `s${n++}`;
      store.saveCard({ ...s.card, id, title: `${s.card.title} (${k + 1})` });
      if (s.prose) store.saveProse(id, s.prose.body, 'generated');
      scenes.push(id);
    }
    act.chapters.push({ ...ch, id: `${ch.id}-x${k}`, scenes });
  }
  st.acts.push(act);
}
store.saveStructure(st);
// A long book accumulates facts: every extraction can add to the glossary.
store.addFacts(Array.from({ length: extraFacts }, (_, i) => ({ id: `fact-${i}`, statement: `Synthetic fact number ${i} about the harbour, the ledger and the tide tables.` })));
store.saveStyle({ samples: store.project.style.samples.repeat(Math.max(1, Math.ceil(20000 / Math.max(1, store.project.style.samples.length)))).slice(0, 20000), banned: store.project.style.banned.map((b) => b.source).join('\n') });

const p = store.project;
const order = sceneOrder(p);
const words = order.reduce((w, s) => w + (p.scenes.get(s)!.prose?.meta.word_count ?? 0), 0);
const last = order[order.length - 1];
const first = order[1];

// ---------------------------------------------------------------- prompt sizes
const engine = new Engine(store, new OfflineSuite());
const cardsInputFor = (ch: string) => engine.pipeline.cardsInput(ch);
const chapters = engine.pipeline.chapters();
const reviseCard = (sid: string) => reviseCardInput(p, sid, 'Mara no longer knows who holds the debts.', ['she speaks of it here']);
// The reader's input at scene i, as runReader builds it: one log entry per scene read so far.
const logEntry = { scene: 's01', believes: 'x'.repeat(240), expects: 'x'.repeat(160), confusions: [], resolved_confusions: [], engagement: 3, predictions: ['x'.repeat(80)], fairness: null };
const readerAt = (i: number) => {
  const { recent, earlier } = readerWindow(Array.from({ length: i }, () => logEntry));
  return { prose: p.scenes.get(order[i])!.prose?.body ?? '', log: recent, earlier };
};

const rows = [
  { prompt: 'writer', early: tokens(writerContext(p, first, store.index)), late: tokens(writerContext(p, last, store.index)) },
  { prompt: 'extractor', early: tokens(extractInput(store, first)), late: tokens(extractInput(store, last)) },
  { prompt: 'planner (cards)', early: tokens(cardsInputFor(chapters[1].id)), late: tokens(cardsInputFor(chapters[chapters.length - 1].id)) },
  { prompt: 'reviser (card)', early: tokens(reviseCard(first)), late: tokens(reviseCard(last)) },
  { prompt: 'reader', early: tokens(readerAt(1)), late: tokens(readerAt(order.length - 1)) },
];
const readerTotal = order.reduce((t, _s, i) => t + tokens(readerAt(i)), 0);

// ---------------------------------------------------------------- write latency
const time = (fn: () => void, times = 10) => {
  const t = performance.now();
  for (let i = 0; i < times; i++) fn();
  return Math.round(((performance.now() - t) / times) * 10) / 10;
};
const card = store.scene(last).card;
const saveCardMs = time(() => store.saveCard({ ...card, purpose: card.purpose + ' ' }));
const t0 = performance.now();
await engine.pipeline.writeScene(order[order.length - 2], { commit: false });
const writeSceneMs = Math.round(performance.now() - t0);

const result = { scenes: order.length, words, facts: p.factGlossary.facts.length, prompts: rows, reader_run_tokens: readerTotal, save_card_ms: saveCardMs, write_scene_offline_ms: writeSceneMs };
store.close();
fs.rmSync(dir, { recursive: true, force: true });

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Book: ${result.scenes} scenes, ${result.words.toLocaleString()} words, ${result.facts} facts\n`);
  console.log('Prompt size (approx. tokens)   2nd scene    last scene');
  for (const r of rows) console.log(`  ${r.prompt.padEnd(28)} ${String(r.early).padStart(9)} ${String(r.late).padStart(13)}`);
  console.log(`\nReader run, whole book:        ${readerTotal.toLocaleString()} input tokens`);
  console.log(`Store write (save a card):     ${saveCardMs} ms`);
  console.log(`Write one scene (offline):     ${writeSceneMs} ms`);
}

const over = maxPrompt ? rows.filter((r) => r.late > maxPrompt) : [];
if (over.length) {
  console.error(`\nPrompt budget exceeded (${maxPrompt} tokens): ${over.map((r) => `${r.prompt} ${r.late}`).join(', ')}`);
  process.exit(1);
}

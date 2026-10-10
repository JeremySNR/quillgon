import { describe, expect, it } from 'vitest';
import { BUDGET, estimate, extractInput, readerWindow, relevantFacts, sceneOrder, storySoFar, wordsPerScene, writerContext, type ReaderLogEntry } from '@quillgon/core';
import { fixtureEngine } from './helpers.js';

const entry = (scene: string, extra: Partial<ReaderLogEntry> = {}): ReaderLogEntry => ({ scene, believes: 'b', expects: 'e', confusions: [], resolved_confusions: [], engagement: 3, predictions: [], fairness: null, ...extra });

/** Prompts grow with the scene, not with the book. */
describe('context budgets', () => {
  it('a small glossary is sent whole; a large one is cut to what the task names and what is relevant', async () => {
    const { store } = await fixtureEngine();
    const p = store.project;
    expect(relevantFacts(p, { query: 'anything' })).toEqual(p.factGlossary.facts);
    store.addFacts(Array.from({ length: 300 }, (_, i) => ({ id: `noise-${i}`, statement: `Weather report ${i}: wind and rain over the moor.` })));
    const facts = relevantFacts(store.project, { must: ['walter-letter'], query: 'Eliza holds the debts of the boats' });
    expect(facts.length).toBe(BUDGET.facts);
    expect(facts.map((f) => f.id)).toEqual(expect.arrayContaining(['walter-letter', 'eliza-holds-debts']));
    // The extractor always sees the facts the scene's card and cast already carry.
    const ex = extractInput(store, 's06');
    expect(ex.facts.length).toBeLessThanOrEqual(BUDGET.facts);
    const card = store.scene('s06').card;
    for (const f of [...card.reveals, ...card.mentions.map((m) => m.fact)]) expect(ex.facts.map((x) => x.id)).toContain(f);
  });

  it("the writer gets the story so far, oldest chapters dropped first when it's long", async () => {
    const { store } = await fixtureEngine();
    const p = store.project;
    const last = sceneOrder(p).at(-1)!;
    const sofar = storySoFar(p, last);
    const chapters = p.structure.acts.flatMap((a) => a.chapters);
    expect(sofar).toContain(chapters[0].title);
    expect(writerContext(p, last, null).story_so_far).toBe(sofar);
    const short = storySoFar(p, last, 200);
    expect(short.length).toBeLessThanOrEqual(220);
    expect(short).toContain('earlier chapters omitted');
    expect(short).toContain(chapters.at(-2)!.title);
    expect(storySoFar(p, sceneOrder(p)[0])).toBe('');
  });

  it('long style samples are clipped for the writer', async () => {
    const { store } = await fixtureEngine();
    store.saveStyle({ samples: 'A paragraph of the voice.\n\n'.repeat(2000), banned: '' });
    expect(writerContext(store.project, 's03', null).style_samples.length).toBeLessThanOrEqual(BUDGET.styleSamples + 10);
  });

  it("the reader keeps the latest entries and only what still matters from older ones", () => {
    const log = Array.from({ length: 20 }, (_, i) => entry(`s${i}`, { predictions: i === 2 ? ['Eliza forged it'] : [], confusions: i === 3 ? [{ id: 'c1', text: 'who is Jory?' }] : i === 4 ? [{ id: 'c2', text: 'why the storm?' }] : [], resolved_confusions: i === 15 ? ['c2'] : [] }));
    const { recent, earlier } = readerWindow(log);
    expect(recent.map((e) => e.scene)).toEqual(['s14', 's15', 's16', 's17', 's18', 's19']);
    expect(earlier).toEqual({ scenes_read: 14, predictions: ['Eliza forged it'], open_confusions: [{ id: 'c1', text: 'who is Jory?' }] });
    expect(readerWindow(log.slice(0, 4)).earlier).toBeNull();
  });

  it('runs the reader with a bounded log', async () => {
    const seen: number[] = [];
    const { engine } = await fixtureEngine({
      read: async (i) => {
        seen.push(i.log.length);
        return { believes: 'b', expects: 'e', confusions: [], resolved_confusions: [], engagement: 3, predictions: [], fairness: null };
      },
    });
    await engine.reader({});
    expect(Math.max(...seen)).toBe(BUDGET.readerWindow);
    expect(seen).toHaveLength(12);
  });

  it('the planner and the writer agree on scene length', async () => {
    const { store, engine } = await fixtureEngine();
    const ch = engine.pipeline.chapters()[1];
    expect(engine.pipeline.cardsInput(ch.id).words_per_scene).toBe(wordsPerScene(store.project));
    expect(writerContext(store.project, ch.scenes[0], null).target_words).toBe(wordsPerScene(store.project));
  });

  it('numbers new scenes after the highest s<number>, ignoring suffixes', async () => {
    const { store, engine } = await fixtureEngine();
    store.saveCard({ ...store.scene('s04').card, id: 's04-2' });
    expect(engine.pipeline.cardsInput(engine.pipeline.chapters()[0].id).first_scene_number).toBe(13);
  });

  it('the estimate prices line edits, not whole-scene rewrites', async () => {
    const { store } = await fixtureEngine();
    const e = estimate(store.project);
    expect(e.lines.map((l) => l.stage)).not.toContain('humaniser');
    expect(e.lines.find((l) => l.stage === 'reader run')).toBeTruthy();
  });
});

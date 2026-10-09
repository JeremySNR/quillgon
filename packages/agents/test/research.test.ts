import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine, initProject, judgeBothWays, obligationIssues, runStylePasses, sceneOrder, type JudgeInput } from '@quillgon/core';
import { OfflineSuite, ScriptedSuite } from '../src/index.js';
import { fixtureEngine } from './helpers.js';

const base: JudgeInput = { task: 'Which is better?', criteria: [], a: 'one', b: 'two', reference: '' };

describe('judging both ways', () => {
  it('a judge that always prefers the first text produces a tie, not a winner', async () => {
    const agents = new ScriptedSuite({ judge: async () => ({ winner: 'a', reason: 'first' }) });
    expect((await judgeBothWays(agents, base)).winner).toBe('tie');
  });

  it('a judge that prefers the same text in both orders produces a winner', async () => {
    const agents = new ScriptedSuite({ judge: async (i) => ({ winner: i.a === 'two' ? 'a' : 'b', reason: 'two is better' }) });
    expect((await judgeBothWays(agents, base)).winner).toBe('b');
    expect(agents.count('judge')).toBe(2);
  });
});

describe('style repair rounds', () => {
  it('enforced violations are repaired by span edits and verified by code', async () => {
    const { store, engine } = await fixtureEngine();
    store.saveStyleSheet({ never: ['tapestry'], em_dashes: 'ban' });
    const prose = `${store.scene('s01').prose!.body}\n\nThe harbour was a tapestry of mooring lines — slack, all of them.`;
    const r = await runStylePasses(store, engine.agents, 's01', prose);
    expect(r.report.enforcedBefore).toBeGreaterThan(0);
    expect(r.report.enforcedAfter).toBe(0);
    expect(r.report.rounds[0].kept).toBe(true);
    expect(r.prose).not.toMatch(/tapestry|—/);
  });

  it('an edit that adds violations is thrown away, whatever the editor claims', async () => {
    const { store } = await fixtureEngine();
    store.saveStyleSheet({ never: ['tapestry'] });
    const agents = new ScriptedSuite({
      humanise: async ({ prose }) => ({ edits: [{ find: prose.slice(0, 20), replace: 'A tapestry, a tapestry. ', category: 'cliche', reason: 'trust me' }] }),
    });
    const prose = store.scene('s02').prose!.body;
    const r = await runStylePasses(store, agents, 's02', prose);
    expect(r.report.rounds[0]).toMatchObject({ kept: false, why: expect.stringMatching(/new style violations/) });
    expect(r.prose).toBe(prose.trim());
  });

  it('an edit that changes no enforced count must win a both-ways judge to be kept', async () => {
    const { store } = await fixtureEngine();
    const agents = new ScriptedSuite({
      humanise: async ({ prose }) => ({ edits: [{ find: prose.slice(0, 30), replace: prose.slice(0, 30).toUpperCase(), category: 'awkward-word-choice', reason: 'x' }] }),
      judge: async () => ({ winner: 'a', reason: 'position bias' }),
    });
    const prose = store.scene('s03').prose!.body;
    const r = await runStylePasses(store, agents, 's03', prose);
    expect(agents.count('judge')).toBe(2);
    expect(r.report.rounds[0]).toMatchObject({ kept: false, why: 'judge split: kept the original' });
  });
});

describe('idea → premise', () => {
  it('diverges across personas, puts the tail first, flags clichés, and hands over a premise and cast', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'book-')), 'spark');
    const store = await initProject(dir, { title: 'Spark', offline: true });
    expect(store.book.stage).toBe('idea');
    const engine = new Engine(store, new ScriptedSuite({
      diverge: async (i) => ({
        cliches: ['a lighthouse keeper with a secret'],
        candidates: [
          { kind: 'character', text: 'Elara, a keeper who hears the light sing', probability: 0.4, persona: i.persona },
          { kind: 'what-if', text: `What if the fog came in only when someone lied (${i.persona.slice(0, 12)})`, probability: 0.05, persona: i.persona },
          { kind: 'what-if', text: 'What if the fog came in only when someone lied', probability: 0.06, persona: i.persona },
        ],
      }),
    }));
    const I = engine.ideation;
    I.start('A lighthouse on an island where the fog knows things', 'literary');
    const b = await I.diverge({ personas: 2 });
    // Near-duplicates collapse; the stock name is flagged.
    expect(b.pile.filter((x) => x.text.startsWith('What if the fog')).length).toBeLessThan(4);
    expect(b.pile.find((x) => x.text.startsWith('Elara'))!.near_cliche).toBe('elara');
    expect(b.pile[0].probability).toBeLessThanOrEqual(b.pile[b.pile.length - 1].probability);
    I.mark(b.pile[0].id, 'kept');
    I.addOwn('The keeper’s log is written in two hands.');
    for (const step of ['logline', 'paragraph', 'synopsis'] as const) {
      const out = await I.expand(step);
      I.choose(step, out[`${step}_options`][0]);
    }
    await I.expand('cast');
    await I.finish();
    expect(store.book.stage).toBe('intent');
    expect(store.project.intent.premise).toContain(I.board.logline);
    expect(store.project.intent.notes).toMatch(/two hands/);
    expect([...store.project.characters.values()].every((c) => c.bio.want && c.bio.need)).toBe(true);
  });
});

describe('judging the plan before prose', () => {
  it('the predictability test flags a turn the model would have picked anyway', async () => {
    const { store, engine } = await fixtureEngine({
      sampleTurns: async () => ({
        turns: [
          { text: 'Jory confesses he forged the ledger storm entry; the truth and the beginning of forgiveness', probability: 0.7 },
          { text: 'A storm finally arrives', probability: 0.3 },
        ],
      }),
    });
    const r = await engine.predictability('s10');
    expect(r.verdict).toBe('predictable');
    expect(r.chosen).toContain(store.scene('s10').card.outcome);
  });

  it('an outline read runs before any prose and judges each twist from both sides', async () => {
    const { engine } = await fixtureEngine({
      read: async (i) => ({
        believes: '',
        expects: '',
        confusions: [],
        resolved_confusions: [],
        engagement: 3,
        predictions: i.scene_number === 3 ? ['Jory wrote the storm into the ledger himself'] : [],
        fairness: i.fairness_question ? (i.scene === 's11' ? 1 : 4) : null,
      }),
    });
    const r = await engine.reader({ mode: 'outline' });
    expect(r.mode).toBe('outline');
    const s10 = r.twists.find((t) => t.scene === 's10')!;
    expect(s10.verdict).toBe('guessable');
    expect(r.twists.find((t) => t.scene === 's11')!.verdict).toBe('unearned');
    expect(r.twists.find((t) => t.scene === 's09')!.verdict).toBe('good');
  });

  it('a generated book keeps its ledger: every planted setup is paid', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'book-')), 'ledger');
    const store = await initProject(dir, { title: 'Ledger', offline: true });
    const engine = new Engine(store, new OfflineSuite());
    await engine.pipeline.approveIntent({ premise: 'A keeper finds a second log.' });
    await engine.pipeline.proposePlotPoints();
    for (const pp of store.project.plotPoints.values()) engine.pipeline.acceptPlotPoint(pp.id);
    await engine.pipeline.proposeStructures();
    await engine.pipeline.pickStructure(0);
    await engine.pipeline.defaultCards();
    expect(store.project.obligations.size).toBeGreaterThan(0);
    for (const ch of engine.pipeline.chapters()) await engine.pipeline.writeChapter(ch.id);
    expect(obligationIssues(store.project)).toEqual([]);
    expect([...store.project.obligations.values()].every((o) => o.status === 'paid')).toBe(true);
    expect(sceneOrder(store.project).every((s) => store.scene(s).facts)).toBe(true);
  });
});

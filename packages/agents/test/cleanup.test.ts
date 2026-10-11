import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine, EMPTY_LADDER, findTells, initProject, vetEdits, type AgentSuite, type GhostDraftOutput } from '@quillgon/core';
import { ScriptedSuite } from '../src/index.js';
import { fixtureEngine } from './helpers.js';

const full = { ...EMPTY_LADDER, happened: 'yes', instance: 'yes', people: 'yes', senses: 'yes', words: 'yes', felt_then: 'yes', means_now: 'some' } as const;
const strong = (t: string) => findTells(t, { kind: 'true' }).filter((x) => x.strength === 'strong');

async function lifeBook(overrides: Partial<AgentSuite>) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-')), 'book');
  const store = await initProject(dir, { title: 'Harehills', kind: 'life-story', subject_name: 'Margaret Ellis', offline: true });
  store.saveStory({
    id: 'the-belt',
    title: 'The belt',
    when: '1962',
    place: "Burton's",
    ladder: full,
    details: [{ text: 'The belt came off the big machine with a crack like a gun', from: null }, { text: 'Everybody stopped working and stared at the machine' }],
    quotes: [{ text: "Don't you dare cry in front of him, love.", who: '', from: null }],
  });
  const engine = new Engine(store, new ScriptedSuite(overrides));
  await engine.life.proposeShape();
  const [ch] = await engine.life.acceptShape();
  return { store, engine, ch };
}

const draft = (prose: string): AgentSuite['ghostDraft'] => async (i) => ({ scenes: [{ title: 'The belt', stories: [i.stories[0].id], when: '1962', place: "Burton's", people: [], then: '', now: '', prose, notes: [] }], needs_decision: [] }) as GhostDraftOutput;

describe('every draft is cleaned of AI-writing habits', () => {
  it('a life-story chapter loses its staged contrasts and "-ing" riders, and keeps every quoted word', async () => {
    const prose = "The belt came off the big machine with a crack like a gun, highlighting how dangerous the work was. Everybody stopped working and stared at the machine. It wasn't the noise. It was the silence after it. Jean leaned over: “Don't you dare cry in front of him, love.”";
    const { store, engine, ch } = await lifeBook({ ghostDraft: draft(prose) });
    expect(strong(prose).length).toBeGreaterThanOrEqual(2);
    const [sid] = await engine.life.draftChapter(ch.id);
    const out = store.project.scenes.get(sid)!.prose!.body;
    expect(out).not.toMatch(/highlighting/);
    expect(out).not.toMatch(/It wasn't the noise/);
    expect(out).toContain('It was the silence after it.');
    expect(out).toContain("Don't you dare cry in front of him, love.");
    expect(strong(out)).toEqual([]);
  });

  it('in a true book the line editor may cut or reword, never add or change what was said; a vague passage becomes a question', async () => {
    const prose = "Everybody stopped working and stared at the machine. It was a difficult day for everyone. Jean said: “Don't you dare cry in front of him, love.”";
    const { store, engine, ch } = await lifeBook({
      ghostDraft: draft(prose),
      humanise: async () => ({
        edits: [
          // Invents a sensory detail nobody gave.
          { find: 'stared at the machine.', replace: 'stared at the machine, the smell of hot oil and scorched leather filling the room.', category: 'lack-of-specificity', reason: 'add sensory detail' },
          // Tidies the quote.
          { find: "Don't you dare cry in front of him, love.", replace: 'Do not cry in front of him.', category: 'awkward-word-choice', reason: 'smoother' },
          // Adds a name and a figure.
          { find: 'It was a difficult day for everyone.', replace: 'Mr Hirst docked 40 workers that afternoon.', category: 'lack-of-specificity', reason: 'concrete' },
          // A plain cut: allowed.
          { find: ' for everyone', replace: '', category: 'unnecessary-exposition', reason: 'redundant' },
        ],
      }),
    });
    const [sid] = await engine.life.draftChapter(ch.id);
    const out = store.project.scenes.get(sid)!.prose!.body;
    expect(out).toContain("Don't you dare cry in front of him, love.");
    expect(out).not.toMatch(/hot oil|Hirst|40/);
    expect(out).toContain('It was a difficult day.');
    const thin = store.project.scenes.get(sid)!.notes!.notes.filter((n) => n.kind === 'thin');
    expect(thin.map((n) => n.quote)).toEqual(expect.arrayContaining(['stared at the machine.']));
  });

  it('vetting refuses edits that add a habit, touch a gap, or bring in new words', () => {
    const text = 'We went home. [TK: the street] It rained.';
    const truth = { verbatim: [], material: ['We went home', 'It rained'] };
    const n = (t: string) => strong(t).length;
    const v = vetEdits(
      [
        { find: 'We went home.', replace: 'We went home, highlighting our exhaustion.', category: 'poor-sentence-structure', reason: '' },
        { find: '[TK: the street]', replace: 'Hudson Road.', category: 'lack-of-specificity', reason: '' },
        { find: 'It rained.', replace: 'It rained hard.', category: 'awkward-word-choice', reason: '' },
      ],
      text,
      truth,
      n,
    );
    expect(v.edits.map((e) => e.replace)).toEqual(['It rained hard.']);
    expect(v.refused.map((r) => r.why)).toEqual(['it adds an AI-writing habit', 'gaps are for the author to fill']);
    // In fiction, specificity is the line editor's job.
    expect(vetEdits([{ find: 'It rained.', replace: 'It rained on the tin roof of the bus shelter.', category: 'lack-of-specificity', reason: '' }], text, undefined, n).edits).toHaveLength(1);
  });

  it('a minimal regenerate and a ripple rewrite go through the same cleanup', async () => {
    const { store, engine } = await fixtureEngine({
      reviseProse: async (i) => ({ prose: `${i.old_prose}\n\nThe harbour serves as a reminder of everything Mara owed.`, summary: 'added a line', needs_decision: [] }),
    });
    const regen = await engine.pipeline.regenerate('s03', 'minimal');
    expect(regen.after).toContain('The harbour is a reminder');
    expect(regen.after).not.toMatch(/serves as/);
    expect(store.project.scenes.get('s03')).toBeDefined();
  });
});

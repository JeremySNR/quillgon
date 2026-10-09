import { describe, expect, it } from 'vitest';
import { applyExtraction, loadProject, runExtraction, scoreFacts, sceneOrder } from '@quillgon/core';
import { FIXTURE } from '../../core/test/helpers.js';
import { fixtureEngine, fixtureExtractor } from './helpers.js';

describe('phase 3: extractor', () => {
  it('scores extraction against the fixture facts', () => {
    const p = loadProject(FIXTURE).project;
    const expected = p.scenes.get('s05')!.facts!.facts;
    expect(scoreFacts(expected, expected).f1).toBe(1);
    const lossy = expected.slice(1);
    const s = scoreFacts(expected, lossy);
    expect(s.precision).toBe(1);
    expect(s.recall).toBeCloseTo((expected.length - 1) / expected.length);
    expect(s.missing).toHaveLength(1);
  });

  it('a faithful extractor reproduces every fixture scene at 90%+ and leaves the book in sync', async () => {
    const { store, agents, engine } = await fixtureEngine();
    agents; // scripted below
    const extract = fixtureExtractor(store);
    const reference = new Map(sceneOrder(store.project).map((id) => [id, structuredClone(store.scene(id).facts!.facts)]));
    let total = 0;
    for (const id of sceneOrder(store.project)) {
      const r = await runExtraction(store, { ...engine.agents, extract } as any, id);
      total += scoreFacts(reference.get(id)!, r.facts).f1;
      expect(r.contradictions).toEqual([]);
      expect(r.diff.graphLevel).toBe(false);
    }
    expect(total / 12).toBeGreaterThanOrEqual(0.9);
  });

  it('a deliberately contradictory scene is flagged, not silently accepted', async () => {
    const { store, engine } = await fixtureEngine();
    // The prose of s05 now has Mara miss the ink entirely; the extractor reports it.
    const contradictory = async () => ({
      facts: [{ subject: 'mara', predicate: 'located_at' as const, object: 'harbour-office', confidence: 0.9 }],
      states: [{ character: 'mara', learns: [], forgets: [], location: 'harbour-office', wants: null, feels: {}, alive: true }],
      timeline: [],
      new_facts: [],
      contradictions: [],
    });
    const r = await runExtraction(store, { ...engine.agents, extract: contradictory } as any, 's05');
    expect(r.contradictions.map((c) => c.field)).toEqual(expect.arrayContaining(['deltas.mara.learns', 'reveals']));
    applyExtraction(store, r);
    expect(store.scene('s05').facts!.contradictions.length).toBeGreaterThan(0);
    // The card was not rewritten to match.
    expect(store.scene('s05').card.reveals).toEqual(['ink-mismatch']);
  });
});

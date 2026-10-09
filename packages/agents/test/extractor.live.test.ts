import { describe, expect, it } from 'vitest';
import { GraphStore, runExtraction, scoreFacts, sceneOrder } from '@quillgon/core';
import { copyFixture } from '../../core/test/helpers.js';
import { createSuite } from '../src/index.js';

/** Live: runs the real extractor model on all 12 fixture scenes. QUILLGON_LIVE=1 and an API key. */
describe.runIf(process.env.QUILLGON_LIVE === '1')('phase 3 (live): extraction accuracy', () => {
  it('reproduces fixture facts at 90%+ recall on knowledge and mentions', async () => {
    const store = GraphStore.open(copyFixture(), { memoryIndex: true });
    const agents = createSuite(store, { record: process.env.QUILLGON_RECORD });
    const scores: number[] = [];
    for (const id of sceneOrder(store.project)) {
      const reference = store.scene(id).facts!.facts.filter((f) => f.predicate !== 'located_at');
      const r = await runExtraction(store, agents, id);
      const s = scoreFacts(reference, r.facts.filter((f) => f.predicate !== 'located_at'));
      console.log(id, s.recall.toFixed(2), s.missing);
      scores.push(s.recall);
    }
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeGreaterThanOrEqual(0.9);
  });
});

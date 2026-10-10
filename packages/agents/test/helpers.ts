import { GraphStore, Engine, type AgentSuite } from '@quillgon/core';
import { copyFixture } from '../../core/test/helpers.js';
import { ScriptedSuite } from '../src/index.js';

export { copyFixture };

/** A writable, git-initialised copy of the fixture with an engine over a scripted suite. */
export async function fixtureEngine(overrides: Partial<AgentSuite> = {}) {
  const dir = copyFixture();
  const store = GraphStore.open(dir, { memoryIndex: true });
  await store.repo.init();
  await store.checkpoint('Fixture');
  const agents = new ScriptedSuite(overrides);
  return { dir, store, agents, engine: new Engine(store, agents) };
}

/** An extractor that reports exactly what the fixture's facts.yaml says (a perfect extractor). */
export function fixtureExtractor(store: GraphStore): AgentSuite['extract'] {
  return async (input) => {
    const s = store.scene(input.card.id);
    const facts = s.facts?.facts ?? [];
    const learns = (c: string) => facts.filter((f) => f.subject === c && f.predicate === 'knows').map((f) => f.object);
    return {
      facts,
      states: input.card.characters.map((c) => ({
        character: c,
        learns: learns(c),
        forgets: [],
        location: facts.find((f) => f.subject === c && f.predicate === 'located_at')?.object ?? null,
        wants: null,
        feels: {},
        alive: true,
      })),
      timeline: [],
      new_facts: [],
      contradictions: [],
      obligations: s.facts?.obligations ?? [],
    };
  };
}

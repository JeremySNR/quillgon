import { describe, expect, it } from 'vitest';
import { analyseImpact, loadProject, partitionImpacts, ProjectIndex, sceneOrder, type Change, type Project } from '../src/index.js';
import { FIXTURE } from './helpers.js';

/** Load a fresh fixture, apply an in-memory mutation, index it, and analyse the change. */
function run(build: (p: Project) => Change) {
  const p = loadProject(FIXTURE).project;
  const change = build(p);
  const index = new ProjectIndex(':memory:');
  index.rebuild(p);
  const result = analyseImpact(p, change, index);
  index.close();
  const hop = (h: number) => result.impacts.filter((i) => i.hop === h).map((i) => i.scene);
  const upTo2 = result.impacts.filter((i) => i.hop <= 2).map((i) => i.scene);
  return { result, hop, upTo2, p };
}

const editState = (p: Project, character: string, scene: string, fn: (s: any) => any): Change => {
  const before = structuredClone(p.characters.get(character)!.state[scene]);
  const after = fn(structuredClone(before));
  p.characters.get(character)!.state[scene] = after;
  return { kind: 'state', character, scene, before, after };
};

const editCard = (p: Project, scene: string, fn: (c: any) => any): Change => {
  const before = structuredClone(p.scenes.get(scene)!.card);
  const after = fn(structuredClone(before));
  p.scenes.get(scene)!.card = after;
  return { kind: 'card', scene, before, after };
};

const reorder = (p: Project, fn: (order: string[]) => string[]): Change => {
  const before = sceneOrder(p);
  const after = fn([...before]);
  // Write the new order back into structure as one flat chapter run, keeping chapter sizes.
  let i = 0;
  for (const a of p.structure.acts) for (const c of a.chapters) c.scenes = c.scenes.map(() => after[i++]);
  return { kind: 'reorder', before, after };
};

describe('phase 2: impact analyser (15 named changes)', () => {
  it('1. Mara no longer learns about the debts in s04: flags exactly the later scenes where she speaks of them', () => {
    const { hop, upTo2 } = run((p) => editState(p, 'mara', 's04', (s) => ({ ...s, knows: s.knows.filter((f: string) => f !== 'eliza-holds-debts') })));
    expect(hop(1)).toEqual(['s06', 's11']);
    expect(upTo2).toEqual(['s06', 's11']);
  });

  it('2. Mara forgets the ledger entry after s02: flags s03 and s05', () => {
    const { upTo2 } = run((p) => editState(p, 'mara', 's02', (s) => ({ ...s, knows: s.knows.filter((f: string) => f !== 'ledger-storm-entry') })));
    expect(upTo2).toEqual(['s03', 's05']);
  });

  it('3. Mara does not learn about the Kittiwake in s09: the locked confession becomes a conflict', () => {
    const { result, upTo2 } = run((p) => editState(p, 'mara', 's09', (s) => ({ ...s, knows: s.knows.filter((f: string) => f !== 'jory-boat-lost') })));
    expect(upTo2).toEqual(['s10']);
    const { conflicts, proposals } = partitionImpacts(result.impacts, 2);
    expect(conflicts.map((c) => c.scene)).toEqual(['s10']);
    expect(proposals).toEqual([]);
  });

  it('4. Tom dies at the end of s06: every later scene with Tom', () => {
    const { hop } = run((p) => editState(p, 'tom', 's06', (s) => ({ ...s, alive: false })));
    expect(hop(1)).toEqual(['s07', 's09', 's11']);
  });

  it('5. s05 no longer reveals the ink mismatch', () => {
    const { hop } = run((p) =>
      editCard(p, 's05', (c) => ({ ...c, reveals: [], deltas: c.deltas.map((d: any) => ({ ...d, learns: d.learns.filter((f: string) => f !== 'ink-mismatch') })) })),
    );
    expect(hop(0)).toEqual(['s05']);
    expect(hop(1)).toEqual(['s09', 's10']);
    expect(hop(2)).toEqual(['s01', 's02', 's12']);
  });

  it('6. s03 moves from the quay to the harbour wall: location continuity only', () => {
    const { hop } = run((p) => editCard(p, 's03', (c) => ({ ...c, location: 'harbour' })));
    expect(hop(0)).toEqual(['s03']);
    expect(hop(1)).toEqual([]);
    expect(hop(2)).toEqual(['s04', 's06']);
  });

  it('7. the confession plot point is rewritten', () => {
    const { result, hop } = run((p) => {
      const before = structuredClone(p.plotPoints.get('pp-confession')!);
      const after = { ...before, description: 'Jory confesses he cut the punt adrift to frighten Walter.' };
      p.plotPoints.set(after.id, after);
      return { kind: 'plot', before, after };
    });
    expect(hop(1)).toEqual(['s10']);
    expect(hop(2)).toEqual(['s01', 's02', 's12']);
    expect(result.impacts.find((i) => i.scene === 's10')!.conflict).toBeTruthy();
  });

  it('8. the cannery thread now pays off in s12', () => {
    const { upTo2, hop } = run((p) => {
      const before = structuredClone(p.threads.get('cannery-debt')!);
      const after = { ...before, payoff_scene: 's12' };
      p.threads.set(after.id, after);
      return { kind: 'thread', before, after };
    });
    expect(hop(1)).toEqual(['s04', 's11', 's12']);
    expect(upTo2).toEqual(['s04', 's11', 's12']);
  });

  it('9. the Mara–Jory thread is dropped', () => {
    const { hop } = run((p) => {
      const before = structuredClone(p.threads.get('mara-jory')!);
      const after = { ...before, status: 'dropped' as const };
      p.threads.set(after.id, after);
      return { kind: 'thread', before, after };
    });
    expect(hop(1)).toEqual(['s01', 's05', 's07', 's10', 's12']);
  });

  it("10. Jory's voice sheet changes: every scene where he speaks", () => {
    const { upTo2 } = run(() => ({ kind: 'character', character: 'jory', field: 'voice' }));
    expect(upTo2).toEqual(['s01', 's05', 's07', 's10', 's12']);
  });

  it("11. Tom's biography changes: his POV scene at hop 1, his appearances at hop 2", () => {
    const { hop } = run(() => ({ kind: 'character', character: 'tom', field: 'bio' }));
    expect(hop(1)).toEqual(['s07']);
    expect(hop(2)).toEqual(['s03', 's06', 's09', 's11']);
  });

  it('12. s09 is moved before s05: Mara cites the inks before she has seen them', () => {
    const { hop } = run((p) => reorder(p, (o) => ['s01', 's02', 's03', 's04', 's09', 's05', 's06', 's07', 's08', 's10', 's11', 's12']));
    expect(hop(1)).toEqual(['s09']);
    expect(hop(2)).toEqual(['s05', 's06', 's07', 's08']);
  });

  it('13. s10 and s11 swap: Mara accuses Eliza of knowing about a forgery she has not heard of', () => {
    const { result, hop } = run((p) => reorder(p, (o) => ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's11', 's10', 's12']));
    expect(hop(1)).toEqual(['s11']);
    expect(hop(2)).toEqual(['s10']);
    expect(result.impacts.find((i) => i.scene === 's10')!.conflict).toBeTruthy();
  });

  it('14. s06 is deleted: the letter is never found', () => {
    const { hop } = run((p) => {
      const orderBefore = sceneOrder(p);
      const card = p.scenes.get('s06')!.card;
      p.scenes.delete('s06');
      for (const a of p.structure.acts) for (const c of a.chapters) c.scenes = c.scenes.filter((s) => s !== 's06');
      return { kind: 'delete-scene', scene: 's06', card, orderBefore };
    });
    expect(hop(1)).toEqual(['s04', 's08', 's11']);
    expect(hop(2)).toEqual(['s07']);
  });

  it('15. s04 now also reveals the letter: the later discovery is redundant', () => {
    const { hop } = run((p) => editCard(p, 's04', (c) => ({ ...c, reveals: [...c.reveals, 'walter-letter'] })));
    expect(hop(0)).toEqual(['s04']);
    expect(hop(1)).toEqual(['s06']);
    expect(hop(2)).toEqual(['s11']);
  });

  it('similarity candidates are hop 3, after the earliest affected scene, and never proposed', () => {
    const { result } = run((p) => ({ ...editCard(p, 's02', (c) => ({ ...c, outcome: 'Mara notices the storm entry is in blue-black ink.' })), description: 'The storm entry in the ledger is written in blue-black ink, not his brown iron-gall.' }));
    const h3 = result.impacts.filter((i) => i.hop === 3);
    expect(h3.length).toBeGreaterThan(0);
    expect(h3.map((i) => i.scene)).toContain('s05');
    const order = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12'];
    for (const i of h3) expect(order.indexOf(i.scene)).toBeGreaterThan(order.indexOf('s02'));
    expect(partitionImpacts(result.impacts, 2).listed).toEqual(h3);
  });

  it('results are ordered by story order with reasons', () => {
    const { result } = run((p) => editState(p, 'mara', 's04', (s) => ({ ...s, knows: [] })));
    const pos = result.impacts.map((i) => Number(i.scene.slice(1)));
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    for (const i of result.impacts) expect(i.reasons.length).toBeGreaterThan(0);
    expect(result.description).toMatch(/^Mara at the end of s04/);
  });
});

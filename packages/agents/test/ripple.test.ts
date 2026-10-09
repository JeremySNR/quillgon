import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mechanicalContinuity, Ripple } from '@quillgon/core';
import { fixtureEngine, fixtureExtractor } from './helpers.js';

describe('phase 5: ripples', () => {
  it('a pinned act-1 plot point changes: expected scenes, a conflict for the locked confession, zero continuity issues after', async () => {
    const { store, agents, engine } = await fixtureEngine();
    const before = structuredClone(store.project.plotPoints.get('pp-drowning')!);
    const after = store.savePlotPoint({ ...before, description: 'Walter Penrose drowns on a flat-calm night; his tide ledger records a storm, and his punt is found holed.' });
    const ripple = await engine.startRipple({ kind: 'plot', before, after });

    const items = ripple.round.items;
    expect(items.map((i) => i.scene).sort()).toEqual(['s01', 's02', 's10']);
    // Conflicts are pinned to the top, with the reason.
    expect(items[0]).toMatchObject({ scene: 's10', kind: 'conflict', status: 'conflict' });
    expect(items[0].reasons.join(' ')).toMatch(/thread "Who wrote the storm\?"/);

    await ripple.propose();
    expect(agents.count('reviseCard')).toBe(2);
    // The reviser finds nothing that must change in these scenes: no_change is the honest answer.
    for (const s of ['s01', 's02']) expect(ripple.item(s).status).toBe('no_change');

    expect(ripple.blockers()).toEqual(['s10: unresolved conflict']);
    await ripple.resolveConflict('s10', 'keep');
    const round = await ripple.apply();
    expect(round.commit).toBeTruthy();
    expect(ripple.data.state).toBe('done');
    expect(store.readReport('known-inconsistencies.md')).toMatch(/s10 "Confession" kept locked/);
    expect(mechanicalContinuity(store.project)).toEqual([]);
    const log = await store.repo.log(5);
    expect(log[0].message).toMatch(/^Ripple round 1:/);
  });

  it('Mara no longer learns of the debts in s04: card diffs, prose diffs, one commit, continuity clean', async () => {
    const { store, engine } = await fixtureEngine({});
    const extract = fixtureExtractor(store);
    (engine.agents as any).extract = async (i: any) => {
      const r = await extract(i);
      // The regenerated prose no longer has Mara raise the debts.
      return { ...r, facts: r.facts.filter((f) => !(f.subject === 'mara' && f.object === 'eliza-holds-debts' && f.predicate === 'mentions')) };
    };
    const snap = store.project.characters.get('mara')!.state['s04'];
    const change = engine.editState('mara', 's04', { ...snap, knows: snap.knows.filter((f) => f !== 'eliza-holds-debts') });
    // Before the ripple, the checker sees Mara talking about something she doesn't know.
    expect(mechanicalContinuity(store.project).map((i) => i.scene)).toEqual(['s06', 's11']);

    const ripple = await engine.startRipple(change);
    expect(ripple.round.items.map((i) => i.scene)).toEqual(['s06', 's11']);
    await ripple.propose();
    for (const s of ['s06', 's11']) {
      const it = ripple.item(s);
      expect(it.status).toBe('proposed');
      expect(it.card!.after!.mentions.some((m) => m.character === 'mara' && m.fact === 'eliza-holds-debts')).toBe(false);
      ripple.accept(s);
    }
    await ripple.proposeProse();
    expect(ripple.item('s06').prose.status).toBe('proposed');
    ripple.acceptProse('s06');
    ripple.rejectProse('s11');
    const round = await ripple.apply();
    expect(round.commit).toBeTruthy();
    expect(store.sceneSync('s06').state).toBe('in_sync');
    // s11's prose was kept, so its card moved ahead of it, and the checker still sees
    // Mara raising the debts in the prose: visible, not hidden.
    expect(store.sceneSync('s11').state).toBe('card_ahead');
    expect(mechanicalContinuity(store.project).map((i) => i.scene)).toEqual(['s11']);
    // Regenerating s11 to its new card clears it.
    const regen = await engine.pipeline.regenerate('s11', 'minimal', ripple.data.description);
    await engine.pipeline.acceptProse('s11', regen.after);
    expect(store.sceneSync('s11').state).toBe('in_sync');
    expect(mechanicalContinuity(store.project)).toEqual([]);

    // Persisted: the review survives a restart.
    const again = Ripple.load(store, engine.agents, ripple.data.id);
    expect(again.data.rounds[0].applied).toBe(true);
  });

  it('an author prose edit that changes a fact is caught by the extractor and triggers the right ripple', async () => {
    const { store, engine } = await fixtureEngine();
    const base = fixtureExtractor(store);
    (engine.agents as any).extract = async (i: any) => {
      const r = await base(i);
      if (i.card.id !== 's09') return r;
      // Tom no longer tells her about the Kittiwake.
      return {
        ...r,
        facts: r.facts.filter((f) => f.object !== 'jory-boat-lost'),
        states: r.states.map((s) => ({ ...s, learns: s.learns.filter((f) => f !== 'jory-boat-lost') })),
      };
    };
    const prose = store.scene('s09').prose!.body.split('\n\n').filter((p) => !p.includes('Kittiwake')).join('\n\n');
    store.saveProse('s09', prose, 'author');
    expect(store.sceneSync('s09').state).toBe('prose_ahead');

    const r = await engine.pipeline.reconcileProseEdit('s09');
    expect(r.presentationOnly).toBe(false);
    expect(r.extraction.diff.removed.map((f) => `${f.subject} ${f.predicate} ${f.object}`)).toEqual(
      expect.arrayContaining(['tom mentions jory-boat-lost', 'mara knows jory-boat-lost']),
    );
    const change = engine.pipeline.acceptProseFacts('s09');
    expect(store.scene('s09').card.reveals).not.toContain('jory-boat-lost');
    expect(store.sceneSync('s09').state).toBe('in_sync');

    const ripple = await engine.startRipple(change);
    // s10 (Mara confronts Jory about the boat) is flagged, and it's locked: a conflict.
    expect(ripple.round.items.find((i) => i.scene === 's10')).toMatchObject({ kind: 'conflict' });
    expect(ripple.round.items.find((i) => i.scene === 's10')!.reasons.join(' ')).toMatch(/Mara speaks about "Jory's boat/);
  });

  it('a wording-only prose edit reconciles without a ripple', async () => {
    const { store, engine } = await fixtureEngine();
    (engine.agents as any).extract = fixtureExtractor(store);
    store.saveProse('s03', store.scene('s03').prose!.body.replace('A gull landed on the bollard', 'A gull dropped onto the bollard'), 'author');
    const r = await engine.pipeline.reconcileProseEdit('s03');
    expect(r.presentationOnly).toBe(true);
    expect(store.sceneSync('s03').state).toBe('in_sync');
  });

  it('the cascade cap stops the ripple and reports what is still inconsistent', async () => {
    const { store, engine } = await fixtureEngine({
      // A reviser that always removes the scene's last reveal: each accepted card spawns new hop-1 work.
      reviseCard: async (i) => {
        const { status: _s, lock: _l, ...card } = i.card;
        if (!card.reveals.length) return { action: 'no_change', justification: 'nothing to remove', needs_decision: [] };
        return { action: 'revise', justification: 'drop reveal', card: { ...card, reveals: card.reveals.slice(0, -1), deltas: card.deltas.map((d) => ({ ...d, learns: [] })) }, needs_decision: [] };
      },
    });
    const before = structuredClone(store.scene('s02').card);
    const after = store.saveCard({ ...before, reveals: [], deltas: [{ character: 'mara', learns: [], forgets: [] }] }).card;
    const ripple = await engine.startRipple({ kind: 'card', scene: 's02', before, after }, { roundCap: 1 });
    expect(ripple.round.items.map((i) => i.scene)).toEqual(expect.arrayContaining(['s02', 's03', 's05']));
    ripple.rejectProse('s02');
    for (const it of ripple.round.items) if (it.kind === 'conflict') await ripple.resolveConflict(it.scene, 'keep');
    await ripple.propose();
    for (const it of ripple.round.items) if (it.status === 'proposed') ripple.accept(it.scene);
    for (const it of ripple.round.items) if (it.prose.status === 'pending') ripple.rejectProse(it.scene);
    expect(ripple.blockers()).toEqual([]);
    await ripple.apply();
    expect(ripple.data.state).toBe('capped');
    expect(ripple.data.remaining.length).toBeGreaterThan(0);
  });

  it('a whole ripple can be reverted with git', async () => {
    const { dir, store, engine } = await fixtureEngine();
    (engine.agents as any).extract = fixtureExtractor(store);
    const original = fs.readFileSync(path.join(dir, 'scenes/s06/card.yaml'), 'utf8');
    const snap = store.project.characters.get('mara')!.state['s04'];
    const ripple = await engine.startRipple(engine.editState('mara', 's04', { ...snap, knows: snap.knows.filter((f) => f !== 'eliza-holds-debts') }));
    await ripple.propose();
    ripple.accept('s06');
    ripple.reject('s11');
    ripple.rejectProse('s06');
    await ripple.apply();
    expect(fs.readFileSync(path.join(dir, 'scenes/s06/card.yaml'), 'utf8')).not.toEqual(original);
    await ripple.revert();
    expect(fs.readFileSync(path.join(dir, 'scenes/s06/card.yaml'), 'utf8')).toEqual(original);
    expect(store.project.characters.get('mara')!.state['s04'].knows).toContain('eliza-holds-debts');
    expect(ripple.data.state).toBe('reverted');
  });
});

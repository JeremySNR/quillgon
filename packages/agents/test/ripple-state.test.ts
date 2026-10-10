import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { paths, RevertConflictError, sceneOrder } from '@quillgon/core';
import { fixtureEngine, fixtureExtractor } from './helpers.js';

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');

/** The ripple state machine's failure paths. */
describe('ripple state machine', () => {
  async function appliedRipple() {
    const env = await fixtureEngine();
    (env.engine.agents as any).extract = fixtureExtractor(env.store);
    const snap = env.store.project.characters.get('mara')!.state['s04'];
    const ripple = await env.engine.startRipple(env.engine.editState('mara', 's04', { ...snap, knows: snap.knows.filter((f) => f !== 'eliza-holds-debts') }));
    await ripple.propose();
    ripple.accept('s06');
    ripple.reject('s11');
    ripple.rejectProse('s06');
    await ripple.apply();
    return { ...env, ripple };
  }

  it('a revert that conflicts with later work changes nothing and names the files', async () => {
    const { dir, store, ripple } = await appliedRipple();
    // The author edits the same lines of the card after the ripple, and commits.
    // (Edits elsewhere in the file merge cleanly and the revert goes ahead.)
    store.saveCard({ ...store.scene('s06').card, mentions: [] });
    await store.commit('Hand edit');
    const head = await store.repo.head();
    const card = read(dir, paths.card('s06'));

    const err = await ripple.revert().catch((e) => e);
    expect(err).toBeInstanceOf(RevertConflictError);
    expect(err.files).toContain(paths.card('s06'));
    // Nothing moved: same HEAD, same files, clean tree, no revert in progress.
    expect(await store.repo.head()).toBe(head);
    expect(read(dir, paths.card('s06'))).toBe(card);
    expect((await store.repo.git.status()).isClean()).toBe(true);
    expect(fs.existsSync(path.join(dir, '.git', 'REVERT_HEAD'))).toBe(false);
    expect(ripple.data.state).not.toBe('reverted');
  });

  it('a clean revert is one commit', async () => {
    const { store, ripple } = await appliedRipple();
    const before = (await store.repo.log(50)).length;
    await ripple.revert();
    const log = await store.repo.log(50);
    // A checkpoint (only if there was pending work) and one revert commit.
    expect(log[0].message).toMatch(/^Revert ripple: /);
    expect(log.length - before).toBeLessThanOrEqual(2);
  });

  it('a proposal that failed is retried by proposing again', async () => {
    let fail = true;
    const { store, engine } = await fixtureEngine({
      reviseCard: async (i) => {
        if (fail) throw new Error('rate limited');
        return { action: 'no_change', justification: `fine: ${i.card.id}`, needs_decision: [] };
      },
    });
    const snap = store.project.characters.get('mara')!.state['s04'];
    const ripple = await engine.startRipple(engine.editState('mara', 's04', { ...snap, knows: snap.knows.filter((f) => f !== 'eliza-holds-debts') }));
    await ripple.propose();
    expect(ripple.item('s06')).toMatchObject({ status: 'error', error: 'rate limited' });
    expect(ripple.blockers()).toContain('s06: card error');
    fail = false;
    await ripple.propose();
    expect(ripple.item('s06')).toMatchObject({ status: 'no_change', error: null });
  });

  it("accepting an edited proposal keeps the scene's status and lock", async () => {
    const { store, engine } = await fixtureEngine();
    store.setSceneStatus('s06', { status: 'approved', lock: 'card' });
    store.setSceneStatus('s06', { lock: 'none' });
    expect(store.scene('s06').card.status).toBe('approved');
    const snap = store.project.characters.get('mara')!.state['s04'];
    const ripple = await engine.startRipple(engine.editState('mara', 's04', { ...snap, knows: snap.knows.filter((f) => f !== 'eliza-holds-debts') }));
    await ripple.propose();
    const { status: _s, lock: _l, ...edited } = ripple.item('s06').card!.after!;
    ripple.accept('s06', { ...edited, purpose: 'Edited by the author in review.' });
    expect(ripple.item('s06').card!.after).toMatchObject({ status: 'approved', purpose: 'Edited by the author in review.' });
  });

  it('two ripples started in the same second get different ids', async () => {
    const { store, engine } = await fixtureEngine();
    const before = structuredClone(store.project.plotPoints.get('pp-drowning')!);
    const a = await engine.startRipple({ kind: 'plot', before, after: store.savePlotPoint({ ...before, description: 'One.' }) });
    const b = await engine.startRipple({ kind: 'plot', before, after: store.savePlotPoint({ ...before, description: 'Two.' }) });
    expect(a.data.id).not.toBe(b.data.id);
  });

  it('reverting a scene deletion committed before the ripple restores the scene in place', async () => {
    const { dir, store, engine } = await fixtureEngine();
    const card = structuredClone(store.scene('s07').card);
    const prose = read(dir, paths.prose('s07'));
    const orderBefore = sceneOrder(store.project);
    store.deleteScene('s07');
    await store.commit('Delete s07');
    await new Promise((r) => setTimeout(r, 1100)); // the ripple starts after the deletion commit
    const ripple = await engine.startRipple({ kind: 'delete-scene', scene: 's07', card, orderBefore });
    expect(ripple.data.originCommit).toBeNull();
    await ripple.revert();
    expect(sceneOrder(store.project)).toEqual(orderBefore);
    expect(read(dir, paths.prose('s07'))).toBe(prose);
    expect((await store.repo.git.status()).isClean()).toBe(true);
  });
});

describe('prose edits', () => {
  it('a wording-only edit to a scene whose card moved leaves it card_ahead', async () => {
    const { store, engine } = await fixtureEngine();
    (engine.agents as any).extract = fixtureExtractor(store);
    store.saveCard({ ...store.scene('s03').card, purpose: 'A changed purpose the prose does not reflect yet.' });
    store.saveProse('s03', store.scene('s03').prose!.body.replace('A gull landed on the bollard', 'A gull dropped onto the bollard'), 'author');
    expect(store.sceneSync('s03').state).toBe('conflict');
    const r = await engine.pipeline.reconcileProseEdit('s03');
    expect(r.presentationOnly).toBe(true);
    expect(store.sceneSync('s03').state).toBe('card_ahead');
  });
});

describe('review fixes', () => {
  it('branch names follow git, refusing only what git refuses (and leading dashes)', async () => {
    const { assertBranch, assertRef } = await import('@quillgon/core');
    for (const ok of ["what-if-tom's-death", 'what-if-élan', 'a+b', 'feature/x', 'v1.2']) expect(assertBranch(ok)).toBe(ok);
    for (const bad of ['-x', '--output=/tmp/x', 'a..b', 'a b', 'a:b', 'a~1', 'x.lock', 'a/.b', '@']) expect(() => assertBranch(bad)).toThrow(/invalid/);
    expect(assertRef('HEAD~2')).toBe('HEAD~2');
    expect(() => assertRef('-p')).toThrow(/invalid/);
  });

  it('reverting a merged what-if works; a failure that is not a conflict says so', async () => {
    const { store } = await fixtureEngine();
    await store.repo.createBranch('what-if');
    store.saveCard({ ...store.scene('s02').card, purpose: 'On the branch.' });
    await store.commit('Branch edit');
    await store.repo.switchBranch('main');
    const merged = await store.repo.merge('what-if');
    expect(merged.ok).toBe(true);
    const mergeHash = (await store.repo.log(1))[0].hash;
    await store.revertCommits([mergeHash], 'Revert the merge');
    store.reload();
    expect(store.scene('s02').card.purpose).not.toBe('On the branch.');
    const err = await store.revertCommits(['deadbeefdeadbeef'], 'x').catch((e) => e);
    expect(err).not.toBeInstanceOf(RevertConflictError);
    expect(err.message).toMatch(/not applied/);
  });

  it('a revert checkpoints again when an autosave lands between checkpoint and revert', async () => {
    const { dir, store, ripple } = await appliedRippleFor();
    const original = store.repo.revertAll.bind(store.repo);
    let calls = 0;
    store.repo.revertAll = async (hashes, message) => {
      if (++calls === 1) fs.appendFileSync(path.join(dir, paths.prose('s02')), '\nTyped just now.\n');
      return original(hashes, message);
    };
    await ripple.revert();
    expect(calls).toBe(2);
    expect(read(dir, paths.prose('s02'))).toContain('Typed just now.');
    expect(ripple.data.state).toBe('reverted');
  });

  it("an autosave in another scene during a round's extraction stays out of the round's commit", async () => {
    const { store, engine } = await fixtureEngine();
    const base = fixtureExtractor(store);
    (engine.agents as any).extract = async (i: any) => {
      store.saveProse('s02', store.scene('s02').prose!.body + '\n\nTyped during extraction.\n', 'author');
      return base(i);
    };
    const snap = store.project.characters.get('mara')!.state['s04'];
    const ripple = await engine.startRipple(engine.editState('mara', 's04', { ...snap, knows: snap.knows.filter((f) => f !== 'eliza-holds-debts') }));
    await ripple.propose();
    ripple.accept('s06');
    ripple.reject('s11');
    await ripple.proposeProse();
    ripple.acceptProse('s06');
    const round = await ripple.apply();
    const files = (await store.repo.show(round.commit!)).files;
    expect(files).toContain(paths.prose('s06'));
    expect(files).not.toContain(paths.prose('s02'));
  });

  it("reverting a scene deletion restores the state of characters who were not on the card", async () => {
    const { dir, store, engine } = await fixtureEngine();
    const card = structuredClone(store.scene('s07').card);
    const outsider = [...store.project.characters.keys()].find((c) => c !== card.pov && !card.characters.includes(c))!;
    const snap = structuredClone(Object.values(store.project.characters.get(outsider)!.state)[0]);
    store.saveCharacterState(outsider, { ...store.project.characters.get(outsider)!.state, s07: snap });
    await store.commit('State for an outsider in s07');
    const orderBefore = sceneOrder(store.project);
    store.deleteScene('s07');
    await store.commit('Delete s07');
    await new Promise((r) => setTimeout(r, 1100));
    const ripple = await engine.startRipple({ kind: 'delete-scene', scene: 's07', card, orderBefore });
    await ripple.revert();
    expect(store.project.characters.get(outsider)!.state.s07).toBeTruthy();
    expect(fs.existsSync(path.join(dir, paths.card('s07')))).toBe(true);
  });
});

async function appliedRippleFor() {
  const env = await fixtureEngine();
  (env.engine.agents as any).extract = fixtureExtractor(env.store);
  const snap = env.store.project.characters.get('mara')!.state['s04'];
  const ripple = await env.engine.startRipple(env.engine.editState('mara', 's04', { ...snap, knows: snap.knows.filter((f) => f !== 'eliza-holds-debts') }));
  await ripple.propose();
  ripple.accept('s06');
  ripple.reject('s11');
  ripple.rejectProse('s06');
  await ripple.apply();
  return { ...env, ripple };
}

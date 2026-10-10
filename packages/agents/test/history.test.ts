import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphStore, paths } from '@quillgon/core';
import { copyFixture, fixtureEngine } from './helpers.js';

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');

/** Commits only ever contain what they are about, so reverting one cannot undo other work. */
describe('scoped commits', () => {
  it('a store commit leaves edits made in another editor uncommitted', async () => {
    const { dir, store } = await fixtureEngine();
    fs.appendFileSync(path.join(dir, paths.prose('s02')), '\nWritten in another editor.\n');
    store.saveCard({ ...store.scene('s03').card, purpose: 'A new purpose.' });
    const hash = await store.commit('Edit s03');
    expect((await store.repo.show(hash!)).files).toEqual([paths.card('s03')]);
    expect((await store.repo.git.status()).modified).toEqual([paths.prose('s02')]);
    // A checkpoint takes everything.
    await store.checkpoint('Checkpoint');
    expect((await store.repo.git.status()).isClean()).toBe(true);
  });

  it('reverting a ripple keeps prose the author wrote before it started', async () => {
    const { dir, store, engine } = await fixtureEngine();
    // An hour of typing in s02: autosaved through the store, never committed.
    const typed = store.scene('s02').prose!.body + '\n\nA paragraph the author wrote by hand.\n';
    store.saveProse('s02', typed, 'author');
    // Then a card edit elsewhere starts a ripple.
    const before = structuredClone(store.project.plotPoints.get('pp-drowning')!);
    const after = store.savePlotPoint({ ...before, description: 'Walter Penrose drowns on a flat-calm night.' });
    const ripple = await engine.startRipple({ kind: 'plot', before, after });
    expect((await store.repo.show(ripple.data.originCommit!)).files).toEqual([paths.plotPoint('pp-drowning')]);

    await ripple.revert();
    expect(store.project.plotPoints.get('pp-drowning')!.description).toBe(before.description);
    expect(read(dir, paths.prose('s02'))).toContain('A paragraph the author wrote by hand.');
  });

  it('a ripple round commit holds only what the round wrote', async () => {
    const { store, engine } = await fixtureEngine();
    const before = structuredClone(store.project.plotPoints.get('pp-drowning')!);
    const after = store.savePlotPoint({ ...before, description: 'Walter Penrose drowns on a flat-calm night.' });
    const ripple = await engine.startRipple({ kind: 'plot', before, after });
    await ripple.propose();
    await ripple.resolveConflict('s10', 'keep');
    // The author keeps writing elsewhere while reviewing.
    store.saveProse('s05', store.scene('s05').prose!.body + '\n\nTyped during review.\n', 'author');
    const round = await ripple.apply();
    expect((await store.repo.show(round.commit!)).files).toEqual(['reports/known-inconsistencies.md']);
  });

  it('a deleted scene is committed as a deletion', async () => {
    const { store } = await fixtureEngine();
    store.deleteScene('s12');
    const hash = await store.commit('Delete s12');
    const files = (await store.repo.show(hash!)).files;
    expect(files).toContain(paths.card('s12'));
    expect(files).toContain(paths.structure);
    expect((await store.repo.git.status()).isClean()).toBe(true);
  });

  it('a file written and removed before any commit is not an error', async () => {
    const { store } = await fixtureEngine();
    store.savePrompt('reader', 'temporary');
    store.savePrompt('reader', null);
    expect(await store.commit('Nothing')).toBeNull();
    expect(store.hasUncommitted()).toBe(false);
  });
});

describe('minimal regeneration', () => {
  it('revises from the card the prose was written against, even after the new card is committed', async () => {
    let seen: { old_card: { purpose: string }; new_card: { purpose: string } } | null = null;
    const { store, engine } = await fixtureEngine({
      reviseProse: async (input) => {
        seen = input as any;
        return { prose: input.old_prose, summary: '', needs_decision: [] };
      },
    });
    const old = store.scene('s03').card.purpose;
    store.saveCard({ ...store.scene('s03').card, purpose: 'Mara decides to trust Tom after all.' });
    // Something else commits first (an approval, a checkpoint): the new card is now at HEAD.
    await store.checkpoint('Unrelated checkpoint');
    await engine.pipeline.regenerate('s03', 'minimal');
    expect(seen!.old_card.purpose).toBe(old);
    expect(seen!.new_card.purpose).toBe('Mara decides to trust Tom after all.');
  });
});

describe('opening an existing repository', () => {
  it('adds the index and exports to .gitignore', async () => {
    const dir = copyFixture();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'notes/\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    GraphStore.open(dir, { memoryIndex: true }).close();
    expect(read(dir, '.gitignore')).toBe('notes/\n.engine/\nexport/\n');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine, initProject, loadProject, mechanicalContinuity, sceneOrder } from '@quillgon/core';
import { OfflineSuite, ScriptedSuite } from '../src/index.js';

describe('phase 4: generation pipeline', () => {
  it('runs every gate from a one-paragraph premise to a complete, valid, in-sync draft', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'book-')), 'lantern');
    const store = await initProject(dir, { title: 'The Lantern Keeper', target_words: 12000, offline: true });
    const agents = new ScriptedSuite();
    const engine = new Engine(store, agents);
    const pl = engine.pipeline;

    // 1. Intent: the interviewer asks, the author answers, the author approves.
    const premise = 'When Ada Quill inherits a lighthouse on a dying island, she finds the keeper before her kept a second log. Her brother Tobias wants her to sell.';
    const q = await pl.interview(premise);
    expect(q.questions.length).toBeGreaterThan(0);
    const a = await pl.interview(premise, q.questions.map((question, i) => ({ question, answer: ['grief; inheritance', 'Bittersweet', 'Never explain the light.', 'Spare and cold'][i] ?? '' })));
    expect(a.intent?.hard_rules).toContain('Never explain the light.');
    await pl.approveIntent(a.intent!);
    expect(store.book.stage).toBe('plot-points');
    expect(store.project.intent.approved).toBe(true);

    // 2. Plot points: the author pins one; the planner proposes the rest; the author accepts or rejects each.
    pl.pinPlotPoint({ title: 'The second log', description: 'Ada finds the second log under the lamp room floor.', position: { act: 1 } });
    const { created } = await pl.proposePlotPoints();
    expect(created.length).toBeGreaterThanOrEqual(5);
    expect(store.project.plotPoints.get(created[0])!.proposed).toBe(true);
    pl.rejectPlotPoint(created[created.length - 1]);
    for (const id of created.slice(0, -1)) pl.acceptPlotPoint(id);
    await pl.finishPlotPoints();
    expect(store.book.stage).toBe('structure');

    // 3. Structure: three genuinely different alternatives; pick one.
    const s = await pl.proposeStructures();
    expect(s.alternatives).toHaveLength(3);
    expect(new Set(s.alternatives.map((x) => x.kind))).toEqual(new Set(['obvious', 'unexpected', 'wildcard']));
    await pl.pickStructure(1);
    expect(store.project.structure.acts.length).toBe(3);
    expect(store.book.stage).toBe('cards');

    // 4. Scene cards: two alternatives per chapter; pick for the first, default the rest.
    const chapters = pl.chapters();
    const c1 = await pl.proposeCards(chapters[0].id);
    expect(c1.alternatives).toHaveLength(2);
    await pl.pickCards(chapters[0].id, 1);
    await pl.defaultCards();
    expect(pl.chapters().every((c) => c.scenes.length > 0)).toBe(true);
    expect(store.book.stage).toBe('prose');

    // 5. Prose: write chapter by chapter, with style passes and extraction.
    for (const ch of pl.chapters()) await pl.writeChapter(ch.id);
    expect(store.book.stage).toBe('complete');
    expect(agents.count('humanise')).toBe(sceneOrder(store.project).length);
    expect(agents.count('extract')).toBe(sceneOrder(store.project).length);

    // The result validates, every scene is in sync, and a reader run completes.
    const reloaded = loadProject(dir);
    expect(reloaded.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect([...store.sync().values()].every((x) => x.state === 'in_sync')).toBe(true);
    expect(mechanicalContinuity(store.project).filter((i) => i.kind === 'unknown-fact')).toEqual([]);
    const report = await engine.reader();
    expect(report.engagement).toHaveLength(sceneOrder(store.project).length);
    expect(store.book.health.last_reader_run).toBeTruthy();
    const log = await store.repo.log(100);
    expect(log.length).toBeGreaterThan(5);
  });

  it('style passes revise only flagged lines and strip banned patterns', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'book-')), 'style');
    const store = await initProject(dir, { title: 'Style', offline: true });
    const base = new OfflineSuite();
    const agents = new ScriptedSuite({
      write: async (i) => ({ prose: `${(await base.write(i)).prose}\n\nIt was a testament to her nerve — and she knew it.`, needs_decision: [] }),
    });
    const engine = new Engine(store, agents);
    await engine.pipeline.approveIntent({ premise: 'A test.' });
    await engine.pipeline.proposePlotPoints();
    for (const pp of store.project.plotPoints.values()) engine.pipeline.acceptPlotPoint(pp.id);
    await engine.pipeline.proposeStructures();
    await engine.pipeline.pickStructure(0);
    await engine.pipeline.defaultCards();
    const first = sceneOrder(store.project)[0];
    const r = await engine.pipeline.writeScene(first);
    expect(r.style!.bannedBefore.map((h) => h.label)).toContain('testament to');
    expect(r.style!.bannedAfter).toEqual([]);
    expect(store.scene(first).prose!.body).not.toMatch(/testament to/);
  });

  it('blocks generation for a scene whose card and prose both moved', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'book-')), 'conflict');
    const store = await initProject(dir, { title: 'C', offline: true });
    const engine = new Engine(store, new OfflineSuite());
    await engine.pipeline.approveIntent({ premise: 'A test.' });
    await engine.pipeline.proposePlotPoints();
    for (const pp of store.project.plotPoints.values()) engine.pipeline.acceptPlotPoint(pp.id);
    await engine.pipeline.proposeStructures();
    await engine.pipeline.pickStructure(0);
    await engine.pipeline.defaultCards();
    const id = sceneOrder(store.project)[0];
    await engine.pipeline.writeScene(id);
    store.saveProse(id, store.scene(id).prose!.body + '\n\nAn edit.', 'author');
    store.saveCard({ ...store.scene(id).card, outcome: 'Different.' });
    await expect(engine.pipeline.writeScene(id)).rejects.toThrow(/resolve first/);
  });
});

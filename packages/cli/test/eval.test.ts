import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bookMetrics, eloFromWinRate, GraphStore, runMetrics } from '@quillgon/core';
import { copyFixture } from '../../core/test/helpers.js';
import { compareRuns, loadPremises, runEval } from '../src/eval.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const premises = path.resolve(here, '../../../evals/premises.yaml');

describe('eval metrics', () => {
  it('counts stock phrasing per 1,000 words', () => {
    const store = GraphStore.open(copyFixture(), { memoryIndex: true });
    const clean = bookMetrics(store.project, { id: 'clean' });
    const body = store.scene('s01').prose!.body;
    store.saveProse('s01', `${body}\n\nIt was a testament to her nerve, a tapestry of salt, and the air was thick with it.`, 'author');
    const sloppy = bookMetrics(store.project, { id: 'sloppy' });
    expect(sloppy.slop_per_1k).toBeGreaterThan(clean.slop_per_1k);
    expect(clean.continuity_errors).toBe(0);
    expect(clean.first_names).toContain('Mara');
    store.close();
  });

  it('measures how alike the books in a run are', () => {
    const a = GraphStore.open(copyFixture(), { memoryIndex: true });
    const b = GraphStore.open(copyFixture(), { memoryIndex: true });
    const same = runMetrics([
      { metrics: bookMetrics(a.project, { id: 'a' }), project: a.project },
      { metrics: bookMetrics(b.project, { id: 'b' }), project: b.project },
    ]);
    // Two copies of the same book: every name shared, prose identical, plans identical.
    expect(same.shared_name_rate).toBe(1);
    expect(same.trigram_overlap).toBe(1);
    expect(same.plan_diversity).toBeLessThan(0.01);
    a.close();
    b.close();
  });

  it('turns a win rate into an Elo difference', () => {
    expect(eloFromWinRate(0.5)).toBe(0);
    expect(eloFromWinRate(0.76)).toBeGreaterThan(190);
    expect(eloFromWinRate(0.24)).toBeLessThan(-190);
  });
});

describe('eval runner', () => {
  it('the frozen set is valid and its ids are unique', () => {
    const set = loadPremises(premises);
    expect(set.premises.length).toBe(20);
    expect(new Set(set.premises.map((p) => p.id)).size).toBe(20);
  });

  it('runs premises through every gate offline and compares two runs', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-eval-'));
    const home = process.env.HOME;
    process.env.HOME = out;
    try {
      const first = await runEval({ premises, out, models: 'offline', limit: 1 });
      await new Promise((r) => setTimeout(r, 1100)); // run ids are per second
      const second = await runEval({ premises, out, models: 'offline', limit: 1 });
      const book = first.run.books[0];
      expect(book.error).toBeNull();
      expect(book.scenes.map((s) => s.role)).toEqual(['opening', 'turn', 'ending']);
      expect(book.scenes.every((s) => s.prose.length > 0)).toBe(true);
      expect(book.metrics!.written).toBe(3);
      expect(fs.readFileSync(path.join(first.dir, 'report.md'), 'utf8')).toMatch(/Slop per 1k words/);
      const c = await compareRuns(first.dir, second.dir, { models: 'offline' });
      expect(c.pairs).toBe(3);
      expect(c.a_wins + c.b_wins + c.ties).toBe(3);
      expect(fs.existsSync(path.join(second.dir, `compare-${first.run.id}.json`))).toBe(true);
    } finally {
      process.env.HOME = home;
    }
  });
});

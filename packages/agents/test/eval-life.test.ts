import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Engine, initProject, lifeSummary, loadLives, runLifeEval } from '@quillgon/core';
import { OfflineSuite } from '../src/index.js';

const lives = loadLives(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../evals/lives.yaml'));

describe('the life-story eval', () => {
  it('interviews a simulated person, drafts the book and scores it, without leading or touching what is off limits', async () => {
    const life = lives.find((l) => l.id === 'margaret')!;
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-life-')), life.id);
    const store = await initProject(dir, { title: life.title, kind: 'life-story', subject_name: life.narrator, life: { subject: 'self', born: life.born }, offline: true });
    const engine = new Engine(store, new OfflineSuite());
    const m = await runLifeEval(engine, life, { sessions: 2, turns: 8 });
    expect(m.turns).toBe(16);
    expect(m.elicited).toBeGreaterThan(0);
    expect(m.leading_asked).toBe(0);
    expect(m.off_limits_asked).toBe(0);
    expect(m.chapters).toBeGreaterThan(0);
    expect(m.words).toBeGreaterThan(0);
    expect(m.invented_rate).toBeGreaterThanOrEqual(0);
    expect(m.invented_rate).toBeLessThanOrEqual(1);
    const s = lifeSummary([m]);
    expect(s.lives).toBe(1);
    expect(s.elicited).toBe(m.elicited);
    store.close();
  }, 60_000);

  it('the frozen set parses and every fact can be found by its own keywords', () => {
    expect(lives.length).toBeGreaterThanOrEqual(2);
    for (const l of lives) for (const f of l.facts) for (const k of f.keywords) expect(f.text.toLowerCase()).toContain(k.toLowerCase());
  });
});

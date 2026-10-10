import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Book, DEFAULT_MODELS, CODEX_MODELS, estimate, GraphStore, initProject } from '../src/index.js';

describe('model setup', () => {
  it.each([['default', {}, DEFAULT_MODELS], ['codex', { codex: true }, CODEX_MODELS]] as const)('persists %s models when creating a book', async (_name, options, expected) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillgon-models-'));
    const store = await initProject(dir, { title: 'Model setup', ...options });
    try { expect(store.book.models).toEqual(expected); }
    finally { store.close(); }
    const reopened = GraphStore.open(dir);
    try { expect(reopened.book.models).toEqual(expected); }
    finally { reopened.close(); }
  });
  it('preserves explicit legacy providers', () => {
    expect(Book.parse({ title: 'Old book', models: { frontier: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } }).models.frontier?.provider).toBe('anthropic');
  });
  it('estimates no API charge for subscription use even with stale prices', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quillgon-estimate-'));
    const store = await initProject(dir, { title: 'Subscription', codex: true });
    try {
      store.updateBook({ models: Object.fromEntries(Object.entries(CODEX_MODELS).map(([tier, config]) => [tier, { ...config, price_in: 99, price_out: 99 }])) });
      const result = estimate(store.project);
      expect(result.lines.length).toBeGreaterThan(0);
      expect(result.total_usd).toBe(0);
    } finally { store.close(); }
  });
});

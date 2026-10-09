import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphStore } from '@novel/core';
import { NovelServer } from '../src/index.js';
import { copyFixture } from '../../core/test/helpers.js';

process.env.NOVEL_OFFLINE = '1';
let server: NovelServer;
let base = '';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error), { status: res.status, json });
  return json;
}

async function job(path: string, body: unknown = {}) {
  const { job } = await api('POST', path, body);
  for (;;) {
    const j = await api('GET', `/api/jobs/${job}`);
    if (j.state === 'done') return j.result;
    if (j.state === 'error') throw new Error(j.error);
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  const dir = copyFixture();
  const s = GraphStore.open(dir, { memoryIndex: true });
  await s.repo.init();
  await s.commit('Fixture');
  s.close();
  server = new NovelServer();
  server.open(dir);
  base = `http://127.0.0.1:${await server.listen(0)}`;
});
afterAll(() => server.close());

describe('server API', () => {
  it('serves the project snapshot', async () => {
    const p = await api('GET', '/api/project');
    expect(p.book.title).toBe("The Tidekeeper's Ledger");
    expect(p.scenes).toHaveLength(12);
    expect(p.totals.bySync.in_sync).toBe(12);
    expect(p.mode).toBe('offline');
    expect(p.scenes[0]).toMatchObject({ id: 's01', act: 'act-1', chapter: 'ch-1', sync: 'in_sync' });
  });

  it('rejects invalid writes with precise issues', async () => {
    const s = await api('GET', '/api/scenes/s03');
    await expect(api('PUT', '/api/scenes/s03/card', { card: { ...s.card, status: 'finished' } })).rejects.toMatchObject({ status: 422 });
  });

  it('completes the phase 5 ripple scenario through the API, accepting and rejecting individually', async () => {
    const before = await api('GET', '/api/scenes/s04');
    const snap = before.states.find((x: any) => x.character === 'mara').after;
    const { change, impact } = await api('PUT', '/api/characters/mara/state/s04', { snapshot: { ...snap, knows: snap.knows.filter((f: string) => f !== 'eliza-holds-debts') } });
    expect(impact.impacts.filter((i: any) => i.hop <= 2).map((i: any) => i.scene)).toEqual(['s06', 's11']);

    let r = await api('POST', '/api/ripple/start', { change });
    expect(r.rounds[0].items.map((i: any) => i.scene)).toEqual(['s06', 's11']);
    r = await job('/api/ripple/propose');
    expect(r.rounds[0].items.every((i: any) => i.status === 'proposed')).toBe(true);
    r = await api('POST', '/api/ripple/accept', { scene: 's06' });
    r = await api('POST', '/api/ripple/reject', { scene: 's11' });
    r = await job('/api/ripple/propose-prose');
    expect(r.rounds[0].items.find((i: any) => i.scene === 's06').prose.status).toBe('proposed');
    r = await api('POST', '/api/ripple/accept-prose', { scene: 's06' });
    r = await job('/api/ripple/apply');
    expect(r.rounds[0].applied).toBe(true);
    expect(r.state).toBe('done');
    const hist = await api('GET', '/api/history');
    expect(hist[0].message).toMatch(/^Ripple round 1/);
    const p = await api('GET', '/api/project');
    expect(p.ripple).toBeNull();
    expect(p.continuity.mechanical.map((i: any) => i.scene)).toEqual(['s11']);
  });

  it('runs the reader and lists reports', async () => {
    const r = await job('/api/quality/reader', {});
    expect(r.engagement).toHaveLength(12);
    const list = await api('GET', '/api/reports/reader');
    expect(list[0].id).toBe(r.id);
  });

  it('branches: what-if, compare, switch back', async () => {
    await api('POST', '/api/branches', { name: 'what-if-tom-lies' });
    const s = await api('GET', '/api/scenes/s09');
    await api('PUT', '/api/scenes/s09/card', { card: { ...s.card, outcome: 'Tom lies to her.' } });
    await api('POST', '/api/commit', { message: 'Tom lies' });
    const cmp = await api('GET', '/api/branches/compare?a=main&b=what-if-tom-lies');
    expect(cmp.scenes.map((x: any) => x.id)).toEqual(['s09']);
    await api('POST', '/api/branches/switch', { name: 'main' });
    expect((await api('GET', '/api/scenes/s09')).card.outcome).not.toBe('Tom lies to her.');
  });

  it('exposes editable prompts', async () => {
    const prompts = await api('GET', '/api/prompts');
    expect(prompts.map((p: any) => p.name)).toContain('writer');
    await api('PUT', '/api/prompts/reader', { text: '# Reader\nBe brief.' });
    expect((await api('GET', '/api/prompts')).find((p: any) => p.name === 'reader')).toMatchObject({ overridden: true, text: '# Reader\nBe brief.' });
  });
});

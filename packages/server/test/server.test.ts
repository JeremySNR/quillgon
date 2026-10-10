import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphStore } from '@quillgon/core';
import { NovelServer } from '../src/index.js';
import { copyFixture } from '../../core/test/helpers.js';

process.env.QUILLGON_OFFLINE = '1';
let server: NovelServer;
let base = '';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-quillgon-token': server.token }, body: body ? JSON.stringify(body) : undefined });
  const json: any = await res.json();
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
  await s.checkpoint('Fixture');
  s.close();
  server = new NovelServer();
  server.open(dir);
  base = `http://127.0.0.1:${await server.listen(0)}`;
});
afterAll(() => server.close());

describe('server API', () => {
  it('lists covers offline and blocks generation before starting a paid job', async () => {
    expect(await api('GET', '/api/covers')).toMatchObject({ ready: false, covers: [] });
    await expect(api('POST', '/api/covers/generate', {})).rejects.toMatchObject({ status: 409 });
    await expect(api('POST', '/api/covers/generate', { style: 'invalid' })).rejects.toMatchObject({ status: 422 });
    await expect(api('GET', '/api/covers/not-a-cover/image')).rejects.toMatchObject({ status: 404 });
  });
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

  it('serves the ledger and keeps cards in step when an obligation moves', async () => {
    const { obligations, issues } = await api('GET', '/api/obligations');
    expect(obligations).toHaveLength(5);
    expect(issues).toEqual([]);
    const o = obligations.find((x: any) => x.id === 'kittiwake');
    await api('PUT', '/api/obligations/kittiwake', { obligation: { ...o, payoff_scene: 's10' } });
    const s09 = await api('GET', '/api/scenes/s09');
    const s10 = await api('GET', '/api/scenes/s10');
    expect(s09.card.pays_off).not.toContain('kittiwake');
    expect(s10.card.pays_off).toContain('kittiwake');
    await api('PUT', '/api/obligations/kittiwake', { obligation: o });
  });

  it('checks text against the style sheet and learns from hand edits', async () => {
    await api('PUT', '/api/style/sheet', { sheet: { prefer: [], never: ['tapestry'] } });
    const r = await api('POST', '/api/style/check', { text: 'A tapestry of nets.' });
    expect(r.violations).toEqual([expect.objectContaining({ rule: 'never', start: 2, end: 10 })]);
    const fp = await api('POST', '/api/style/fingerprint', { text: "The tide went out. 'Go,' she said." });
    expect(fp.suggested.quotes).toBe('single');
    for (const id of ['s01', 's02']) {
      const body = (await api('GET', `/api/scenes/${id}`)).prose.body as string;
      const word = body.match(/\bsea\b/) ? 'sea' : 'harbour';
      await api('PUT', `/api/scenes/${id}/prose`, { body: body.replace(new RegExp(`\\b${word}\\b`), word === 'sea' ? 'water' : 'quay') });
    }
    const { edits } = await api('GET', '/api/style/suggestions');
    expect(edits).toBe(2);
  });

  it('runs the plan critic, the predictability test and the outline reader', async () => {
    const c = await job('/api/critique');
    expect(c.level).toBe('book');
    expect((await api('GET', '/api/reports/critique')).ran_at).toBe(c.ran_at);
    const pr = await job('/api/scenes/s10/predictability');
    expect(['predictable', 'expected', 'surprising']).toContain(pr.verdict);
    const r = await job('/api/quality/reader', { mode: 'outline' });
    expect(r.mode).toBe('outline');
  });

  it('develops an idea into a premise', async () => {
    await api('POST', '/api/idea/start', { seed: 'A harbour where the tide tables are always wrong', genre: 'literary' });
    const b = await job('/api/idea/diverge', { personas: 2 });
    expect(b.pile.length).toBeGreaterThan(3);
    await api('POST', '/api/idea/mark', { id: b.pile[0].id, status: 'kept' });
    const l = await job('/api/idea/expand', { step: 'logline' });
    await api('POST', '/api/idea/choose', { step: 'logline', text: l.logline_options[0] });
    expect((await api('GET', '/api/idea')).logline).toBe(l.logline_options[0]);
  });

  it('talks an idea through, writing to the board, and undoes a turn', async () => {
    const before = await api('GET', '/api/idea');
    let b = await job('/api/idea/talk', { message: 'It should feel like a held breath.' });
    expect(b.tone).toBe('It should feel like a held breath.');
    expect(b.talk.slice(-2).map((t: any) => t.role)).toEqual(['author', 'partner']);
    const turn = b.talk.length - 1;
    expect(b.talk[turn].changes.map((c: any) => c.label)).toContain('Tone written');
    b = await api('POST', '/api/idea/talk/undo', { turn });
    expect(b.tone).toBe(before.tone);
    expect(b.talk[turn].undone).toBe(true);
    await expect(api('POST', '/api/idea/talk/undo', { turn })).rejects.toMatchObject({ status: 400 });
    b = await api('POST', '/api/idea/update', { patch: { never: ['No storms that arrive on cue'] } });
    expect(b.never).toEqual(['No storms that arrive on cue']);
    b = await api('POST', '/api/idea/talk/clear');
    expect(b.talk).toEqual([]);
    await expect(job('/api/idea/talk', { message: '   ' })).rejects.toThrow(/say something/);
  });

  it('exposes editable prompts', async () => {
    const prompts = await api('GET', '/api/prompts');
    expect(prompts.map((p: any) => p.name)).toContain('writer');
    await api('PUT', '/api/prompts/reader', { text: '# Reader\nBe brief.' });
    expect((await api('GET', '/api/prompts')).find((p: any) => p.name === 'reader')).toMatchObject({ overridden: true, text: '# Reader\nBe brief.' });
  });
});

/** Raw HTTP, so tests can forge the Host and Origin headers a browser would send. */
function raw(opts: { method?: string; path: string; headers?: Record<string, string>; body?: string; port?: number }): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: opts.port ?? Number(new URL(base).port), method: opts.method ?? 'GET', path: opts.path, headers: opts.headers }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
        // The event stream never ends; the first event is enough.
        if (String(res.headers['content-type']).startsWith('text/event-stream')) req.destroy();
      });
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      res.on('close', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe('server API boundary', () => {
  const auth = () => ({ 'x-quillgon-token': server.token });

  it('refuses API requests without the per-launch token', async () => {
    expect((await raw({ path: '/api/project' })).status).toBe(401);
    expect((await raw({ path: '/api/project', headers: { 'x-quillgon-token': 'nope' } })).status).toBe(401);
    expect((await raw({ path: '/api/project', headers: auth() })).status).toBe(200);
  });

  it('refuses a cross-site text/plain POST, the request a hostile page can send without a preflight', async () => {
    const r = await raw({ method: 'POST', path: '/api/commit', headers: { 'content-type': 'text/plain', origin: 'https://evil.example' }, body: '{"message":"pwned"}' });
    expect(r.status).toBe(403);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    // Even with the token, a non-JSON body never reaches a handler.
    expect((await raw({ method: 'POST', path: '/api/commit', headers: { ...auth(), 'content-type': 'text/plain' }, body: '{"message":"x"}' })).status).toBe(415);
  });

  it('refuses DNS-rebound requests by Host, and look-alike origins', async () => {
    expect((await raw({ path: '/api/project', headers: { ...auth(), host: 'attacker.example:4317' } })).status).toBe(421);
    expect((await raw({ path: '/', headers: { host: 'attacker.example' } })).status).toBe(421);
    expect((await raw({ path: '/api/project', headers: { ...auth(), origin: 'http://localhost.evil.com' } })).status).toBe(403);
    expect((await raw({ method: 'OPTIONS', path: '/api/commit', headers: { origin: 'http://localhost:9999' } })).status).toBe(403);
    // Same origin is fine.
    expect((await raw({ path: '/api/project', headers: { ...auth(), origin: base } })).status).toBe(200);
  });

  it('accepts the token in the URL only for read-only GETs that cannot send headers', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    const q = `?token=${encodeURIComponent(server.token)}`;
    expect((await raw({ path: `/api/covers/${id}/image` })).status).toBe(401);
    expect((await raw({ path: `/api/covers/${id}/image${q}` })).status).toBe(404); // authorised; no such cover
    expect((await raw({ path: `/api/project${q}` })).status).toBe(401);
    expect((await raw({ method: 'POST', path: `/api/commit${q}`, headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  });

  it('streams events only with the token', async () => {
    expect((await raw({ path: '/api/events' })).status).toBe(401);
    const ok = await raw({ path: `/api/events?token=${encodeURIComponent(server.token)}` });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('event: hello');
  });

  it('refuses git refs that could be read as options', async () => {
    await expect(api('POST', '/api/branches', { name: '--output=/tmp/x' })).rejects.toMatchObject({ status: 400 });
    await expect(api('GET', `/api/history/${encodeURIComponent('--output=/tmp/x')}`)).rejects.toMatchObject({ status: 400 });
    await expect(api('GET', '/api/branches/compare?a=-p&b=main')).rejects.toMatchObject({ status: 400 });
    await expect(api('GET', '/api/export?format=../../x')).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a model config that would send an arbitrary secret to an endpoint', async () => {
    const p = await api('GET', '/api/project');
    const models = { ...p.book.models, frontier: { provider: 'openai-compatible', model: 'x', base_url: 'https://evil.example/v1', api_key_env: 'AWS_SECRET_ACCESS_KEY' } };
    await expect(api('PUT', '/api/book', { book: { models } })).rejects.toMatchObject({ status: 422 });
    expect((await api('GET', '/api/project')).book.models.frontier?.api_key_env).toBeUndefined();
  });

  it('keeps the current book open when another fails to open', async () => {
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-bad-'));
    fs.mkdirSync(path.join(bad, 'book.yaml')); // exists, but cannot be read
    await expect(api('POST', '/api/open', { dir: bad })).rejects.toBeTruthy();
    expect((await api('GET', '/api/project')).book.title).toBe("The Tidekeeper's Ledger");
  });

  it('injects the token into the UI it serves', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ui-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><title>x</title></head><body></body></html>');
    const ui = new NovelServer({ staticDir: dir, token: 'fixed-token' });
    const port = await ui.listen(0);
    try {
      const r = await raw({ path: '/', port });
      expect(r.body).toContain('<meta name="quillgon-token" content="fixed-token" />');
      expect(r.headers['cache-control']).toBe('no-store');
      expect((await raw({ path: '/../../etc/passwd', port })).body).toContain('quillgon-token');
    } finally {
      ui.close();
    }
  });
});

describe('server jobs', () => {
  it('run one at a time, and refuse a branch switch while one runs', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = server.job('a', async () => {
      order.push('a start');
      await gate;
      order.push('a end');
    });
    const b = server.job('b', async () => {
      order.push('b start');
    });
    const queued = await api('GET', `/api/jobs/${b.job}`);
    expect(queued.stage).toBe('queued');
    await expect(api('POST', '/api/branches/switch', { name: 'main' })).rejects.toMatchObject({ status: 409 });
    release();
    for (;;) {
      if ((await api('GET', `/api/jobs/${b.job}`)).state === 'done') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(order).toEqual(['a start', 'a end', 'b start']);
    expect((await api('GET', `/api/jobs/${a.job}`)).state).toBe('done');
  });

  it('a failed job does not block the queue', async () => {
    await expect(job('/api/scenes/nope/write')).rejects.toThrow();
    expect((await job('/api/quality/reader', { mode: 'outline' })).mode).toBe('outline');
  });
});

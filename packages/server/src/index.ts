import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  AgentName,
  analyseImpact,
  Engine,
  GraphStore,
  initProject,
  paths,
  readerMarkdown,
  Ripple,
  SchemaError,
  sceneOrder,
  type Change,
  type ReaderReport,
} from '@novel/core';
import { builtinPrompt, createSuite, loadPrompt } from '@novel/agents';
import { projectSnapshot, sceneDetail } from './snapshot.js';
import { exportManuscript } from './export.js';

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  engine: Engine;
  server: NovelServer;
}

interface Job {
  id: string;
  name: string;
  state: 'running' | 'done' | 'error';
  stage: string;
  detail: string;
  result?: unknown;
  error?: string;
  started: number;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

const RECENT = path.join(os.homedir(), '.novel-engine', 'recent.json');

/**
 * The local boundary between the UI and the core. JSON over HTTP, server-sent events for
 * job progress and file changes. Single user, binds to localhost only.
 */
export class NovelServer {
  engine: Engine | null = null;
  private routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler; open: boolean }[] = [];
  private clients = new Set<http.ServerResponse>();
  private jobs = new Map<string, Job>();
  private watcher: fs.FSWatcher | null = null;
  private quietUntil = 0;
  private reloadTimer: NodeJS.Timeout | null = null;
  readonly http: http.Server;

  constructor(private opts: { staticDir?: string } = {}) {
    this.http = http.createServer((req, res) => this.handle(req, res));
    this.register();
  }

  listen(port = 4317, host = '127.0.0.1'): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, host, () => resolve((this.http.address() as { port: number }).port));
    });
  }

  close() {
    this.watcher?.close();
    for (const c of this.clients) c.end();
    this.engine?.store.close();
    this.http.close();
  }

  // ------------------------------------------------------------------ project lifecycle

  open(dir: string) {
    const abs = path.resolve(dir);
    if (!fs.existsSync(path.join(abs, paths.book))) throw new HttpError(404, `no book.yaml in ${abs}`);
    this.watcher?.close();
    this.engine?.store.close();
    const store = GraphStore.open(abs);
    const engine = new Engine(store, createSuite(store));
    this.engine = engine;
    store.on((e) => {
      this.quietUntil = Date.now() + 800;
      this.broadcast('store', e);
    });
    this.watch(abs);
    rememberRecent(abs, store.book.title);
    return engine;
  }

  private watch(dir: string) {
    try {
      this.watcher = fs.watch(dir, { recursive: true }, (_ev, file) => {
        if (!file || /^(\.engine|\.git|reports)[\\/]?/.test(String(file))) return;
        if (Date.now() < this.quietUntil) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.engine?.store.reload();
          this.broadcast('reloaded', { file: String(file) });
        }, 300);
      });
    } catch {
      // Recursive watch unsupported: external edits show up on next reload.
    }
  }

  // ------------------------------------------------------------------ events and jobs

  broadcast(type: string, data: unknown) {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(msg);
  }

  /** Run a long operation in the background; progress and completion go out over SSE. */
  job(name: string, fn: (progress: (stage: string, detail?: string) => void) => Promise<unknown>): { job: string } {
    const id = `${name}-${Date.now().toString(36)}`;
    const job: Job = { id, name, state: 'running', stage: 'starting', detail: '', started: Date.now() };
    this.jobs.set(id, job);
    this.broadcast('job', job);
    const progress = (stage: string, detail = '') => {
      job.stage = stage;
      job.detail = detail;
      this.broadcast('job', job);
    };
    fn(progress)
      .then((result) => {
        job.state = 'done';
        job.result = result;
      })
      .catch((e: Error) => {
        job.state = 'error';
        job.error = e instanceof SchemaError ? e.message : e.message;
      })
      .finally(() => {
        this.broadcast('job', job);
        // Keep finished jobs a while for late pollers.
        setTimeout(() => this.jobs.delete(id), 10 * 60_000);
      });
    return { job: id };
  }

  // ------------------------------------------------------------------ routing

  private route(method: string, p: string, handler: Handler, open = false) {
    const keys: string[] = [];
    const pattern = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    this.routes.push({ method, pattern, keys, handler, open });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('access-control-allow-origin', req.headers.origin && /^(http:\/\/(localhost|127\.0\.0\.1)(:\d+)?|file:\/\/|app:\/\/)/.test(req.headers.origin) ? req.headers.origin : 'http://localhost');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return void res.end();

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: hello\ndata: {}\n\n`);
      this.clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        this.clients.delete(res);
      });
      return;
    }

    if (!url.pathname.startsWith('/api/')) return this.serveStatic(url.pathname, res);

    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.pattern);
      if (!m) continue;
      try {
        const body = req.method === 'GET' ? {} : await readBody(req);
        if (!r.open && !this.engine) throw new HttpError(409, 'no project is open');
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const out = await r.handler({ params, query: url.searchParams, body, engine: this.engine!, server: this });
        return send(res, 200, out ?? { ok: true });
      } catch (e) {
        if (e instanceof SchemaError) return send(res, 422, { error: e.message, issues: e.issues });
        if (e instanceof HttpError) return send(res, e.status, { error: e.message, data: e.data });
        return send(res, 400, { error: (e as Error).message });
      }
    }
    send(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
  }

  private serveStatic(p: string, res: http.ServerResponse) {
    const dir = this.opts.staticDir;
    if (!dir || !fs.existsSync(dir)) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('Novel Engine API. Build the UI with `pnpm build` or run `pnpm dev`.');
    }
    let file = path.join(dir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  // ------------------------------------------------------------------ API

  private register() {
    const r = this.route.bind(this);

    // --- app & projects
    r('GET', '/api/health', ({ server }) => ({ ok: true, open: server.engine?.store.dir ?? null, recent: recent() }), true);
    r('POST', '/api/open', ({ body, server }) => (server.open(body.dir), { ok: true }), true);
    r(
      'POST',
      '/api/init',
      async ({ body, server }) => {
        const dir = path.resolve(expandHome(body.dir));
        const store = await initProject(dir, { title: body.title, genre: body.genre, target_words: Number(body.target_words) || 12000, offline: !!body.offline });
        store.close();
        server.open(dir);
        return { ok: true, dir };
      },
      true,
    );
    r('GET', '/api/jobs/:id', ({ params, server }) => server.jobs.get(params.id) ?? { id: params.id, state: 'gone' }, true);

    r('GET', '/api/project', ({ engine }) => projectSnapshot(engine));
    r('POST', '/api/reload', ({ engine }) => (engine.store.reload(), { ok: true }));

    // --- scenes
    r('GET', '/api/scenes/:id', ({ engine, params }) => sceneDetail(engine.store, params.id));
    r('PUT', '/api/scenes/:id/card', async ({ engine, params, body }) => {
      const before = structuredClone(engine.store.scene(params.id).card);
      const entry = engine.store.saveCard({ ...body.card, id: params.id });
      const change: Change = { kind: 'card', scene: params.id, before, after: entry.card };
      const impact = analyseImpact(engine.store.project, change, engine.store.index);
      return { scene: sceneDetail(engine.store, params.id), change, impact };
    });
    r('PUT', '/api/scenes/:id/prose', ({ engine, params, body }) => {
      engine.store.saveProse(params.id, String(body.body ?? ''), 'author');
      return sceneDetail(engine.store, params.id);
    });
    r('POST', '/api/scenes/:id/status', async ({ engine, params, body }) => {
      engine.store.setSceneStatus(params.id, { ...(body.status ? { status: body.status } : {}), ...(body.lock ? { lock: body.lock } : {}) });
      await engine.store.commit(`${params.id}: ${[body.status, body.lock && `lock ${body.lock}`].filter(Boolean).join(', ')}`);
      return sceneDetail(engine.store, params.id);
    });
    r('POST', '/api/scenes/:id/mark-in-sync', ({ engine, params }) => (engine.store.markInSync(params.id), sceneDetail(engine.store, params.id)));
    r('POST', '/api/scenes/:id/write', ({ engine, params, server }) => server.job('write', (progress) => engine.pipeline.writeScene(params.id, { progress }).then((r) => ({ words: r.words, contradictions: r.extraction.contradictions, style: r.style }))));
    r('POST', '/api/scenes/:id/regenerate', ({ engine, params, body, server }) => server.job('regenerate', () => engine.pipeline.regenerate(params.id, body.mode === 'fresh' ? 'fresh' : 'minimal', body.change)));
    r('POST', '/api/scenes/:id/accept-prose', ({ engine, params, body, server }) => server.job('accept-prose', () => engine.pipeline.acceptProse(params.id, String(body.body)).then((ex) => ({ contradictions: ex.contradictions }))));
    r('POST', '/api/scenes/:id/reconcile', ({ engine, params, server }) =>
      server.job('reconcile', async () => {
        const r = await engine.pipeline.reconcileProseEdit(params.id);
        return { presentationOnly: r.presentationOnly, diff: r.extraction.diff, contradictions: r.extraction.contradictions, proposedCard: r.extraction.proposedCard };
      }),
    );
    r('POST', '/api/scenes/:id/accept-facts', async ({ engine, params }) => {
      const change = engine.pipeline.acceptProseFacts(params.id);
      const ripple = await engine.startRipple(change);
      return { ripple: ripple.data };
    });
    r('POST', '/api/scenes/:id/style', ({ engine, params, server }) =>
      server.job('style', async (progress) => {
        const { runStylePasses } = await import('@novel/core');
        const s = engine.store.scene(params.id);
        if (!s.prose) throw new Error('no prose yet');
        const out = await runStylePasses(engine.store, engine.agents, params.id, s.prose.body, progress);
        return { before: s.prose.body, after: out.prose, report: out.report };
      }),
    );
    r('POST', '/api/scenes', async ({ engine, body }) => {
      const p = engine.store.project;
      const max = Math.max(0, ...[...p.scenes.keys()].map((id) => Number(id.replace(/\D+/g, '')) || 0));
      const id = body.id ?? `s${String(max + 1).padStart(p.scenes.size >= 99 ? 3 : 2, '0')}`;
      const pov = body.pov ?? [...p.characters.keys()][0];
      if (!pov) throw new HttpError(400, 'add a character first');
      engine.store.saveCard({ id, title: body.title ?? 'New scene', pov, location: body.location ?? p.locations.locations[0]?.id ?? 'somewhere', characters: [pov] });
      const st = structuredClone(p.structure);
      const ch = st.acts.flatMap((a) => a.chapters).find((c) => c.id === body.chapter) ?? st.acts[0]?.chapters[0];
      if (ch) {
        const at = body.after ? ch.scenes.indexOf(body.after) + 1 : ch.scenes.length;
        ch.scenes.splice(at, 0, id);
        engine.store.saveStructure(st);
      }
      await engine.store.commit(`Add scene ${id}`);
      return { id };
    });
    r('DELETE', '/api/scenes/:id', async ({ engine, params, query }) => {
      const orderBefore = sceneOrder(engine.store.project);
      const card = structuredClone(engine.store.scene(params.id).card);
      engine.store.deleteScene(params.id);
      const change: Change = { kind: 'delete-scene', scene: params.id, card, orderBefore };
      if (query.get('ripple') === '1') return { ripple: (await engine.startRipple(change)).data };
      await engine.store.commit(`Delete scene ${params.id}`);
      return { impact: analyseImpact(engine.store.project, change, engine.store.index) };
    });

    // --- structure (reorder)
    r('PUT', '/api/structure', ({ engine, body }) => {
      const before = sceneOrder(engine.store.project);
      engine.store.saveStructure(body.structure);
      const after = sceneOrder(engine.store.project);
      const change: Change = { kind: 'reorder', before, after };
      const changed = before.join() !== after.join();
      return { change: changed ? change : null, impact: changed ? analyseImpact(engine.store.project, change, engine.store.index) : null };
    });

    // --- other entities
    r('PUT', '/api/threads/:id', ({ engine, params, body }) => {
      const before = engine.store.project.threads.get(params.id) ?? null;
      const after = engine.store.saveThread({ ...body.thread, id: params.id });
      const change: Change = { kind: 'thread', before, after };
      return { change, impact: analyseImpact(engine.store.project, change, engine.store.index) };
    });
    r('DELETE', '/api/threads/:id', ({ engine, params }) => {
      const before = engine.store.project.threads.get(params.id) ?? null;
      engine.store.deleteThread(params.id);
      return { change: { kind: 'thread', before, after: null } };
    });
    r('PUT', '/api/plot-points/:id', ({ engine, params, body }) => {
      const before = engine.store.project.plotPoints.get(params.id) ?? null;
      const after = engine.store.savePlotPoint({ ...body.plotPoint, id: params.id });
      const change: Change = { kind: 'plot', before, after };
      return { change, impact: analyseImpact(engine.store.project, change, engine.store.index) };
    });
    r('DELETE', '/api/plot-points/:id', ({ engine, params }) => (engine.store.deletePlotPoint(params.id), { ok: true }));
    r('PUT', '/api/characters/:id', ({ engine, params, body }) => {
      const prev = engine.store.project.characters.get(params.id);
      engine.store.saveCharacter({ bio: { ...(prev?.bio ?? {}), ...body.bio, id: params.id }, voice: body.voice ?? prev?.voice });
      const field = body.voice && prev && JSON.stringify(body.voice) !== JSON.stringify(prev.voice) ? 'voice' : 'bio';
      const change: Change = { kind: 'character', character: params.id, field };
      return { change, impact: prev ? analyseImpact(engine.store.project, change, engine.store.index) : null };
    });
    r('PUT', '/api/characters/:id/state/:scene', ({ engine, params, body }) => {
      const change = engine.editState(params.id, params.scene, body.snapshot);
      return { change, impact: analyseImpact(engine.store.project, change, engine.store.index) };
    });
    r('PUT', '/api/intent', async ({ engine, body }) => (engine.store.saveIntent({ ...engine.store.project.intent, ...body.intent }), await engine.store.commit('Edit intent'), { ok: true }));
    r('PUT', '/api/book', async ({ engine, body }) => (engine.store.saveBook({ ...engine.store.book, ...body.book }), await engine.store.commit('Edit book settings'), { ok: true }));
    r('PUT', '/api/style', async ({ engine, body }) => (engine.store.saveStyle(body), await engine.store.commit('Edit style'), { ok: true }));
    r('POST', '/api/commit', async ({ engine, body }) => ({ hash: await engine.store.commit(body.message || 'Checkpoint') }));

    // --- impact & ripples
    r('POST', '/api/impact', ({ engine, body }) => analyseImpact(engine.store.project, body.change, engine.store.index));
    r('POST', '/api/ripple/start', async ({ engine, body }) => (await engine.startRipple(body.change, body.options)).data);
    r('GET', '/api/ripple', ({ engine }) => Ripple.current(engine.store, engine.agents)?.data ?? null);
    r('GET', '/api/ripples', ({ engine }) => Ripple.list(engine.store).map((d) => ({ id: d.id, created: d.created, description: d.description, state: d.state, rounds: d.rounds.length })));
    r('GET', '/api/ripples/:id', ({ engine, params }) => Ripple.load(engine.store, engine.agents, params.id).data);
    const rip = (engine: Engine, id?: string) => {
      const x = id ? Ripple.load(engine.store, engine.agents, id) : Ripple.current(engine.store, engine.agents);
      if (!x) throw new HttpError(404, 'no ripple in progress');
      return x;
    };
    r('POST', '/api/ripple/propose', ({ engine, body, server }) => server.job('propose', async (progress) => (await rip(engine).propose(body.scene, progress), rip(engine).data)));
    r('POST', '/api/ripple/accept', ({ engine, body }) => (rip(engine).accept(body.scene, body.card), rip(engine).data));
    r('POST', '/api/ripple/reject', ({ engine, body }) => (rip(engine).reject(body.scene), rip(engine).data));
    r('POST', '/api/ripple/reopen', ({ engine, body }) => (rip(engine).reopen(body.scene), rip(engine).data));
    r('POST', '/api/ripple/propose-prose', ({ engine, body, server }) => server.job('propose-prose', async (progress) => (await rip(engine).proposeProse(body.scene, progress), rip(engine).data)));
    r('POST', '/api/ripple/accept-prose', ({ engine, body }) => (rip(engine).acceptProse(body.scene, body.body), rip(engine).data));
    r('POST', '/api/ripple/reject-prose', ({ engine, body }) => (rip(engine).rejectProse(body.scene), rip(engine).data));
    r('POST', '/api/ripple/resolve', async ({ engine, body }) => {
      const x = rip(engine);
      await x.resolveConflict(body.scene, body.resolution);
      return x.data;
    });
    r('POST', '/api/ripple/expand', ({ engine, body }) => (rip(engine).expand(body.scene), rip(engine).data));
    r('POST', '/api/ripple/apply', ({ engine, server }) => server.job('apply', async (progress) => {
      const x = rip(engine);
      await x.apply(progress);
      return x.data;
    }));
    r('POST', '/api/ripple/revert', ({ engine, body, server }) => server.job('revert', async () => {
      const x = rip(engine, body.id);
      await x.revert();
      return x.data;
    }));
    r('POST', '/api/ripple/abandon', ({ engine }) => (rip(engine).abandon(), { ok: true }));

    // --- pipeline
    const pl = (e: Engine) => e.pipeline;
    r('GET', '/api/pipeline', ({ engine }) => {
      const P = pl(engine).proposals;
      return {
        stage: engine.store.book.stage,
        interview: P.get('interview'),
        structures: P.get('structures'),
        cast: P.get('cast'),
        cards: Object.fromEntries(P.list().filter((n) => n.startsWith('cards-')).map((n) => [n.slice(6), P.get(n)])),
        extractions: P.list().filter((n) => n.startsWith('extract-')).map((n) => n.slice(8)),
      };
    });
    r('POST', '/api/pipeline/interview', ({ engine, body, server }) => server.job('interview', () => pl(engine).interview(body.premise, body.answers ?? [])));
    r('POST', '/api/pipeline/approve-intent', ({ engine, body }) => pl(engine).approveIntent(body.intent));
    r('POST', '/api/pipeline/pin-plot-point', async ({ engine, body }) => {
      const pp = pl(engine).pinPlotPoint(body.plotPoint);
      await engine.store.commit(`Pin plot point ${pp.id}`);
      return pp;
    });
    r('POST', '/api/pipeline/propose-plot-points', ({ engine, server }) => server.job('plot-points', () => pl(engine).proposePlotPoints()));
    r('POST', '/api/pipeline/accept-plot-point', ({ engine, body }) => pl(engine).acceptPlotPoint(body.id, body.edits ?? {}));
    r('POST', '/api/pipeline/reject-plot-point', ({ engine, body }) => (pl(engine).rejectPlotPoint(body.id), { ok: true }));
    r('POST', '/api/pipeline/finish-plot-points', async ({ engine }) => (await pl(engine).finishPlotPoints(), { ok: true }));
    r('POST', '/api/pipeline/propose-structures', ({ engine, body, server }) => server.job('structures', () => pl(engine).proposeStructures({ more: !!body.more })));
    r('POST', '/api/pipeline/pick-structure', async ({ engine, body }) => pl(engine).pickStructure(Number(body.index)));
    r('POST', '/api/pipeline/propose-cards', ({ engine, body, server }) => server.job('cards', () => pl(engine).proposeCards(body.chapter)));
    r('POST', '/api/pipeline/pick-cards', async ({ engine, body }) => ({ scenes: await pl(engine).pickCards(body.chapter, Number(body.index)) }));
    r('POST', '/api/pipeline/default-cards', ({ engine, server }) => server.job('cards', (progress) => pl(engine).defaultCards(progress)));
    r('POST', '/api/pipeline/write-chapter', ({ engine, body, server }) => server.job('write', (progress) => pl(engine).writeChapter(body.chapter, { progress }).then((r) => r.map((x) => ({ scene: x.scene, words: x.words, contradictions: x.extraction.contradictions.length })))));
    r('POST', '/api/pipeline/write-all', ({ engine, server }) =>
      server.job('write', async (progress) => {
        const out: { scene: string; words: number }[] = [];
        for (const ch of pl(engine).chapters()) {
          if (ch.scenes.every((s) => engine.store.scene(s).prose)) continue;
          for (const r of await pl(engine).writeChapter(ch.id, { progress })) out.push({ scene: r.scene, words: r.words });
        }
        return out;
      }),
    );
    r('POST', '/api/pipeline/approve', async ({ engine, body }) => (pl(engine).approve(body.scenes), await engine.store.commit(`Approve ${body.scenes.join(', ')}`), { ok: true }));

    // --- quality
    r('POST', '/api/quality/reader', ({ engine, body, server }) => server.job('reader', (progress) => engine.reader({ act: body.act, progress })));
    r('POST', '/api/quality/continuity', ({ engine, body, server }) => server.job('continuity', (progress) => engine.continuity({ model: body.model !== false, progress })));
    r('POST', '/api/quality/voice', async ({ engine }) => engine.voice());
    r('GET', '/api/reports/reader', ({ engine }) =>
      engine.store
        .listReports('reader-')
        .filter((f) => f.endsWith('.json'))
        .reverse()
        .map((f) => {
          const r = JSON.parse(engine.store.readReport(f)!) as ReaderReport;
          return { id: r.id, ran_at: r.ran_at, scope: r.scope, mean: r.mean_engagement, scenes: r.scenes.length };
        }),
    );
    r('GET', '/api/reports/reader/:id', ({ engine, params }) => {
      const t = engine.store.readReport(`reader-${params.id}.json`);
      if (!t) throw new HttpError(404, 'no such report');
      return JSON.parse(t);
    });
    r('GET', '/api/reports/reader/:id/markdown', ({ engine, params }) => ({ markdown: readerMarkdown(JSON.parse(engine.store.readReport(`reader-${params.id}.json`)!)) }));
    r('GET', '/api/reports/voice', ({ engine }) => JSON.parse(engine.store.readReport('voice-latest.json') ?? 'null'));
    r('GET', '/api/reports/inconsistencies', ({ engine }) => ({ markdown: engine.store.readReport('known-inconsistencies.md') ?? '' }));
    r('GET', '/api/estimate', ({ engine }) => engine.estimate());

    // --- history & branches
    r('GET', '/api/history', async ({ engine, query }) => engine.store.repo.log(Number(query.get('limit')) || 100));
    r('GET', '/api/history/:hash', async ({ engine, params }) => engine.store.repo.show(params.hash));
    r('POST', '/api/history/revert', ({ engine, body, server }) => server.job('revert', async () => {
      await engine.store.commit('Checkpoint before revert');
      await engine.store.repo.revert(body.hash);
      engine.store.reload();
      return { ok: true };
    }));
    r('GET', '/api/branches', async ({ engine }) => engine.store.repo.branches());
    r('POST', '/api/branches', async ({ engine, body }) => (await engine.store.repo.createBranch(body.name), engine.store.reload(), { ok: true }));
    r('POST', '/api/branches/switch', async ({ engine, body }) => (await engine.store.repo.switchBranch(body.name), engine.store.reload(), { ok: true }));
    r('POST', '/api/branches/merge', async ({ engine, body }) => {
      const out = await engine.store.repo.merge(body.from);
      engine.store.reload();
      return out;
    });
    r('DELETE', '/api/branches/:name', async ({ engine, params }) => (await engine.store.repo.deleteBranch(params.name), { ok: true }));
    r('GET', '/api/branches/compare', async ({ engine, query }) => {
      const a = query.get('a') ?? 'main';
      const b = query.get('b') ?? (await engine.store.repo.currentBranch());
      const files = await engine.store.repo.changedBetween(a, b);
      const scenes = [...new Set(files.filter((f) => f.startsWith('scenes/')).map((f) => f.split('/')[1]))];
      return {
        a,
        b,
        files,
        scenes: await Promise.all(
          scenes.map(async (id) => ({
            id,
            card: { a: await engine.store.repo.readAt(a, `scenes/${id}/card.yaml`), b: await engine.store.repo.readAt(b, `scenes/${id}/card.yaml`) },
            prose: { a: await engine.store.repo.readAt(a, `scenes/${id}/prose.md`), b: await engine.store.repo.readAt(b, `scenes/${id}/prose.md`) },
          })),
        ),
      };
    });

    // --- prompts (editable in the app)
    r('GET', '/api/prompts', ({ engine }) =>
      AgentName.options.map((name) => {
        const override = path.join(engine.store.dir, 'prompts', `${name}.md`);
        return { name, text: loadPrompt(name, engine.store.dir), builtin: builtinPrompt(name), overridden: fs.existsSync(override) };
      }),
    );
    r('PUT', '/api/prompts/:name', async ({ engine, params, body }) => {
      if (!AgentName.safeParse(params.name).success) throw new HttpError(404, `no agent "${params.name}"`);
      const file = path.join(engine.store.dir, 'prompts', `${params.name}.md`);
      if (body.reset) fs.rmSync(file, { force: true });
      else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, String(body.text));
      }
      await engine.store.commit(`${body.reset ? 'Reset' : 'Edit'} ${params.name} prompt`);
      return { ok: true };
    });

    // --- export
    r('GET', '/api/export', ({ engine, query }) => exportManuscript(engine.store, (query.get('format') as 'md' | 'docx' | 'epub') ?? 'md'));
  }
}

// ------------------------------------------------------------------ helpers

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function expandHome(p: string) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function recent(): { dir: string; title: string; opened: string }[] {
  try {
    return (JSON.parse(fs.readFileSync(RECENT, 'utf8')) as { dir: string; title: string; opened: string }[]).filter((r) => fs.existsSync(path.join(r.dir, 'book.yaml')));
  } catch {
    return [];
  }
}

function rememberRecent(dir: string, title: string) {
  const list = [{ dir, title, opened: new Date().toISOString() }, ...recent().filter((r) => r.dir !== dir)].slice(0, 12);
  try {
    fs.mkdirSync(path.dirname(RECENT), { recursive: true });
    fs.writeFileSync(RECENT, JSON.stringify(list, null, 2));
  } catch {
    // not fatal
  }
}

export function hasPandoc(): boolean {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export { projectSnapshot, sceneDetail };
export { exportManuscript, manuscriptMarkdown } from './export.js';

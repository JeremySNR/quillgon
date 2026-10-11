import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  AgentName,
  analyseImpact,
  Engine,
  GraphStore,
  initProject,
  paths,
  checkStyle,
  fingerprint,
  obligationIssues,
  readEdits,
  readerMarkdown,
  recordEdit,
  Ripple,
  runStyleCheck,
  suggestRules,
  suggestSheet,
  SchemaError,
  InvalidRefError,
  RevertConflictError,
  assertRef,
  sceneOrder,
  type Change,
  type ReaderReport,
  type StructureAlternative,
} from '@quillgon/core';
import { builtinPrompt, createSuite, loadPrompt } from '@quillgon/agents';
import { projectSnapshot, sceneDetail } from './snapshot.js';
import { exportManuscript } from './export.js';
import { coverAvailability, coverImage, CoverOptions, generateCover, listCovers } from './covers.js';
import { DictateRequest, dictate, voiceStatus } from './dictation.js';

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

/** A non-JSON response body (a recording). */
class Binary {
  constructor(public type: string, public data: Buffer) {}
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

const RECENT = path.join(os.homedir(), '.quillgon', 'recent.json');
const MAX_BODY = 20 * 1024 * 1024;
const TOKEN_HEADER = 'x-quillgon-token';
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const EXPORT_FORMATS = new Set(['md', 'docx', 'epub']);

export interface ServerOptions {
  staticDir?: string;
  /** Required on every API request. Defaults to QUILLGON_TOKEN, else a random per-launch value. */
  token?: string;
  /** Extra browser origins allowed to call the API (same-origin requests are always allowed). */
  allowedOrigins?: string[];
}

/**
 * The local boundary between the UI and the core. JSON over HTTP, server-sent events for
 * job progress and file changes. Single user, binds to localhost only.
 *
 * Binding to localhost is not enough on its own: any web page the author visits can send
 * requests to 127.0.0.1, and DNS rebinding can make those requests same-origin. So every
 * API request must carry the per-launch token (injected into the UI's index.html), the
 * Host header must be a loopback name, browser requests must come from an allowed origin,
 * and request bodies must be JSON.
 */
export class NovelServer {
  engine: Engine | null = null;
  private routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler; open: boolean }[] = [];
  private clients = new Set<http.ServerResponse>();
  private jobs = new Map<string, Job>();
  private watcher: fs.FSWatcher | null = null;
  private quietUntil = 0;
  private reloadTimer: NodeJS.Timeout | null = null;
  /** Jobs run one at a time: they share one store, one index and one git repo. */
  private queue: Promise<unknown> = Promise.resolve();
  private active = 0;
  /** An external edit that arrived while a job was running; reloaded when the queue drains. */
  private pendingReload: string | null = null;
  readonly http: http.Server;
  readonly token: string;
  private allowedOrigins: Set<string>;

  constructor(private opts: ServerOptions = {}) {
    this.token = opts.token || process.env.QUILLGON_TOKEN || randomBytes(24).toString('base64url');
    this.allowedOrigins = new Set(opts.allowedOrigins ?? []);
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
    if (typeof dir !== 'string' || !dir.trim()) throw new HttpError(400, 'dir is required');
    const abs = path.resolve(expandHome(dir));
    if (!fs.existsSync(path.join(abs, paths.book))) throw new HttpError(404, `no book.yaml in ${abs}`);
    // Open the new book before closing the current one, so a book that fails to load
    // leaves the current one usable.
    const store = GraphStore.open(abs);
    const engine = new Engine(store, createSuite(store));
    this.watcher?.close();
    this.watcher = null;
    this.engine?.store.close();
    this.engine = engine;
    store.on((e) => {
      this.quietUntil = Date.now() + 800;
      this.broadcast('store', e);
    });
    this.watch(abs);
    rememberRecent(abs, store.book.title, store.book.kind);
    this.broadcast('reloaded', { opened: abs });
    return engine;
  }

  private watch(dir: string) {
    try {
      this.watcher = fs.watch(dir, { recursive: true }, (_ev, file) => {
        if (!file || /^(\.engine|\.git|reports|audio)[\\/]?/.test(String(file))) return;
        if (Date.now() < this.quietUntil) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.externalReload(String(file)), 300);
      });
    } catch {
      // Recursive watch unsupported: external edits show up on next reload.
    }
  }

  /** Never swap the project out from under a running job: wait for the queue to drain. */
  private externalReload(file: string) {
    if (this.active) {
      this.pendingReload = file;
      return;
    }
    this.engine?.store.reload();
    this.broadcast('reloaded', { file });
  }

  /** Refuse operations that replace the whole project (branch switch, revert) while a job runs. */
  assertIdle(what: string) {
    if (this.active) throw new HttpError(409, `wait for the running job to finish before you ${what}`);
  }

  // ------------------------------------------------------------------ events and jobs

  broadcast(type: string, data: unknown) {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(msg);
  }

  /** Run a long operation in the background; progress and completion go out over SSE. */
  job(name: string, fn: (progress: (stage: string, detail?: string) => void) => Promise<unknown>, opts: { queue?: boolean } = {}): { job: string } {
    const id = `${name}-${randomUUID().slice(0, 8)}`;
    // Store jobs share one store, index and repo, so they queue; independent ones (queue: false) don't.
    const inQueue = opts.queue !== false;
    const queued = inQueue && this.active > 0;
    const job: Job = { id, name, state: 'running', stage: queued ? 'queued' : 'starting', detail: queued ? 'Waiting for the current job to finish' : '', started: Date.now() };
    this.jobs.set(id, job);
    if (inQueue) this.active++;
    this.broadcast('job', job);
    const progress = (stage: string, detail = '') => {
      job.stage = stage;
      job.detail = detail;
      this.broadcast('job', job);
    };
    const run = inQueue
      ? this.queue.then(() => {
          if (queued) progress('starting');
          return fn(progress);
        })
      : Promise.resolve().then(() => fn(progress));
    if (inQueue) this.queue = run.catch(() => undefined);
    run
      .then((result) => {
        job.state = 'done';
        job.result = result;
      })
      .catch((e: Error) => {
        job.state = 'error';
        job.error = e.message;
      })
      .finally(() => {
        if (inQueue) this.active--;
        this.broadcast('job', job);
        if (!this.active && this.pendingReload) {
          const file = this.pendingReload;
          this.pendingReload = null;
          this.externalReload(file);
        }
        // Keep finished jobs a while for late pollers.
        setTimeout(() => this.jobs.delete(id), 10 * 60_000).unref();
      });
    return { job: id };
  }

  // ------------------------------------------------------------------ routing

  private route(method: string, p: string, handler: Handler, open = false) {
    const keys: string[] = [];
    const pattern = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    this.routes.push({ method, pattern, keys, handler, open });
  }

  /** A browser origin is allowed if it is this server itself or explicitly configured. */
  private originAllowed(origin: string | undefined, host: string): boolean {
    if (!origin) return true; // not a browser, or a same-origin GET
    return origin === `http://${host}` || this.allowedOrigins.has(origin);
  }

  private tokenMatches(given: string | null | undefined): boolean {
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const host = req.headers.host ?? '';
    // DNS rebinding: a page on attacker.example resolved to 127.0.0.1 still sends its own Host.
    if (!LOOPBACK_HOST.test(host)) return send(res, 421, { error: 'unexpected Host header' });
    const origin = req.headers.origin;
    const allowed = this.originAllowed(origin, host);
    if (origin && allowed && origin !== `http://${host}`) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', `content-type, ${TOKEN_HEADER}`);
      res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return void res.writeHead(allowed ? 204 : 403).end();

    if (!url.pathname.startsWith('/api/')) return this.serveStatic(url.pathname, res);

    if (!allowed) return send(res, 403, { error: 'origin not allowed' });
    const given = req.headers[TOKEN_HEADER];
    // EventSource, <img> and download links cannot set headers, so the event stream and
    // cover images (read-only GETs) also accept ?token=.
    const queryToken = req.method === 'GET' && (url.pathname === '/api/events' || /^\/api\/covers\/[^/]+\/image$/.test(url.pathname) || /^\/api\/sessions\/[^/]+\/audio\/[^/]+$/.test(url.pathname));
    const token = typeof given === 'string' ? given : queryToken ? url.searchParams.get('token') : null;
    if (!this.tokenMatches(token)) return send(res, 401, { error: 'missing or invalid API token' });

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
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'request body must be a JSON object');
        if (!r.open && !this.engine) throw new HttpError(409, 'no project is open');
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const out = await r.handler({ params, query: url.searchParams, body, engine: this.engine!, server: this });
        if (Buffer.isBuffer(out)) {
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', ...(url.searchParams.has('download') ? { 'content-disposition': 'attachment; filename="book-cover.png"' } : {}) });
          return void res.end(out);
        }
        if (out instanceof Binary) {
          res.writeHead(200, { 'content-type': out.type, 'cache-control': 'no-store' });
          return void res.end(out.data);
        }
        return send(res, 200, out === undefined ? { ok: true } : out);
      } catch (e) {
        if (e instanceof SchemaError) return send(res, 422, { error: e.message, issues: e.issues });
        if (e instanceof HttpError) return send(res, e.status, { error: e.message, data: e.data });
        if (e instanceof InvalidRefError) return send(res, 400, { error: e.message });
        if (e instanceof RevertConflictError) return send(res, 409, { error: e.message, data: { files: e.files } });
        // Programming errors are the server's fault; everything else is a refused request.
        if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError) {
          console.error(e);
          return send(res, 500, { error: (e as Error).message });
        }
        return send(res, 400, { error: (e as Error).message });
      }
    }
    send(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
  }

  private serveStatic(p: string, res: http.ServerResponse) {
    const dir = this.opts.staticDir;
    if (!dir || !fs.existsSync(dir)) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('Quillgon API. Build the UI with `pnpm build` or run `pnpm dev`.');
    }
    const root = path.resolve(dir);
    let file = path.join(root, path.normalize(decodeURIComponentSafe(p)).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.json': 'application/json' };
    if (path.extname(file) === '.html') {
      // The UI reads its API token from here. Only same-machine pages can read it: the Host
      // check refuses rebound DNS names, and there are no CORS headers for other origins.
      const html = fs.readFileSync(file, 'utf8').replace('</head>', `  <meta name="quillgon-token" content="${this.token}" />\n  </head>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(html);
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  // ------------------------------------------------------------------ API

  private register() {
    const r = this.route.bind(this);

    // --- app & projects
    r('GET', '/api/health', ({ server }) => ({ ok: true, open: server.engine?.store.dir ?? null, recent: recent() }), true);
    r('POST', '/api/open', ({ body, server }) => (server.assertIdle('open another book'), server.open(body.dir), { ok: true }), true);
    r(
      'POST',
      '/api/init',
      async ({ body, server }) => {
        const dir = path.resolve(expandHome(body.dir));
        const kind = ['novel', 'life-story', 'memoir'].includes(body.kind) ? body.kind : 'novel';
        const store = await initProject(dir, {
          title: body.title,
          genre: body.genre,
          target_words: Number(body.target_words) || undefined,
          offline: !!body.offline,
          codex: !!body.codex,
          kind,
          subject_name: typeof body.subject_name === 'string' ? body.subject_name : undefined,
          life: {
            ...(body.subject === 'self' || body.subject === 'other' ? { subject: body.subject } : {}),
            ...(body.audience === 'family' || body.audience === 'public' ? { audience: body.audience } : {}),
            ...(typeof body.born === 'string' ? { born: body.born } : {}),
          },
        });
        store.close();
        server.open(dir);
        return { ok: true, dir };
      },
      true,
    );
    r(
      'POST',
      '/api/open-sample',
      async ({ server }) => {
        const dir = path.join(os.homedir(), 'Novels', 'The-Tidekeepers-Ledger');
        if (!fs.existsSync(path.join(dir, paths.book))) {
          const here = path.dirname(fileURLToPath(import.meta.url));
          const fixture = process.env.QUILLGON_FIXTURE_DIR || path.resolve(here, '../../../fixtures/novella');
          fs.mkdirSync(path.dirname(dir), { recursive: true });
          fs.cpSync(fixture, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.engine`) });
          const store = GraphStore.open(dir, { noIndex: true });
          await store.repo.init();
          await store.checkpoint('The Tidekeeper’s Ledger (sample)');
          store.close();
        }
        server.open(dir);
        return { ok: true, dir };
      },
      true,
    );
    r('GET', '/api/jobs/:id', ({ params, server }) => server.jobs.get(params.id) ?? { id: params.id, state: 'gone' }, true);

    r('GET', '/api/project', ({ engine }) => projectSnapshot(engine));
    r('POST', '/api/reload', ({ engine, server }) => (server.assertIdle('reload'), engine.store.reload(), { ok: true }));
    r('GET', '/api/covers', ({ engine }) => ({ ...coverAvailability(engine.store.project), covers: listCovers(engine.store.dir) }));
    r('GET', '/api/covers/:id/image', ({ engine, params }) => {
      try { return coverImage(engine.store.dir, params.id); }
      catch { throw new HttpError(404, 'Cover not found'); }
    });
    r('POST', '/api/covers/generate', ({ engine, body, server }) => {
      const parsed = CoverOptions.safeParse(body);
      if (!parsed.success) throw new HttpError(422, 'Invalid cover options', parsed.error.issues);
      const available = coverAvailability(engine.store.project);
      if (!available.ready) throw new HttpError(409, available.reason!);
      if ([...server.jobs.values()].some(j => j.name === 'cover' && j.state === 'running')) throw new HttpError(409, 'A cover is already being generated.');
      // Capture this project's data before starting: opening another book cannot redirect the result.
      const project = structuredClone(engine.store.project);
      // Reads a snapshot and writes only covers/: it need not wait for (or hold up) store jobs.
      return server.job('cover', progress => generateCover(project, parsed.data, progress), { queue: false });
    });

    // --- dictation
    r('GET', '/api/voice', ({ engine }) => voiceStatus(engine.store.project));
    r('POST', '/api/dictate', async ({ engine, body }) => {
      const parsed = DictateRequest.safeParse(body);
      if (!parsed.success) throw new HttpError(422, 'Invalid dictation request', parsed.error.issues);
      // Not a queued job: the author is waiting with the cursor in place. It writes only a
      // recording, and only for an interview session (git-ignored).
      const keep = parsed.data.session;
      if (keep && !engine.store.project.sessions.has(keep)) throw new HttpError(404, `no session "${keep}"`);
      const out = await dictate(engine.store.project, engine.agents, parsed.data);
      if (!keep || !out.raw) return out;
      const file = engine.store.saveAudio(keep, `a-${Date.now()}.wav`, Buffer.from(parsed.data.audio, 'base64'));
      return { ...out, audio: path.basename(file) };
    });

    // --- interviews (life stories)
    const iv = (e: Engine) => e.interviews;
    r('GET', '/api/sessions/:id', ({ engine, params }) => iv(engine).session(params.id));
    r('POST', '/api/sessions/start', ({ engine, body, server }) =>
      server.job('interview', () => iv(engine).start({ minutes: Number(body.minutes) || undefined, speaker: typeof body.speaker === 'string' ? body.speaker : undefined })),
    );
    r('POST', '/api/sessions/:id/answer', ({ engine, params, body, server }) =>
      server.job('interview', () =>
        iv(engine).answer(params.id, {
          text: String(body.text ?? ''),
          raw: typeof body.raw === 'string' ? body.raw : null,
          audio: Array.isArray(body.audio) ? body.audio.filter((a: unknown) => typeof a === 'string' && /^[a-z0-9-]+\.wav$/.test(a)) : [],
          seconds: Number(body.seconds) || 0,
          signal: ['dont-remember', 'move-on', 'off-record', 'hard'].includes(body.signal) ? body.signal : null,
        }),
      ),
    );
    r('POST', '/api/sessions/:id/undo', ({ engine, params, body }) => iv(engine).undo(params.id, Number(body.turn)));
    r('POST', '/api/sessions/:id/end', ({ engine, params, server }) => server.job('interview', () => iv(engine).end(params.id)));
    r('GET', '/api/sessions/:id/audio/:file', ({ engine, params }) => {
      const data = engine.store.readAudio(params.id, params.file);
      if (!data) throw new HttpError(404, 'recording not found');
      return new Binary('audio/wav', data);
    });
    // --- a life story's chapters
    const lb = (e: Engine) => e.life;
    const chapterView = (e: Engine) =>
      lb(e).chapters().map((c) => ({
        ...c,
        stage: lb(e).stageOf(c.id),
        stories: lb(e).storiesOf(c.id).map((st) => st.id),
        open_notes: lb(e).openNotes(c.id).length,
        words: c.scenes.reduce((n, sid) => n + (e.store.project.scenes.get(sid)?.prose?.meta.word_count ?? 0), 0),
      }));
    r('GET', '/api/life/chapters', ({ engine }) => ({ chapters: chapterView(engine), proposal: lb(engine).proposals.get('shape') }));
    r('POST', '/api/life/shape/propose', ({ engine, body, server }) => server.job('shape', () => lb(engine).proposeShape(body.shape || undefined)));
    r('POST', '/api/life/shape/accept', async ({ engine }) => (await lb(engine).acceptShape(), { chapters: chapterView(engine) }));
    r('POST', '/api/life/shape/discard', ({ engine }) => (lb(engine).proposals.delete('shape'), { ok: true }));
    r('POST', '/api/life/stories/:id/assign', async ({ engine, params, body }) => {
      lb(engine).assignStory(params.id, body.chapter || null);
      await engine.store.commit(`Move story ${params.id}`);
      return { chapters: chapterView(engine) };
    });
    r('POST', '/api/life/chapters/:id/draft', ({ engine, params, server }) => server.job('draft', (progress) => lb(engine).draftChapter(params.id, progress)));
    r('POST', '/api/life/chapters/:id/approve', async ({ engine, params }) => (await lb(engine).approve(params.id), { chapters: chapterView(engine) }));
    r('POST', '/api/life/chapters/:id/reopen', async ({ engine, params }) => (await lb(engine).reopen(params.id), { chapters: chapterView(engine) }));
    r('POST', '/api/scenes/:id/notes/:note', async ({ engine, params, body }) => {
      const note = lb(engine).answerNote(params.id, params.note, { answer: typeof body.answer === 'string' ? body.answer : undefined, status: body.status });
      await engine.store.commit(`Answer a note on ${params.id}`);
      return note;
    });
    r('PUT', '/api/life/settings', async ({ engine, body }) => {
      const life = engine.store.project.book.life;
      engine.store.updateBook({ life: { ...life, ...body.life, narrator: life.narrator } });
      await engine.store.commit('Edit life-story settings');
      return engine.store.project.book.life;
    });

    r('PUT', '/api/questions', async ({ engine, body }) => (engine.store.saveQuestions({ questions: body.questions }), await engine.store.commit('Edit questions'), engine.store.project.questions));
    r('PUT', '/api/notebook', async ({ engine, body }) => (engine.store.saveNotebook({ ...engine.store.project.notebook, ...body.notebook }), await engine.store.commit('Edit the ghostwriter’s notebook'), engine.store.project.notebook));
    r('PUT', '/api/stories/:id', async ({ engine, params, body }) => {
      const st = engine.store.saveStory({ ...(engine.store.project.stories.get(params.id) ?? {}), ...body.story, id: params.id });
      await engine.store.commit(`Story: ${st.title}`);
      return st;
    });
    r('DELETE', '/api/stories/:id', async ({ engine, params }) => (engine.store.deleteStory(params.id), await engine.store.commit(`Remove story ${params.id}`), { ok: true }));

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
      const before = engine.store.scene(params.id).prose?.body;
      engine.store.saveProse(params.id, String(body.body ?? ''), 'author');
      // Every hand edit teaches the style sheet (see style-learn.ts).
      if (before) recordEdit(engine.store, params.id, before, String(body.body ?? ''));
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
        const { runStylePasses } = await import('@quillgon/core');
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
      const states = engine.store.deleteScene(params.id);
      const change: Change = { kind: 'delete-scene', scene: params.id, card, orderBefore, states };
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
        structureCritiques: P.get('structure-critiques'),
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


    // --- obligations ledger
    r('GET', '/api/obligations', ({ engine }) => ({ obligations: [...engine.store.project.obligations.values()], issues: obligationIssues(engine.store.project) }));
    r('PUT', '/api/obligations/:id', async ({ engine, params, body }) => {
      const before = engine.store.project.obligations.get(params.id) ?? null;
      const o = engine.store.saveObligation({ ...body.obligation, id: params.id });
      // Keep the cards that plant and pay it in step with the ledger.
      for (const s of engine.store.project.scenes.values()) {
        const c = s.card;
        const sets = (c.id === o.setup_scene) !== c.sets_up.includes(o.id);
        const pays = (c.id === o.payoff_scene) !== c.pays_off.includes(o.id);
        if (sets || pays)
          engine.store.saveCard({
            ...c,
            sets_up: c.id === o.setup_scene ? [...new Set([...c.sets_up, o.id])] : c.sets_up.filter((x) => x !== o.id),
            pays_off: c.id === o.payoff_scene ? [...new Set([...c.pays_off, o.id])] : c.pays_off.filter((x) => x !== o.id),
          });
      }
      await engine.store.commit(`Ledger: ${o.description}`);
      const change: Change = { kind: 'obligation', before, after: o };
      return { obligation: o, change, impact: before ? analyseImpact(engine.store.project, change, engine.store.index) : null };
    });
    r('DELETE', '/api/obligations/:id', async ({ engine, params }) => (engine.store.deleteObligation(params.id), await engine.store.commit(`Ledger: remove ${params.id}`), { ok: true }));

    // --- style sheet: dials, live checking, learning from edits
    r('GET', '/api/style/sheet', ({ engine }) => engine.store.project.style.sheet);
    r('PUT', '/api/style/sheet', async ({ engine, body }) => {
      const sheet = engine.store.saveStyleSheet({ ...engine.store.project.style.sheet, ...body.sheet });
      await engine.store.commit('Edit style sheet');
      return sheet;
    });
    r('POST', '/api/style/check', ({ engine, body }) => {
      const p = engine.store.project;
      return checkStyle(String(body.text ?? ''), p.style.sheet, { book: p.book, banned: p.style.banned });
    });
    r('POST', '/api/style/check-all', ({ engine }) => runStyleCheck(engine.store));
    r('POST', '/api/style/fingerprint', ({ engine, body }) => {
      const text = String(body.text ?? engine.store.project.style.samples);
      const fp = fingerprint(text);
      return { fingerprint: fp, suggested: suggestSheet(fp, engine.store.project.style.sheet) };
    });
    const dismissed = (e: Engine): string[] => JSON.parse(e.store.readReport('style-dismissed.json') ?? '[]');
    const suggestions = (e: Engine) => suggestRules(readEdits(e.store), e.store.project.style.sheet, dismissed(e));
    r('GET', '/api/style/suggestions', ({ engine }) => ({ edits: readEdits(engine.store).length, suggestions: suggestions(engine) }));
    r('POST', '/api/style/suggestions/accept', async ({ engine, body }) => {
      const s = suggestions(engine).find((x) => x.id === body.id);
      if (!s) throw new HttpError(404, `no suggestion ${body.id}`);
      engine.store.saveStyleSheet({ ...engine.store.project.style.sheet, ...s.patch });
      await engine.store.commit(`Style: ${s.title}`);
      return { suggestions: suggestions(engine) };
    });
    r('POST', '/api/style/suggestions/dismiss', ({ engine, body }) => {
      engine.store.writeReport('style-dismissed.json', JSON.stringify([...new Set([...dismissed(engine), String(body.id)])]));
      return { suggestions: suggestions(engine) };
    });

    // --- plan-level critics
    r('POST', '/api/critique', ({ engine, server }) => server.job('critique', () => engine.critique()));
    r('GET', '/api/reports/critique', ({ engine }) => JSON.parse(engine.store.readReport('critique-latest.json') ?? 'null'));
    r('POST', '/api/pipeline/critique-structures', ({ engine, server }) =>
      server.job('critique', async () => {
        const alts = pl(engine).proposals.get<{ alternatives: StructureAlternative[] }>('structures')?.alternatives ?? [];
        const critiques = await engine.critiqueAlternatives(alts);
        pl(engine).proposals.set('structure-critiques', critiques);
        return critiques;
      }),
    );
    r('POST', '/api/scenes/:id/predictability', ({ engine, params, server }) => server.job('predictability', () => engine.predictability(params.id)));

    // --- idea → premise (Spark)
    const idea = (e: Engine) => e.ideation;
    r('GET', '/api/idea', ({ engine }) => idea(engine).board);
    r('POST', '/api/idea/start', ({ engine, body }) => idea(engine).start(String(body.seed ?? ''), String(body.genre ?? '')));
    r('POST', '/api/idea/diverge', ({ engine, body, server }) => server.job('diverge', () => idea(engine).diverge({ kinds: body.kinds, personas: body.personas })));
    r('POST', '/api/idea/mark', ({ engine, body }) => idea(engine).mark(body.id, body.status));
    r('POST', '/api/idea/own', ({ engine, body }) => idea(engine).addOwn(String(body.text), body.kind));
    r('POST', '/api/idea/expand', ({ engine, body, server }) => server.job('expand', () => idea(engine).expand(body.step)));
    r('POST', '/api/idea/choose', ({ engine, body }) => idea(engine).choose(body.step, String(body.text)));
    r('POST', '/api/idea/update', ({ engine, body }) => idea(engine).update(body.patch ?? {}));
    r('POST', '/api/idea/talk', ({ engine, body, server }) => server.job('talk', () => idea(engine).talk(String(body.message ?? ''), body.focus ? String(body.focus) : null)));
    r('POST', '/api/idea/talk/undo', ({ engine, body }) => idea(engine).undoTalk(Number(body.turn)));
    r('POST', '/api/idea/talk/clear', ({ engine }) => idea(engine).clearTalk());
    r('POST', '/api/idea/finish', async ({ engine }) => idea(engine).finish());
    r('POST', '/api/idea/skip', async ({ engine }) => {
      if (engine.store.book.stage === 'idea') engine.store.updateBook({ stage: 'intent' });
      await engine.store.commit('Skip the idea stage');
      return { ok: true };
    });

    // --- quality
    r('POST', '/api/quality/reader', ({ engine, body, server }) => server.job('reader', (progress) => engine.reader({ act: body.act, mode: body.mode === 'outline' ? 'outline' : 'prose', progress })));
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
      const hash = assertRef(body.hash, 'commit');
      const subject = (await engine.store.repo.git.raw(['log', '-1', '--format=%s', hash])).trim();
      await engine.store.revertCommits([hash], `Revert "${subject}"`);
      engine.store.reload();
      return { ok: true };
    }));
    r('GET', '/api/branches', async ({ engine }) => engine.store.repo.branches());
    r('POST', '/api/branches', async ({ engine, body, server }) => (server.assertIdle('start a what-if'), await engine.store.repo.createBranch(body.name), engine.store.reload(), { ok: true }));
    r('POST', '/api/branches/switch', async ({ engine, body, server }) => (server.assertIdle('switch what-ifs'), await engine.store.repo.switchBranch(body.name), engine.store.reload(), { ok: true }));
    r('POST', '/api/branches/merge', async ({ engine, body, server }) => {
      server.assertIdle('merge a what-if');
      const out = await engine.store.repo.merge(body.from);
      engine.store.reload();
      return out;
    });
    r('DELETE', '/api/branches/:name', async ({ engine, params, server }) => {
      server.assertIdle('delete a what-if');
      await engine.store.repo.deleteBranch(params.name);
      return { ok: true };
    });
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
      engine.store.savePrompt(params.name, body.reset ? null : String(body.text));
      await engine.store.commit(`${body.reset ? 'Reset' : 'Edit'} ${params.name} prompt`);
      return { ok: true };
    });

    // --- export
    r('GET', '/api/export', ({ engine, query }) => {
      const format = query.get('format') ?? 'md';
      if (!EXPORT_FORMATS.has(format)) throw new HttpError(400, `unknown export format "${format}"`);
      return exportManuscript(engine.store, format as 'md' | 'docx' | 'epub');
    });
  }
}

// ------------------------------------------------------------------ helpers

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const fail = (e: HttpError) => {
      if (failed) return;
      failed = true;
      req.resume(); // drain, so the error response can be sent
      reject(e);
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) fail(new HttpError(413, 'request body too large'));
      else if (!failed) chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      const data = Buffer.concat(chunks).toString('utf8');
      if (!data) return resolve({});
      // JSON only: a cross-site form or text/plain "simple request" never reaches a handler.
      const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return fail(new HttpError(415, 'request body must be application/json'));
      try {
        resolve(JSON.parse(data));
      } catch {
        fail(new HttpError(400, 'invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function decodeURIComponentSafe(p: string) {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

function expandHome(p: string) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function recent(): { dir: string; title: string; opened: string; kind?: string }[] {
  try {
    return (JSON.parse(fs.readFileSync(RECENT, 'utf8')) as { dir: string; title: string; opened: string; kind?: string }[]).filter((r) => fs.existsSync(path.join(r.dir, 'book.yaml')));
  } catch {
    return [];
  }
}

function rememberRecent(dir: string, title: string, kind: string) {
  const list = [{ dir, title, kind, opened: new Date().toISOString() }, ...recent().filter((r) => r.dir !== dir)].slice(0, 12);
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

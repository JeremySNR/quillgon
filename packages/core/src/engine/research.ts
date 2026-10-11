import type { AgentSuite, ResearchContext, WebFact } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import { DEFAULT_MODELS, isLifeBook, type CompTitle, type Evidence, type ModelTier, type ResearchGap, type ResearchRun, type ResearchSource } from '../schemas/index.js';
import { DEFAULT_AGENT_TIERS } from '../schemas/index.js';
import { catalogueDetails, checkQuote, mergeFindings, normaliseText, quoteInText, researchId, researchPlan, searchCatalogue, type CatalogueBook, type Fetch, type Findings, type Lookup } from '../research.js';
import { timestamp } from '../util.js';

export interface ResearchNet {
  fetch?: Fetch;
  lookup?: Lookup;
}

export interface RunOptions {
  brief?: string;
  depth?: 'quick' | 'deep';
  progress?: (line: string) => void;
  /** Stop between steps; what was found so far is kept. */
  signal?: AbortSignal;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Run tasks a few at a time. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Research for any book: the books already on its shelf, what readers ask, and facts with
 * quotes checked against their pages. Runs as one job and keeps a log; everything it finds
 * goes into research/library.yaml for the author to keep or dismiss. Offline, nothing leaves
 * the machine: only the author's own material is read.
 */
export class Research {
  constructor(
    private store: GraphStore,
    private agents: AgentSuite,
    private net: ResearchNet = {},
  ) {}

  private get p() {
    return this.store.project;
  }

  private tier(): ModelTier {
    return this.p.book.agents.researcher ?? DEFAULT_AGENT_TIERS.researcher;
  }

  /** Offline books, and offline research, never touch the network. */
  offline(): boolean {
    if (process.env.QUILLGON_OFFLINE === '1') return true;
    const t = this.tier();
    return ({ ...DEFAULT_MODELS[t], ...(this.p.book.models[t] ?? {}) }).provider === 'offline';
  }

  /** Can the research tier search the web? Every provider except a generic compatible endpoint can. */
  canSearch(): { ok: boolean; reason: string } {
    if (this.offline()) return { ok: false, reason: 'Offline: nothing leaves this computer, so research reads only your own material.' };
    const t = this.tier();
    const provider = ({ ...DEFAULT_MODELS[t], ...(this.p.book.models[t] ?? {}) }).provider;
    if (provider === 'openai-compatible') return { ok: false, reason: `The ${t} tier uses a generic endpoint that cannot search the web. Choose OpenAI, Anthropic or Codex for it in Settings → Models.` };
    return { ok: true, reason: '' };
  }

  context(brief?: string): ResearchContext {
    const b = this.p.book;
    const lib = this.p.research;
    return {
      kind: b.kind,
      title: b.title,
      about: this.p.intent.premise || b.guide.promise || '',
      reader: b.guide.reader,
      genre: b.genre,
      brief: brief ?? lib.brief,
      jurisdiction: b.guide.jurisdiction,
      known_comps: lib.comps.filter((c) => c.status !== 'dismissed').map((c) => c.title).slice(0, 30),
      known_gaps: lib.gaps.map((g) => g.question).slice(0, 30),
    };
  }

  /** What a run will do, and a rough price: searches are billed per search, the rest by tokens. */
  estimate(depth: 'quick' | 'deep') {
    const plan = researchPlan(depth);
    const t = this.tier();
    const cfg = { ...DEFAULT_MODELS[t], ...(this.p.book.models[t] ?? {}) };
    const searches = plan.queries * plan.searchesPerQuery + Math.min(plan.comps, 6);
    // Search results are long: about 25k tokens in and 3k out per search call, plus the plan and the shelf.
    const tokensIn = plan.queries * 25_000 + 30_000 + 4_000;
    const tokensOut = plan.queries * 3_000 + 8_000 + 1_000;
    const perSearch = cfg.price_search ?? (cfg.provider === 'openai' || cfg.provider === 'anthropic' ? 0.01 : 0);
    const cost = cfg.provider === 'codex' || cfg.provider === 'offline' ? 0 : (tokensIn * (cfg.price_in ?? 0) + tokensOut * (cfg.price_out ?? 0)) / 1e6 + searches * perSearch;
    return { searches, calls: plan.queries + 2, comps: plan.comps, cost_usd: Math.round(cost * 100) / 100, subscription: cfg.provider === 'codex', model: `${cfg.provider} ${cfg.model}`.trim() };
  }

  // ---------------------------------------------------------------- the author's material

  /**
   * Keep a file of the author's own (notes, a talk, course pages) and read it: facts whose
   * quotes are really in the file become evidence; what it mentions but the book does not
   * explain becomes questions.
   */
  async addMaterial(file: string, text: string): Promise<{ evidence: number; gaps: number }> {
    this.store.saveUpload(file, text);
    const source: ResearchSource = { id: researchId('up', file), kind: 'upload', title: file.replace(/\.(md|txt)$/, '').replace(/-/g, ' '), url: '', authors: [], publisher: '', published: '', retrieved: today(), file };
    const found = await this.readMaterial(source, text);
    this.store.saveResearch(mergeFindings(this.p.research, { sources: [source], ...found }));
    await this.store.commit(`Research: add ${file}`);
    return { evidence: found.evidence.length, gaps: found.gaps.length };
  }

  private async readMaterial(source: ResearchSource, text: string): Promise<{ evidence: Evidence[]; gaps: ResearchGap[] }> {
    // Long material is read in parts so nothing is silently cut.
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += 24_000) parts.push(text.slice(i, i + 24_000));
    const evidence: Evidence[] = [];
    const gaps: ResearchGap[] = [];
    for (const part of parts.slice(0, 8)) {
      const out = await this.agents.researchMaterial({ context: this.context(), file: source.file, text: part });
      for (const f of out.facts) {
        // Only words that are really in the file.
        if (!quoteInText(text, f.quote)) continue;
        evidence.push({ id: researchId('ev', `${source.id} ${f.quote}`), claim: f.claim, quote: f.quote, source: source.id, check: 'found', topic: f.topic, as_of: '', jurisdiction: '', status: 'new' });
      }
      for (const q of out.questions) gaps.push({ id: researchId('gap', q.question), question: q.question, why: q.why || `From your material: ${source.file}`, kind: 'uncovered', evidence: [], status: 'open' });
    }
    return { evidence, gaps };
  }

  removeMaterial(file: string) {
    const lib = this.p.research;
    const source = lib.sources.find((s) => s.kind === 'upload' && s.file === file);
    this.store.deleteUpload(file);
    if (source)
      this.store.saveResearch({ ...lib, sources: lib.sources.filter((s) => s.id !== source.id), evidence: lib.evidence.filter((e) => e.source !== source.id) });
  }

  // ---------------------------------------------------------------- a run

  async run(opts: RunOptions = {}): Promise<ResearchRun> {
    const depth = opts.depth ?? 'quick';
    const brief = (opts.brief ?? this.p.research.brief).trim();
    if (brief !== this.p.research.brief) this.store.saveResearch({ ...this.p.research, brief });
    const plan = researchPlan(depth);
    const run: ResearchRun = {
      id: `r-${timestamp().replace(/[^0-9]/g, '').slice(0, 14)}`,
      brief,
      depth,
      started: new Date().toISOString(),
      ended: null,
      status: 'running',
      log: [],
      searches: 0,
      cost_usd: 0,
      found: { sources: 0, evidence: 0, comps: 0, gaps: 0 },
      error: '',
    };
    const say = (kind: ResearchRun['log'][number]['kind'], text: string) => {
      run.log.push({ at: new Date().toISOString(), kind, text });
      opts.progress?.(text);
    };
    const stopped = () => !!opts.signal?.aborted;
    const add: Required<Pick<Findings, 'sources' | 'evidence' | 'comps' | 'gaps' | 'patterns'>> & { positioning?: string } = { sources: [], evidence: [], comps: [], gaps: [], patterns: [] };
    this.store.saveResearchRun(run);
    try {
      const can = this.canSearch();
      if (!can.ok) {
        say('note', can.reason);
      } else {
        const context = this.context(brief);
        say('plan', 'Planning what to look for');
        const p = await this.agents.researchPlan({ context, web_queries: plan.queries, catalogue_queries: plan.catalogue });
        say('plan', p.focus);

        // The shelf, from the catalogue: most-published first, skipping books already in the library.
        const known = new Set(this.p.research.comps.map((c) => normaliseText(c.title)));
        const shelf = new Map<string, CatalogueBook>();
        for (const q of p.catalogue.slice(0, plan.catalogue)) {
          if (stopped()) break;
          try {
            const hits = await searchCatalogue(q, { fetch: this.net.fetch, limit: 10 });
            say('catalogue', `Catalogue: "${q}", ${hits.length} books`);
            for (const h of hits) if (!known.has(normaliseText(h.title)) && !shelf.has(h.key)) shelf.set(h.key, h);
          } catch (e) {
            say('error', `Catalogue unavailable for "${q}": ${(e as Error).message}`);
          }
        }

        // The web: facts with quotes, reader questions, and other books the pages name.
        const named: { title: string; author: string }[] = [];
        const facts: { fact: WebFact; listed: boolean }[] = [];
        for (const w of p.web.slice(0, plan.queries)) {
          if (stopped()) break;
          say('search', `Searching: ${w.query}`);
          try {
            const r = await this.agents.researchSearch({ context, query: w.query, why: w.why, max_facts: depth === 'deep' ? 10 : 6, max_searches: plan.searchesPerQuery });
            run.searches += r.searches;
            const listed = (url: string) => r.sources === null || r.sources.some((s) => s.url.replace(/[#?].*$/, '').replace(/\/$/, '') === url.replace(/[#?].*$/, '').replace(/\/$/, ''));
            for (const f of r.output.facts) facts.push({ fact: f, listed: listed(f.url) });
            for (const q of r.output.reader_questions)
              add.gaps.push({ id: researchId('gap', q.question), question: q.question, why: [q.why, q.url].filter(Boolean).join(' · '), kind: 'reader-question', evidence: [], status: 'open' });
            named.push(...r.output.books.map((b) => ({ title: b.title, author: b.author })));
            say('search', `${r.output.facts.length} facts, ${r.output.reader_questions.length} reader questions, ${r.output.books.length} books mentioned`);
          } catch (e) {
            say('error', `Search failed: ${(e as Error).message}`);
          }
        }

        // Books the pages named: look them up so they come with a catalogue entry.
        for (const b of named.slice(0, 10)) {
          if (stopped() || shelf.size >= plan.comps * 2) break;
          if (known.has(normaliseText(b.title)) || [...shelf.values()].some((x) => normaliseText(x.title) === normaliseText(b.title))) continue;
          try {
            const [hit] = await searchCatalogue(`${b.title} ${b.author}`.trim(), { fetch: this.net.fetch, limit: 1 });
            if (hit && !shelf.has(hit.key)) shelf.set(hit.key, hit);
          } catch {
            // The catalogue is a convenience; a book it cannot find is simply left out.
          }
        }

        // Every quote checked against its page. A page that cannot be read keeps its fact only
        // if the search really returned that page; one it did not is dropped as unverifiable.
        if (facts.length && !stopped()) {
          say('check', `Checking ${facts.length} quotes against their pages`);
          const checks = await pool(facts, 4, ({ fact }) => checkQuote(fact.url, fact.quote, { fetch: this.net.fetch, lookup: this.net.lookup }));
          let found = 0;
          let dropped = 0;
          facts.forEach(({ fact, listed }, i) => {
            const check = checks[i];
            if (check === 'not-found' || (check === 'unreachable' && !listed)) return void dropped++;
            if (check === 'found') found++;
            const source: ResearchSource = { id: researchId('web', fact.url), kind: 'web', title: fact.title, url: fact.url, authors: [], publisher: fact.publisher, published: fact.published, retrieved: today(), file: '' };
            if (!add.sources.some((s) => s.id === source.id)) add.sources.push(source);
            add.evidence.push({ id: researchId('ev', `${fact.url} ${fact.quote}`), claim: fact.claim, quote: fact.quote, source: source.id, check, topic: fact.topic, as_of: fact.as_of, jurisdiction: fact.jurisdiction, status: 'new' });
          });
          say('check', `${found} quotes found on their pages, ${facts.length - found - dropped} pages could not be read, ${dropped} dropped`);
        }

        // The shelf: what each book promises and how it is built, and what they all miss.
        const picks = [...shelf.values()].slice(0, plan.comps);
        if (picks.length && !stopped()) {
          say('analyse', `Reading about ${picks.length} books on the shelf`);
          const details = await pool(picks, 3, async (b) => {
            try {
              return await catalogueDetails(b.key, { fetch: this.net.fetch });
            } catch {
              return { description: '', contents: [] };
            }
          });
          const books = picks.map((b, i) => ({ id: researchId('comp', b.title), title: b.title, authors: b.authors, year: b.year, subjects: b.subjects, description: details[i].description, contents: details[i].contents }));
          try {
            const r = await this.agents.researchComps({ context, books, max_searches: Math.min(plan.comps, 6) });
            run.searches += r.searches;
            for (const [i, b] of picks.entries()) {
              const c = r.output.comps.find((x) => x.id === books[i].id);
              const source: ResearchSource = { id: researchId('book', b.key), kind: 'book', title: b.title, url: b.url, authors: b.authors, publisher: '', published: b.year, retrieved: today(), file: '' };
              add.sources.push(source);
              const comp: CompTitle = { id: books[i].id, title: b.title, authors: b.authors, year: b.year, source: source.id, promise: c?.promise ?? '', framework: c?.framework ?? '', structure: c?.structure ?? '', praise: c?.praise ?? [], complaints: c?.complaints ?? [], difference: '', shelf: c?.shelf ?? 'core', status: 'new' };
              add.comps.push(comp);
            }
            add.patterns.push(...r.output.patterns.map((x) => ({ text: x.text, from: x.from.filter((id) => books.some((b) => b.id === id)) })));
            add.gaps.push(...r.output.gaps.map((g) => ({ id: researchId('gap', g.question), question: g.question, why: g.why, kind: g.kind, evidence: [], status: 'open' as const })));
            if (r.output.positioning) add.positioning = r.output.positioning;
          } catch (e) {
            say('error', `Could not analyse the shelf: ${(e as Error).message}`);
          }
        }
      }
      run.status = stopped() ? 'stopped' : 'done';
    } catch (e) {
      run.status = 'failed';
      run.error = (e as Error).message;
      say('error', run.error);
    }
    const before = this.p.research;
    const next = mergeFindings(before, add);
    run.found = {
      sources: next.sources.length - before.sources.length,
      evidence: next.evidence.length - before.evidence.length,
      comps: next.comps.length - before.comps.length,
      gaps: next.gaps.length - before.gaps.length,
    };
    this.store.saveResearch(next);
    run.cost_usd = this.spentSince(run.started);
    run.ended = new Date().toISOString();
    say('note', `Found ${run.found.comps} books, ${run.found.evidence} facts and ${run.found.gaps} questions.`);
    this.store.saveResearchRun(run);
    await this.store.commit(`Research (${depth}): ${brief.slice(0, 60) || this.p.book.title}`);
    return run;
  }

  /** What research calls have cost since a moment, from the cost log. */
  private spentSince(iso: string): number {
    const text = this.store.readReport('costs.jsonl') ?? '';
    let usd = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as { ts: string; agent: string; cost_usd: number };
        if (r.ts >= iso && r.agent.startsWith('researcher.')) usd += r.cost_usd;
      } catch {
        // a torn line
      }
    }
    return Math.round(usd * 10000) / 10000;
  }

  // ---------------------------------------------------------------- the author's decisions

  setEvidence(id: string, patch: Partial<Pick<Evidence, 'status' | 'as_of' | 'jurisdiction' | 'claim'>>) {
    const lib = this.p.research;
    if (!lib.evidence.some((e) => e.id === id)) throw new Error(`unknown evidence "${id}"`);
    return this.store.saveResearch({ ...lib, evidence: lib.evidence.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  }

  setComp(id: string, patch: Partial<Pick<CompTitle, 'status' | 'difference' | 'shelf'>>) {
    const lib = this.p.research;
    if (!lib.comps.some((c) => c.id === id)) throw new Error(`unknown book "${id}"`);
    return this.store.saveResearch({ ...lib, comps: lib.comps.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }

  setPositioning(text: string) {
    return this.store.saveResearch({ ...this.p.research, positioning: text });
  }

  /**
   * A gap becomes a question for the next interview session (for books gathered in sessions),
   * or is marked dealt with. Research questions the author answers from experience, not the web.
   */
  setGap(id: string, status: ResearchGap['status']) {
    const lib = this.p.research;
    const gap = lib.gaps.find((g) => g.id === id);
    if (!gap) throw new Error(`unknown question "${id}"`);
    if (status === 'queued' && isLifeBook(this.p.book)) {
      const qs = this.p.questions.questions;
      if (!qs.some((q) => q.id === id))
        this.store.saveQuestions({ questions: [...qs, { id, text: gap.question, why: gap.why || 'From research', technique: 'Research gap', about: 'book', ask: '', priority: 2, status: 'queued', asked_in: null }] });
    }
    return this.store.saveResearch({ ...lib, gaps: lib.gaps.map((g) => (g.id === id ? { ...g, status } : g)) });
  }
}

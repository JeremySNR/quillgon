import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkQuote, Engine, initProject, mergeFindings, pageText, publicUrl, quoteInText, ResearchLibrary, searchCatalogue, type AgentSuite, type Fetch } from '@quillgon/core';
import { ModelAdapter, ScriptedSuite, type Backend } from '../src/index.js';

const PUBLIC = async () => ['93.184.216.34'];

/** A fake network: URL → response. Anything unlisted is a 404. */
function net(routes: Record<string, { status?: number; body?: string; type?: string; location?: string }>): Fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const r = routes[url] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && url.startsWith(k.slice(0, -1)))?.[1];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'text/html', ...(r.location ? { location: r.location } : {}) } });
  }) as Fetch;
}

describe('checking a quote', () => {
  it('finds the words in the page text, whatever the quotes and dashes look like', () => {
    const page = pageText('<html><script>var x = "hidden";</script><p>In 2024, 61% of UK adults had a savings account &ndash; down from 65%.</p></html>');
    expect(quoteInText(page, 'In 2024, 61% of UK adults had a savings account - down from 65%.')).toBe(true);
    expect(quoteInText(page, '61% of adults in the UK save money')).toBe(false);
    expect(page).not.toContain('hidden');
  });

  it('tolerates a stray marker in a long quote, but not a paraphrase', () => {
    const text = 'The personal allowance is the amount of income you can earn each year without paying any income tax at all [3] and it is reviewed every April by the government.';
    expect(quoteInText(text, 'The personal allowance is the amount of income you can earn each year without paying any income tax at all and it is reviewed every April')).toBe(true);
    expect(quoteInText(text, 'You can earn a personal allowance every year without any tax being taken off, reviewed each spring')).toBe(false);
  });

  it('never fetches this machine or the local network, even through a redirect', async () => {
    expect(await publicUrl('http://localhost:4317/api/project', PUBLIC)).toBeNull();
    expect(await publicUrl('http://127.0.0.1/', PUBLIC)).toBeNull();
    expect(await publicUrl('http://[::1]/', PUBLIC)).toBeNull();
    expect(await publicUrl('http://10.0.0.8/', PUBLIC)).toBeNull();
    expect(await publicUrl('file:///etc/passwd', PUBLIC)).toBeNull();
    expect(await publicUrl('https://user:pw@example.org/', PUBLIC)).toBeNull();
    expect(await publicUrl('https://sneaky.example/', async () => ['192.168.1.4'])).toBeNull();
    expect(await publicUrl('https://www.gov.uk/income-tax-rates', PUBLIC)).not.toBeNull();
    const f = net({ 'https://example.org/a': { status: 302, location: 'http://127.0.0.1:4317/secret' }, 'http://127.0.0.1:4317/secret': { body: 'the exact words of the quote are here' } });
    expect(await checkQuote('https://example.org/a', 'the exact words of the quote are here', { fetch: f, lookup: PUBLIC })).toBe('unreachable');
  });

  it('reports found, not found, and unreachable', async () => {
    const f = net({ 'https://example.org/p': { body: '<p>Most salespeople give up after two follow-up calls with a new prospect.</p>' } });
    expect(await checkQuote('https://example.org/p', 'Most salespeople give up after two follow-up calls', { fetch: f, lookup: PUBLIC })).toBe('found');
    expect(await checkQuote('https://example.org/p', 'Most salespeople give up after five follow-up calls', { fetch: f, lookup: PUBLIC })).toBe('not-found');
    expect(await checkQuote('https://example.org/missing', 'Most salespeople give up after two follow-up calls', { fetch: f, lookup: PUBLIC })).toBe('unreachable');
  });
});

describe('the catalogue', () => {
  it('returns books most-published first', async () => {
    const f = net({
      'https://openlibrary.org/search.json*': {
        type: 'application/json',
        body: JSON.stringify({ docs: [{ key: '/works/OL1W', title: 'Small Book', edition_count: 2 }, { key: '/works/OL2W', title: 'Big Book', author_name: ['A. Author'], first_publish_year: 2011, edition_count: 40, ratings_average: 4.17, ratings_count: 900 }] }),
      },
    });
    const books = await searchCatalogue('sales', { fetch: f });
    expect(books.map((b) => b.title)).toEqual(['Big Book', 'Small Book']);
    expect(books[0]).toMatchObject({ authors: ['A. Author'], year: '2011', rating: 4.2, url: 'https://openlibrary.org/works/OL2W' });
  });
});

describe('the library', () => {
  it('a finding found again keeps the decision the author made about it', () => {
    let lib = ResearchLibrary.parse({});
    const source = { id: 'web-a', kind: 'web' as const, title: 'A', url: 'https://example.org/a', authors: [], publisher: '', published: '', retrieved: '', file: '' };
    const ev = { id: 'ev-1', claim: 'c', quote: 'Most salespeople give up after two calls', source: 'web-a', check: 'unreachable' as const, topic: '', as_of: '', jurisdiction: '', status: 'new' as const };
    lib = mergeFindings(lib, { sources: [source], evidence: [ev], comps: [{ id: 'comp-x', title: 'Big Book', authors: [], year: '', source: null, promise: '', framework: '', structure: '', praise: ['clear'], complaints: [], difference: 'Mine has scripts', shelf: 'core', status: 'kept' }] });
    lib = { ...lib, evidence: lib.evidence.map((e) => ({ ...e, status: 'dismissed' as const })) };
    // The same page under a different id and with a tracking query, the same quote, the same book.
    lib = mergeFindings(lib, {
      sources: [{ ...source, id: 'web-b', url: 'https://example.org/a?utm=x' }],
      evidence: [{ ...ev, id: 'ev-2', source: 'web-b', check: 'found' }],
      comps: [{ id: 'comp-y', title: 'big book', authors: [], year: '2011', source: null, promise: 'More deals', framework: '', structure: '', praise: ['short'], complaints: [], difference: '', shelf: 'core', status: 'new' }],
    });
    expect(lib.sources).toHaveLength(1);
    expect(lib.evidence).toHaveLength(1);
    expect(lib.evidence[0]).toMatchObject({ status: 'dismissed', check: 'found' });
    expect(lib.comps).toHaveLength(1);
    expect(lib.comps[0]).toMatchObject({ status: 'kept', difference: 'Mine has scripts', year: '2011', promise: 'More deals', praise: ['clear', 'short'] });
  });
});

async function book(kind: 'guide' | 'novel' = 'guide', offline = false) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'research-')), 'book');
  return initProject(dir, { title: 'Close More', kind, offline, ...(kind === 'guide' ? { subject_name: 'Sam Reed' } : {}) });
}

const PAGE = '<article><h1>Follow-up</h1><p>Most salespeople give up after two follow-up calls with a new prospect, according to the survey.</p></article>';

function shelfNet(): Fetch {
  return net({
    'https://openlibrary.org/search.json*': { type: 'application/json', body: JSON.stringify({ docs: [{ key: '/works/OL7W', title: 'The Follow-Up Book', author_name: ['J. Smith'], first_publish_year: 2015, edition_count: 12 }] }) },
    'https://openlibrary.org/works/OL7W.json': { type: 'application/json', body: JSON.stringify({ description: { value: 'Win more deals by following up. A practical guide.' } }) },
    'https://openlibrary.org/works/OL7W/editions.json*': { type: 'application/json', body: JSON.stringify({ entries: [{ table_of_contents: [{ title: 'Why follow up' }, { title: 'The five-touch plan' }, { title: 'Scripts' }] }] }) },
    'https://survey.example/report': { body: PAGE },
    'https://other.example/page': { body: '<p>Nothing relevant here at all.</p>' },
  });
}

describe('a research run', () => {
  it('keeps facts whose quotes are on their pages, drops the rest, and fills the shelf', async () => {
    const store = await book();
    const agents = new ScriptedSuite({
      researchSearch: async () => ({
        output: {
          facts: [
            { claim: 'Most give up after two calls', quote: 'Most salespeople give up after two follow-up calls with a new prospect', url: 'https://survey.example/report', title: 'Survey', publisher: '', published: '2024', topic: 'follow-up', as_of: '', jurisdiction: '' },
            { claim: 'Invented', quote: 'Eighty per cent of sales happen on the fifth call after the meeting', url: 'https://other.example/page', title: 'Other', publisher: '', published: '', topic: '', as_of: '', jurisdiction: '' },
            { claim: 'Made-up page', quote: 'A page the search never returned and that does not exist', url: 'https://nowhere.example/x', title: '', publisher: '', published: '', topic: '', as_of: '', jurisdiction: '' },
          ],
          reader_questions: [{ question: 'How many times should I follow up before giving up?', url: 'https://forum.example/t/1', why: 'Asked often' }],
          books: [],
        },
        sources: [{ url: 'https://survey.example/report', title: 'Survey' }, { url: 'https://other.example/page', title: 'Other' }],
        searches: 3,
      }),
      researchComps: async (i) => ({
        output: { comps: i.books.map((b) => ({ id: b.id, promise: 'More deals from follow-up', framework: 'Five touches', structure: 'Short chapters, a script in each', praise: ['practical'], complaints: ['US only'], shelf: 'core' as const })), patterns: [{ text: 'Every chapter ends with a script', from: i.books.map((b) => b.id) }], gaps: [{ question: 'What do you say on the third call?', why: 'None of them cover it', kind: 'uncovered' as const }], positioning: 'The UK book on follow-up.' },
        sources: [],
        searches: 2,
      }),
    });
    const engine = new Engine(store, agents, { net: { fetch: shelfNet(), lookup: PUBLIC } });
    const run = await engine.research.run({ brief: 'Follow-up in B2B sales', depth: 'quick' });
    const lib = store.project.research;
    expect(run.status).toBe('done');
    expect(run.searches).toBeGreaterThanOrEqual(5);
    expect(lib.brief).toBe('Follow-up in B2B sales');
    expect(lib.evidence.map((e) => e.claim)).toEqual(['Most give up after two calls']);
    expect(lib.evidence[0]).toMatchObject({ check: 'found', status: 'new' });
    expect(lib.sources.find((s) => s.id === lib.evidence[0].source)?.url).toBe('https://survey.example/report');
    expect(lib.comps).toHaveLength(1);
    expect(lib.comps[0]).toMatchObject({ title: 'The Follow-Up Book', framework: 'Five touches', complaints: ['US only'] });
    expect(lib.patterns[0].text).toBe('Every chapter ends with a script');
    expect(lib.positioning).toBe('The UK book on follow-up.');
    expect(lib.gaps.map((g) => g.question)).toEqual(expect.arrayContaining(['How many times should I follow up before giving up?', 'What do you say on the third call?']));
    expect(store.listResearchRuns()[0].id).toBe(run.id);
    // The comps call saw the book's contents page.
    const call = (agents.calls.find((c) => c.method === 'researchComps')!.input as Parameters<AgentSuite['researchComps']>[0]).books[0];
    expect(call.contents).toEqual(['Why follow up', 'The five-touch plan', 'Scripts']);
    expect((await store.repo.log(1))[0].message).toMatch(/^Research \(quick\)/);
  });

  it('a gap sent to the next session lands in the question queue', async () => {
    const store = await book();
    store.saveResearch({ gaps: [{ id: 'gap-third-call', question: 'What do you say on the third call?', why: 'Research' }] });
    const engine = new Engine(store, new ScriptedSuite());
    engine.research.setGap('gap-third-call', 'queued');
    expect(store.project.questions.questions.find((q) => q.id === 'gap-third-call')).toMatchObject({ technique: 'Research gap', status: 'queued' });
    expect(store.project.research.gaps[0].status).toBe('queued');
  });

  it("offline, nothing leaves the machine: only the author's material is read, and only its real words count", async () => {
    const store = await book('guide', true);
    const calls: string[] = [];
    const f = (async (u: string) => (calls.push(String(u)), new Response('', { status: 500 }))) as unknown as Fetch;
    const agents = new ScriptedSuite();
    const engine = new Engine(store, agents, { net: { fetch: f } });
    const run = await engine.research.run({ depth: 'deep' });
    expect(calls).toEqual([]);
    expect(agents.count('researchSearch')).toBe(0);
    expect(run.log.some((l) => /Offline/.test(l.text))).toBe(true);

    const notes = '# The five-touch plan\n\nI call five times over 14 days before I let a lead go.\n\n## Handling price\n\nMost buyers ask about price within the first 10 minutes of a call.';
    const r = await engine.research.addMaterial('my-course-notes.md', notes);
    expect(r.evidence).toBe(2);
    const lib = store.project.research;
    expect(lib.sources[0]).toMatchObject({ kind: 'upload', file: 'my-course-notes.md' });
    expect(lib.evidence.every((e) => e.check === 'found')).toBe(true);
    expect(lib.gaps.map((g) => g.question)).toEqual(expect.arrayContaining([expect.stringContaining('The five-touch plan')]));
    expect(store.readUpload('my-course-notes.md')).toBe(notes);

    // A model that misquotes the file gets nothing filed.
    const liar = new Engine(store, new ScriptedSuite({ researchMaterial: async () => ({ facts: [{ claim: 'x', quote: 'I call twenty times a day without fail every week', topic: '' }], questions: [] }) }));
    expect((await liar.research.addMaterial('more-notes.md', 'I call five times over 14 days.')).evidence).toBe(0);
  });
});

describe('web search through the adapter', () => {
  it('reports the pages searched and prices each search', async () => {
    const seen: unknown[] = [];
    const backend: Backend = {
      provider: 'openai',
      call: async (req) => (seen.push(req.web), { text: '{"facts":[],"reader_questions":[],"books":[]}', inputTokens: 1000, outputTokens: 100, model: 'm', sources: [{ url: 'https://a.example/', title: 'A' }], searches: 3 }),
    };
    const usage: { cost_usd: number; searches?: number }[] = [];
    const adapter = new ModelAdapter({ openai: backend }, () => ({ models: { mid: { provider: 'openai', model: 'm', price_in: 0, price_out: 0 } } }) as never, (u) => usage.push(u));
    const { ResearchSearchOutput } = await import('@quillgon/core');
    const r = await adapter.completeWeb({ agent: 'researcher.search', tier: 'mid', system: 's', messages: [{ role: 'user', content: 'q' }], schema: ResearchSearchOutput, schemaName: 'x', web: { maxSearches: 4 } });
    expect(seen).toEqual([{ maxSearches: 4 }]);
    expect(r.sources).toEqual([{ url: 'https://a.example/', title: 'A' }]);
    expect(r.searches).toBe(3);
    expect(usage[0]).toMatchObject({ searches: 3, cost_usd: 0.03 });
  });
});

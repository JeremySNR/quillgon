import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { CompTitle, Evidence, ResearchGap, ResearchLibrary, ResearchSource } from './schemas/index.js';
import type { Project } from './project.js';

/**
 * Research done by code, not by a model: looking books up in a public catalogue, checking that
 * a quote is really on the page it is attributed to, and merging what a run found into the
 * book's library without losing what the author already kept or dismissed.
 */

export type Fetch = typeof fetch;

// ------------------------------------------------------------------ the catalogue (Open Library)

export interface CatalogueBook {
  /** Open Library work key ("/works/OL123W"). */
  key: string;
  title: string;
  authors: string[];
  year: string;
  subjects: string[];
  editions: number;
  rating: number | null;
  ratings: number;
  url: string;
}

const OPEN_LIBRARY = 'https://openlibrary.org';
const UA = { 'user-agent': 'Quillgon (local book-writing app; https://github.com/JeremySNR/quillgon)' };

/** Books matching a query, most-published first: a rough measure of which ones readers actually buy. */
export async function searchCatalogue(query: string, opts: { fetch?: Fetch; limit?: number } = {}): Promise<CatalogueBook[]> {
  const f = opts.fetch ?? fetch;
  const fields = 'key,title,author_name,first_publish_year,subject,edition_count,ratings_average,ratings_count';
  const url = `${OPEN_LIBRARY}/search.json?q=${encodeURIComponent(query)}&fields=${fields}&limit=${opts.limit ?? 10}`;
  const res = await f(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open Library: HTTP ${res.status}`);
  const body = (await res.json()) as { docs?: { key: string; title: string; author_name?: string[]; first_publish_year?: number; subject?: string[]; edition_count?: number; ratings_average?: number; ratings_count?: number }[] };
  return (body.docs ?? [])
    .filter((d) => d.key && d.title)
    .map((d) => ({
      key: d.key,
      title: d.title,
      authors: d.author_name ?? [],
      year: d.first_publish_year ? String(d.first_publish_year) : '',
      subjects: (d.subject ?? []).slice(0, 8),
      editions: d.edition_count ?? 0,
      rating: typeof d.ratings_average === 'number' ? Math.round(d.ratings_average * 10) / 10 : null,
      ratings: d.ratings_count ?? 0,
      url: `${OPEN_LIBRARY}${d.key}`,
    }))
    .sort((a, b) => b.editions - a.editions || b.ratings - a.ratings);
}

/** A book's description and, where any edition has one, its contents page. */
export async function catalogueDetails(key: string, opts: { fetch?: Fetch } = {}): Promise<{ description: string; contents: string[] }> {
  if (!/^\/works\/OL\d+W$/.test(key)) throw new Error(`not an Open Library work: ${key}`);
  const f = opts.fetch ?? fetch;
  const get = async (path: string) => {
    const res = await f(`${OPEN_LIBRARY}${path}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  };
  const work = await get(`${key}.json`);
  const d = work?.description;
  const description = typeof d === 'string' ? d : d && typeof d === 'object' && typeof (d as { value?: unknown }).value === 'string' ? (d as { value: string }).value : '';
  const editions = (await get(`${key}/editions.json?limit=25`)) as { entries?: { table_of_contents?: { title?: string; label?: string }[] }[] } | null;
  const toc = editions?.entries?.find((e) => (e.table_of_contents?.length ?? 0) >= 3)?.table_of_contents ?? [];
  const contents = toc.map((t) => [t.label, t.title].filter(Boolean).join(' ').trim()).filter(Boolean).slice(0, 60);
  return { description: description.slice(0, 3000), contents };
}

// ------------------------------------------------------------------ checking a quote

/** Lower case, straight quotes, plain dashes, single spaces: how two copies of the same words are compared. */
export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    // Footnote markers ("[3]", "[12]") sit inside sentences on many pages.
    .replace(/\[\d{1,3}\]/g, ' ')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\p{L}\p{N}%£$€'".,\- ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Are these words in this text? Word for word, or (for a long quote) nearly all of its runs of
 * six words, so a stray footnote marker or a line break in the page does not fail a true quote.
 */
export function quoteInText(text: string, quote: string): boolean {
  const q = normaliseText(quote);
  if (q.split(' ').length < 4) return false;
  const t = normaliseText(text);
  if (t.includes(q)) return true;
  const words = q.split(' ');
  if (words.length < 12) return false;
  const shingles = words.slice(0, words.length - 5).map((_, i) => words.slice(i, i + 6).join(' '));
  return shingles.filter((s) => t.includes(s)).length / shingles.length >= 0.75;
}

/** Visible text of an HTML page. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&pound;/g, '£')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Addresses on this machine or a private network: research never fetches them. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
  }
  return true;
}

export type Lookup = (host: string) => Promise<string[]>;
const systemLookup: Lookup = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address);

/** May research fetch this URL? Public http(s) only: no logins in the URL, nothing on this machine or the local network. */
export async function publicUrl(raw: string, lookup: Lookup = systemLookup): Promise<URL | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (net.isIP(host)) return isPrivateAddress(host) ? null : u;
  try {
    const addrs = await lookup(host);
    return addrs.length && addrs.every((a) => !isPrivateAddress(a)) ? u : null;
  } catch {
    return null;
  }
}

export type QuoteCheck = 'found' | 'not-found' | 'unreachable';

/**
 * Fetch the page and look for the quote in its text. The page's words go to no model: this is
 * a string comparison, so a page cannot instruct anything. Redirects are followed by hand, each
 * one checked again, so a public link cannot bounce research onto the local network.
 */
export async function checkQuote(url: string, quote: string, opts: { fetch?: Fetch; lookup?: Lookup; timeoutMs?: number } = {}): Promise<QuoteCheck> {
  const f = opts.fetch ?? fetch;
  let target = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const u = await publicUrl(target, opts.lookup);
      if (!u) return 'unreachable';
      const res = await f(u, { headers: { ...UA, accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' }, redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        target = new URL(res.headers.get('location')!, u).toString();
        continue;
      }
      if (!res.ok) return 'unreachable';
      const type = res.headers.get('content-type') ?? '';
      if (type && !/text\/|xhtml|xml|json/.test(type)) return 'unreachable';
      const body = await readCapped(res, 3_000_000);
      return quoteInText(/html|xml/.test(type) || /<html|<body/i.test(body.slice(0, 2000)) ? pageText(body) : body, quote) ? 'found' : 'not-found';
    }
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
    if (size >= max) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// ------------------------------------------------------------------ the library

/** A stable id for a finding, so the same thing found twice is the same entry. */
export function researchId(prefix: string, text: string): string {
  const slug = normaliseText(text)
    .replace(/[^a-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 5)
    .join('-')
    .slice(0, 40);
  const hash = crypto.createHash('sha1').update(normaliseText(text)).digest('hex').slice(0, 6);
  return `${prefix}-${slug ? `${slug}-` : ''}${hash}`;
}

const sameUrl = (a: string, b: string) => a.replace(/[#?].*$/, '').replace(/\/$/, '') === b.replace(/[#?].*$/, '').replace(/\/$/, '');

export interface Findings {
  sources?: ResearchSource[];
  evidence?: Evidence[];
  comps?: CompTitle[];
  gaps?: ResearchGap[];
  patterns?: ResearchLibrary['patterns'];
  positioning?: string;
}

/**
 * Add what a run found. Something found again keeps the author's decision about it (kept,
 * dismissed, their note on how the book differs); new details fill in what was empty.
 */
export function mergeFindings(lib: ResearchLibrary, add: Findings): ResearchLibrary {
  const sources = [...lib.sources];
  const remap = new Map<string, string>();
  for (const s of add.sources ?? []) {
    const same = sources.find((x) => x.id === s.id || (s.url && x.url && sameUrl(x.url, s.url)) || (s.kind === 'upload' && x.kind === 'upload' && x.file === s.file));
    if (same) {
      remap.set(s.id, same.id);
      Object.assign(same, { title: same.title || s.title, published: same.published || s.published, publisher: same.publisher || s.publisher, authors: same.authors.length ? same.authors : s.authors });
    } else sources.push(s);
  }
  const src = (id: string) => remap.get(id) ?? id;

  const evidence = [...lib.evidence];
  for (const e of add.evidence ?? []) {
    const item = { ...e, source: src(e.source) };
    const same = evidence.find((x) => x.id === item.id || (x.source === item.source && normaliseText(x.quote || x.claim) === normaliseText(item.quote || item.claim)));
    if (same) {
      if (same.check !== 'found' && item.check === 'found') same.check = 'found';
      same.as_of ||= item.as_of;
      same.jurisdiction ||= item.jurisdiction;
    } else evidence.push(item);
  }

  const comps = [...lib.comps];
  for (const c of add.comps ?? []) {
    const item = { ...c, source: c.source ? src(c.source) : null };
    const same = comps.find((x) => x.id === item.id || normaliseText(x.title) === normaliseText(item.title));
    if (same) {
      for (const k of ['promise', 'framework', 'structure', 'year'] as const) same[k] ||= item[k];
      same.praise = [...new Set([...same.praise, ...item.praise])].slice(0, 8);
      same.complaints = [...new Set([...same.complaints, ...item.complaints])].slice(0, 8);
      same.source ??= item.source;
      if (!same.authors.length) same.authors = item.authors;
    } else comps.push(item);
  }

  const gaps = [...lib.gaps];
  for (const g of add.gaps ?? []) {
    if (!gaps.some((x) => x.id === g.id || normaliseText(x.question) === normaliseText(g.question))) gaps.push(g);
  }

  const patterns = [...lib.patterns];
  for (const p of add.patterns ?? []) if (!patterns.some((x) => normaliseText(x.text) === normaliseText(p.text))) patterns.push(p);

  return { ...lib, positioning: add.positioning?.trim() || lib.positioning, sources, evidence, comps, gaps, patterns };
}

/** Kept and new evidence a draft may cite, best first: checked quotes, then the rest. Dismissed is never offered. */
export function usableEvidence(lib: ResearchLibrary): Evidence[] {
  const rank = { found: 0, unchecked: 1, unreachable: 2, 'not-found': 3 } as const;
  return lib.evidence.filter((e) => e.status !== 'dismissed' && e.check !== 'not-found').sort((a, b) => (a.status === 'kept' ? -1 : 0) - (b.status === 'kept' ? -1 : 0) || rank[a.check] - rank[b.check]);
}

/** What a run of this depth will do and roughly cost, before it starts. */
export function researchPlan(depth: 'quick' | 'deep') {
  return depth === 'deep' ? { queries: 8, searchesPerQuery: 5, comps: 8, catalogue: 4 } : { queries: 3, searchesPerQuery: 4, comps: 4, catalogue: 2 };
}

// ------------------------------------------------------------------ research in the book

/**
 * What a guide's ghostwriter may bring into an interview: open reader questions, and what the
 * other books on the shelf teach, each attributed so it is never put in the author's mouth.
 */
export function researchPrompts(p: Pick<Project, 'book' | 'research'>, limit = 6): { text: string; source: string }[] {
  if (p.book.kind !== 'guide') return [];
  const lib = p.research;
  const out: { text: string; source: string }[] = [];
  for (const g of lib.gaps.filter((x) => x.status === 'open' || x.status === 'queued').slice(0, Math.ceil(limit / 2)))
    out.push({ text: g.question, source: g.kind === 'reader-question' ? 'What readers ask' : 'Research' });
  for (const c of lib.comps.filter((x) => x.status !== 'dismissed' && (x.framework || x.promise))) {
    if (out.length >= limit) break;
    const by = c.authors[0] ? ` by ${c.authors[0]}` : '';
    out.push({ text: `"${c.title}"${by} ${c.framework ? `teaches ${c.framework}` : `promises ${c.promise.replace(/\.$/, '')}`}${c.complaints[0] ? `; its readers complain: ${c.complaints[0]}` : ''}.`, source: c.title });
  }
  return out.slice(0, limit);
}

const stemsOf = (t: string) => new Set((normaliseText(t).match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(ing|ed|es|s)$/, '')));

/** The evidence most relevant to a chapter's material, for the draft to cite. Checked quotes and kept items first. */
export function draftEvidence(lib: ResearchLibrary, material: string[], limit = 12) {
  const words = stemsOf(material.join(' '));
  const sources = new Map(lib.sources.map((s) => [s.id, s]));
  return usableEvidence(lib)
    .map((e, rank) => {
      const w = stemsOf(`${e.claim} ${e.topic}`);
      const overlap = [...w].filter((x) => words.has(x)).length;
      return { e, score: overlap * 10 + (e.status === 'kept' ? 5 : 0) - rank * 0.01 };
    })
    .filter((x) => x.score >= 10 || x.e.status === 'kept')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ e }) => {
      const s = sources.get(e.source);
      return { id: e.id, claim: e.claim, quote: e.quote, source: [s?.publisher, s?.title].filter(Boolean).join(': ') || s?.file || '', url: s?.url ?? '', as_of: e.as_of, jurisdiction: e.jurisdiction };
    });
}

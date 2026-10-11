import type { Project } from './project.js';
import { sceneOrder } from './project.js';
import { cosine, LocalEmbedder, tokens } from './embed.js';
import { findBannedPatterns, parseBannedPatterns } from './style.js';
import { checkStyle } from './style-check.js';
import { mechanicalContinuity } from './quality/continuity.js';
import { mechanicalShape, planText } from './engine/critics.js';
import type { ReaderReport } from './quality/reader.js';
import { wordCount } from './util.js';
import { findTells, tellProfile, triadRate } from './tells.js';

/**
 * Automatic metrics for the eval harness (docs/research.md §11). Deterministic and free:
 * they run on finished books, so two runs (before and after a prompt change) compare on
 * the same numbers. Judged quality is separate (pairwise, both orders: see the CLI's
 * `quillgon eval compare`).
 */

/** Phrases readers recognise as machine prose, beyond each book's own banned list. */
export const SLOP_PHRASES = [
  'tapestry', 'testament to', 'a dance of', 'delve', 'palpable', 'couldn\'t help but', 'the weight of', 'unspoken', 'a symphony of',
  'shivers down', 'breath she didn\'t know', 'eyes that held', 'a mix of', 'in the grand scheme', 'little did', 'something shifted',
  'the air was thick', 'hung in the air', 'a flicker of', 'a pang of',
].map((p) => p.toLowerCase());

export interface BookMetrics {
  id: string;
  title: string;
  scenes: number;
  written: number;
  words: number;
  /** Banned-pattern and stock-phrase hits per 1,000 words. */
  slop_per_1k: number;
  /** Code-checked style sheet violations per 1,000 words (AI habits are counted separately). */
  style_per_1k: number;
  /** AI writing habits per 1,000 words (tells.ts: strong ×4, weak ×1). */
  ai_habits_per_1k: number;
  /** The structures that outlast vocabulary, per 1,000 words: staged contrasts, "-ing" riders, lists of three. */
  contrasts_per_1k: number;
  riders_per_1k: number;
  triads_per_1k: number;
  continuity_errors: number;
  /** Structural tells in the plan (single track, sagging middle, tidy ending…). */
  shape_findings: number;
  /** Share of the reader's twists it guessed before the reveal (lower is better). */
  twist_guess_rate: number | null;
  /** Mean simulated-reader engagement, 1-5. */
  engagement: number | null;
  first_names: string[];
  cost_usd: number;
}

export function bookMetrics(p: Project, opts: { id: string; reader?: ReaderReport | null; cost_usd?: number } = { id: '' }): BookMetrics {
  const order = sceneOrder(p);
  const prose = order.map((s) => p.scenes.get(s)!.prose?.body ?? '').filter(Boolean);
  const text = prose.join('\n\n');
  const words = wordCount(text);
  const per1k = (n: number) => (words ? Math.round((n / words) * 1000 * 100) / 100 : 0);
  const banned = p.style.banned.length ? p.style.banned : parseBannedPatterns('');
  const lower = text.toLowerCase();
  const stock = SLOP_PHRASES.reduce((n, phrase) => n + (lower.split(phrase).length - 1), 0);
  const style = prose.reduce((n, t) => n + checkStyle(t, p.style.sheet, { book: p.book, tells: false }).enforced, 0);
  const tellOpts = { kind: p.book.kind === 'novel' ? ('fiction' as const) : ('true' as const) };
  const tells = findTells(text, tellOpts);
  const count = (rules: string[]) => tells.filter((t) => rules.includes(t.rule)).length;
  const twists = opts.reader?.twists ?? [];
  return {
    id: opts.id,
    title: p.book.title,
    scenes: order.length,
    written: prose.length,
    words,
    slop_per_1k: per1k(findBannedPatterns(text, banned).length + stock),
    style_per_1k: per1k(style),
    ai_habits_per_1k: tellProfile(text, tellOpts).score,
    contrasts_per_1k: per1k(count(['not-x-but-y', 'no-longer', 'no-x-no-y'])),
    riders_per_1k: per1k(count(['ing-rider'])),
    triads_per_1k: triadRate(text),
    continuity_errors: mechanicalContinuity(p).length,
    shape_findings: mechanicalShape(p).length,
    twist_guess_rate: twists.length ? Math.round((twists.filter((t) => t.guessed).length / twists.length) * 100) / 100 : null,
    engagement: opts.reader ? Math.round(opts.reader.mean_engagement * 100) / 100 : null,
    first_names: [...p.characters.values()].map((c) => c.bio.name.split(/\s+/)[0]).filter(Boolean),
    cost_usd: opts.cost_usd ?? 0,
  };
}

export interface RunMetrics {
  books: number;
  /** Means across books. */
  mean: Pick<BookMetrics, 'slop_per_1k' | 'style_per_1k' | 'ai_habits_per_1k' | 'contrasts_per_1k' | 'riders_per_1k' | 'triads_per_1k' | 'continuity_errors' | 'shape_findings'> & { twist_guess_rate: number | null; engagement: number | null };
  /** Share of books that reuse a character first name from another book in the run ("Elara"). */
  shared_name_rate: number;
  /** Mean Jaccard overlap of prose word-trigrams between pairs of books (lower: less samey). */
  trigram_overlap: number;
  /** 1 - mean cosine similarity of the books' plans (higher: more varied stories). */
  plan_diversity: number;
  cost_usd: number;
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0);

function trigrams(text: string): Set<string> {
  const t = tokens(text);
  const out = new Set<string>();
  for (let i = 0; i + 2 < t.length; i++) out.add(`${t[i]} ${t[i + 1]} ${t[i + 2]}`);
  return out;
}

/** Cross-book measures: how much the books in one run resemble each other. */
export function runMetrics(books: { metrics: BookMetrics; project: Project }[]): RunMetrics {
  const ms = books.map((b) => b.metrics);
  const nullable = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? mean(v) : null;
  };
  const names = ms.map((m) => new Set(m.first_names.map((n) => n.toLowerCase())));
  const shared = names.filter((set, i) => names.some((other, j) => j !== i && [...set].some((n) => other.has(n)))).length;
  const grams = books.map((b) => trigrams(sceneOrder(b.project).map((s) => b.project.scenes.get(s)!.prose?.body ?? '').join(' ')));
  const embed = new LocalEmbedder(512);
  const plans = books.map((b) => embed.embedOne(`${b.project.intent.premise}\n${planText(b.project)}`));
  const overlaps: number[] = [];
  const sims: number[] = [];
  for (let i = 0; i < books.length; i++)
    for (let j = i + 1; j < books.length; j++) {
      const inter = [...grams[i]].filter((g) => grams[j].has(g)).length;
      const union = grams[i].size + grams[j].size - inter;
      overlaps.push(union ? inter / union : 0);
      sims.push(cosine(plans[i], plans[j]));
    }
  return {
    books: books.length,
    mean: {
      slop_per_1k: mean(ms.map((m) => m.slop_per_1k)),
      style_per_1k: mean(ms.map((m) => m.style_per_1k)),
      ai_habits_per_1k: mean(ms.map((m) => m.ai_habits_per_1k)),
      contrasts_per_1k: mean(ms.map((m) => m.contrasts_per_1k)),
      riders_per_1k: mean(ms.map((m) => m.riders_per_1k)),
      triads_per_1k: mean(ms.map((m) => m.triads_per_1k)),
      continuity_errors: mean(ms.map((m) => m.continuity_errors)),
      shape_findings: mean(ms.map((m) => m.shape_findings)),
      twist_guess_rate: nullable(ms.map((m) => m.twist_guess_rate)),
      engagement: nullable(ms.map((m) => m.engagement)),
    },
    shared_name_rate: books.length > 1 ? Math.round((shared / books.length) * 100) / 100 : 0,
    trigram_overlap: Math.round(mean(overlaps.map((x) => x * 100))) / 100,
    plan_diversity: sims.length ? Math.round((1 - sims.reduce((a, b) => a + b, 0) / sims.length) * 100) / 100 : 0,
    cost_usd: Math.round(ms.reduce((n, m) => n + m.cost_usd, 0) * 100) / 100,
  };
}

/** Elo difference implied by a win rate (ties count half): + means A is stronger. */
export function eloFromWinRate(winRate: number): number {
  const w = Math.min(0.99, Math.max(0.01, winRate));
  return Math.round(400 * Math.log10(w / (1 - w)));
}

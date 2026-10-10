import type { ReaderLogEntry } from './agents/contracts.js';
import { cosine, LocalEmbedder } from './embed.js';
import type { Project } from './project.js';
import { sceneOrder } from './project.js';

/**
 * Context budgets. Prompts must grow with the scene, not with the book: at novel length
 * the fact glossary, the reader's log and the style samples would otherwise dominate
 * every call (see scripts/scale-check.ts).
 */
export const BUDGET = {
  /** Facts sent to the extractor, planner and reviser once the glossary outgrows this. */
  facts: 80,
  /** Characters of style samples sent to the writer. */
  styleSamples: 6000,
  /** Characters of the writer's "story so far". */
  storySoFar: 5000,
  /** Reader log entries shown in full; older ones are folded into a summary. */
  readerWindow: 6,
};

const embedder = new LocalEmbedder(256);
const vectors = new Map<string, number[]>();
const vec = (text: string) => {
  let v = vectors.get(text);
  if (!v) {
    if (vectors.size > 20000) vectors.clear();
    vectors.set(text, (v = embedder.embedOne(text)));
  }
  return v;
};

/**
 * The facts worth sending for a task: every fact the task names (`must`), then the
 * glossary ranked by similarity to `query`, up to `limit`. Small glossaries go whole.
 * `prefer` facts (e.g. ones no scene has revealed yet) get a ranking boost.
 */
export function relevantFacts(p: Project, opts: { must?: Iterable<string>; query: string; limit?: number; prefer?: Set<string> }) {
  const all = p.factGlossary.facts;
  const limit = opts.limit ?? BUDGET.facts;
  if (all.length <= limit) return all;
  const must = new Set(opts.must ?? []);
  const picked = all.filter((f) => must.has(f.id));
  const room = limit - picked.length;
  if (room <= 0) return picked;
  // Queries are one-off (they include scene text): embed them uncached; cache fact vectors only.
  const q = embedder.embedOne(opts.query);
  const ranked = all
    .filter((f) => !must.has(f.id))
    .map((f) => ({ f, score: cosine(q, vec(`${f.id.replace(/-/g, ' ')} ${f.statement}`)) + (opts.prefer?.has(f.id) ? 0.15 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, room)
    .map((x) => x.f);
  const keep = new Set([...picked, ...ranked].map((f) => f.id));
  return all.filter((f) => keep.has(f.id)); // glossary order, for stable prompts
}

/** Facts no scene reveals yet: the planner most needs these to place reveals. */
export function unrevealedFacts(p: Project): Set<string> {
  const revealed = new Set([...p.scenes.values()].flatMap((s) => s.card.reveals));
  return new Set(p.factGlossary.facts.map((f) => f.id).filter((id) => !revealed.has(id)));
}

/** Cut text to about n characters at a paragraph (or word) boundary. */
export function clip(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const para = cut.lastIndexOf('\n\n');
  return (para > n * 0.5 ? cut.slice(0, para) : cut.slice(0, cut.lastIndexOf(' '))).trimEnd() + '\n\n[…]';
}

/**
 * The book before this scene, compressed: each earlier chapter as its title and summary,
 * then this chapter's earlier scenes as their planned outcomes (the three scenes right
 * before are sent as cards separately). Deterministic, from the graph: no model call.
 * When it is over budget, the oldest chapters go first.
 */
export function storySoFar(p: Project, sceneId: string, maxChars = BUDGET.storySoFar): string {
  const chapters = p.structure.acts.flatMap((a) => a.chapters.map((c) => ({ ...c, act: a.title || a.id })));
  const ci = chapters.findIndex((c) => c.scenes.includes(sceneId));
  if (ci < 0) return '';
  const order = sceneOrder(p);
  const recent = new Set(order.slice(Math.max(0, order.indexOf(sceneId) - 3), order.indexOf(sceneId)));
  const lines: string[] = [];
  for (const c of chapters.slice(0, ci)) {
    const outcomes = c.summary ? '' : c.scenes.map((s) => p.scenes.get(s)?.card.outcome).filter(Boolean).join(' ');
    lines.push(`- ${c.title || c.id}: ${c.summary || outcomes || '(no summary)'}`);
  }
  const here = chapters[ci];
  const before = here.scenes.slice(0, here.scenes.indexOf(sceneId)).filter((s) => !recent.has(s));
  if (before.length) lines.push(`- ${here.title || here.id}, so far: ${before.map((s) => p.scenes.get(s)?.card.outcome || p.scenes.get(s)?.card.title).filter(Boolean).join(' ')}`);
  let out = lines.join('\n');
  while (out.length > maxChars && lines.length > 1) {
    lines.shift();
    out = `- (earlier chapters omitted)\n${lines.join('\n')}`;
  }
  return out.length > maxChars ? clip(out, maxChars) : out;
}

/** Target length per scene, the same everywhere: the book's target over its planned scenes. */
export function wordsPerScene(p: Project): number {
  const chapters = p.structure.acts.flatMap((a) => a.chapters);
  const planned = chapters.reduce((n, c) => n + (c.scenes.length || c.planned_scenes || 1), 0);
  return Math.round(p.book.target_words / Math.max(planned, 1) / 50) * 50 || 1200;
}

export interface ReaderMemory {
  scenes_read: number;
  predictions: string[];
  open_confusions: { id: string; text: string }[];
}

/**
 * The reader's memory for the next scene: the latest entries in full, and from everything
 * older only what still matters (predictions, confusions not yet resolved). Keeps the
 * reader's cost linear in the book's length rather than quadratic.
 */
export function readerWindow(log: ReaderLogEntry[], window = BUDGET.readerWindow): { recent: ReaderLogEntry[]; earlier: ReaderMemory | null } {
  if (log.length <= window) return { recent: log, earlier: null };
  const older = log.slice(0, log.length - window);
  const resolved = new Set(log.flatMap((e) => e.resolved_confusions));
  return {
    recent: log.slice(-window),
    earlier: {
      scenes_read: older.length,
      predictions: [...new Set(older.flatMap((e) => e.predictions))].slice(-15),
      open_confusions: older.flatMap((e) => e.confusions).filter((c) => !resolved.has(c.id)).slice(-10),
    },
  };
}

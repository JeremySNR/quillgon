import type { Project, SceneEntry } from './project.js';

/**
 * Scene embeddings for similarity queries ("which later scenes resemble this change?",
 * "nearest scenes to avoid repeating images").
 *
 * The default embedder is local and deterministic: hashed, sublinear TF vectors over
 * word unigrams and bigrams with stopwords removed. No network, no model, stable across
 * runs, which keeps the impact analyser testable. A model-backed embedder can be
 * plugged in through the same interface.
 */
export interface Embedder {
  readonly name: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]> | number[][];
}

const STOP = new Set(
  `a an and are as at be been but by for from had has have he her hers him his i if in into is it its me my no not of on or our she so than that the their them then there they this to too up us was we were what when where which who will with would you your
  said says say just like out over back down off now one all any some about could did do does get got go going know more only own same should through very can will after before again once here how why still even s t d ll re ve m o`.split(/\s+/),
);

/** Light stemmer: enough to fold plurals and common suffixes together. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [])
    .map((w) => w.replace(/['’].*$/, ''))
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class LocalEmbedder implements Embedder {
  readonly name = 'local-hash-v1';
  constructor(readonly dims = 512) {}

  embedOne(text: string): number[] {
    const v = new Float64Array(this.dims);
    const toks = tokens(text);
    const counts = new Map<string, number>();
    for (let i = 0; i < toks.length; i++) {
      counts.set(toks[i], (counts.get(toks[i]) ?? 0) + 1);
      if (i + 1 < toks.length) {
        const bg = `${toks[i]}_${toks[i + 1]}`;
        counts.set(bg, (counts.get(bg) ?? 0) + 0.5);
      }
    }
    for (const [t, c] of counts) {
      const h = fnv1a(t);
      const sign = h & 1 ? 1 : -1;
      v[h % this.dims] += sign * (1 + Math.log(c));
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return Array.from(v, (x) => x / norm);
  }

  embed(texts: string[]): number[][] {
    return texts.map((t) => this.embedOne(t));
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The text a scene is embedded from: its card plus its prose. */
export function sceneText(s: SceneEntry, p?: Project): string {
  const c = s.card;
  const names = (ids: string[]) => ids.map((id) => p?.characters.get(id)?.bio.name ?? id).join(' ');
  return [
    c.title,
    c.purpose,
    c.beats.join(' '),
    c.outcome,
    names(c.characters),
    c.reveals.join(' ').replace(/-/g, ' '),
    s.prose?.body ?? '',
  ].join('\n');
}

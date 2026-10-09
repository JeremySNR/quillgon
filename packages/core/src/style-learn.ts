import { diffWords } from 'diff';
import type { StyleSheet } from './schemas/index.js';
import type { GraphStore } from './store.js';
import { ADVERB_RE, isAdverb } from './style-sheet.js';
import { sentences } from './text.js';

/**
 * Learn the author's style from their edits. Every hand edit to prose is diffed; patterns
 * that repeat ("gaze" → "look" six times, adverbs cut, long sentences split) become
 * proposed rules the author can accept into style.yaml.
 */
export interface EditRecord {
  ts: string;
  scene: string;
  substitutions: [string, string][];
  removed_adverbs: string[];
  removed_dashes: number;
  sentences_before: number;
  sentences_after: number;
  words_before: number;
  words_after: number;
}

export function diffEdit(scene: string, before: string, after: string): EditRecord | null {
  if (before === after) return null;
  const parts = diffWords(before, after);
  const subs: [string, string][] = [];
  const removedAdverbs: string[] = [];
  let removedDashes = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.removed) {
      for (const m of p.value.matchAll(ADVERB_RE)) if (isAdverb(m[1])) removedAdverbs.push(m[1].toLowerCase());
      removedDashes += (p.value.match(/—/g) ?? []).length;
      const next = parts[i + 1];
      const a = p.value.trim();
      const b = next?.added ? next.value.trim() : '';
      // A one-word swap is the clearest signal of a preference.
      if (next?.added && /^[A-Za-z’'-]+$/.test(a) && /^[A-Za-z’'-]+$/.test(b) && a.toLowerCase() !== b.toLowerCase()) subs.push([a.toLowerCase(), b.toLowerCase()]);
    }
  }
  if (!subs.length && !removedAdverbs.length && !removedDashes && Math.abs(before.length - after.length) < 3) return null;
  const words = (s: string) => (s.match(/\S+/g) ?? []).length;
  return {
    ts: new Date().toISOString(),
    scene,
    substitutions: subs,
    removed_adverbs: removedAdverbs,
    removed_dashes: removedDashes,
    sentences_before: sentences(before).length,
    sentences_after: sentences(after).length,
    words_before: words(before),
    words_after: words(after),
  };
}

export function recordEdit(store: GraphStore, scene: string, before: string, after: string): EditRecord | null {
  const r = diffEdit(scene, before, after);
  if (r) store.appendReport('edit-log.jsonl', JSON.stringify(r));
  return r;
}

export interface RuleSuggestion {
  id: string;
  title: string;
  evidence: string;
  patch: Partial<StyleSheet>;
}

export function readEdits(store: GraphStore): EditRecord[] {
  return (store.readReport('edit-log.jsonl') ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EditRecord);
}

/** Turn repeated edit patterns into rules the sheet does not have yet. */
export function suggestRules(edits: EditRecord[], sheet: StyleSheet, dismissed: string[] = []): RuleSuggestion[] {
  const out: RuleSuggestion[] = [];
  const subCount = new Map<string, number>();
  for (const e of edits) for (const [a, b] of e.substitutions) subCount.set(`${a}→${b}`, (subCount.get(`${a}→${b}`) ?? 0) + 1);
  for (const [k, n] of [...subCount.entries()].sort((a, b) => b[1] - a[1])) {
    const [avoid, use] = k.split('→');
    if (n < 2 || sheet.prefer.some((p) => p.avoid.toLowerCase() === avoid) || sheet.never.includes(avoid)) continue;
    out.push({ id: `prefer:${avoid}:${use}`, title: `Write “${use}”, not “${avoid}”`, evidence: `You changed it ${n} times`, patch: { prefer: [...sheet.prefer, { avoid, use }] } });
  }
  const adverbs = edits.flatMap((e) => e.removed_adverbs);
  if (adverbs.length >= 5) {
    const next = Math.max(2, Math.round(sheet.adverbs_per_1000_max * 0.6));
    if (next < sheet.adverbs_per_1000_max)
      out.push({ id: `adverbs:${next}`, title: `Fewer adverbs (at most ${next} per 1,000 words)`, evidence: `You cut ${adverbs.length} adverbs, e.g. ${[...new Set(adverbs)].slice(0, 4).join(', ')}`, patch: { adverbs_per_1000_max: next } });
  }
  const dashes = edits.reduce((n, e) => n + e.removed_dashes, 0);
  if (dashes >= 3 && sheet.em_dashes !== 'ban')
    out.push({ id: 'em-dashes:ban', title: 'No em dashes', evidence: `You removed ${dashes} em dashes`, patch: { em_dashes: 'ban' } });
  const splits = edits.filter((e) => e.sentences_after > e.sentences_before && Math.abs(e.words_after - e.words_before) <= 3).length;
  if (splits >= 3) {
    const max = Math.max(15, Math.round(sheet.sentence_words.max * 0.8));
    if (max < sheet.sentence_words.max)
      out.push({ id: `sentence-max:${max}`, title: `Shorter sentences (max ${max} words)`, evidence: `You split sentences in ${splits} edits`, patch: { sentence_words: { ...sheet.sentence_words, max, mean_max: Math.max(sheet.sentence_words.mean_min + 2, sheet.sentence_words.mean_max - 3) } } });
  }
  return out.filter((s) => !dismissed.includes(s.id));
}

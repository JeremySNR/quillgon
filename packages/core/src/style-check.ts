import type { Book, StyleSheet } from './schemas/index.js';
import type { BannedPattern } from './style.js';
import { findBannedPatterns } from './style.js';
import { ADVERB_RE, FILTER_RE, fingerprint, isAdverb, spellingFixes, type Fingerprint } from './style-sheet.js';
import { countWords, narrationMask, paragraphs, quotedSpans, sentences } from './text.js';

/**
 * Style checks on every word.
 *  - enforced: checked by code; the draft is not accepted until these pass (or the author waives them)
 *  - guided: measured or judged; reported and repaired where possible, never a hard gate
 */
export interface StyleViolation {
  rule: string;
  kind: 'enforced' | 'guided';
  start: number;
  end: number;
  text: string;
  message: string;
  /** A deterministic replacement, when one exists. */
  fix?: string;
}

export interface StyleReport {
  violations: StyleViolation[];
  enforced: number;
  guided: number;
  stats: Fingerprint;
}

const FANCY_TAGS = new Set(
  'whispered hissed exclaimed snapped growled murmured muttered shouted cried yelled retorted sneered laughed sighed breathed gasped chuckled smirked grinned barked purred quipped interjected admitted replied responded answered snarled spat stammered stuttered croaked groaned moaned wailed bellowed roared screamed shrieked declared announced insisted demanded pleaded begged mused pondered offered countered continued added called told'.split(
    ' ',
  ),
);
const SIMPLE_TAGS = new Set(['said', 'asked', 'told', 'called', 'replied', 'whispered', 'shouted', 'says', 'asks', 'answered', 'added']);
const SAID_ONLY = new Set(['said', 'asked', 'says', 'asks']);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (phrase: string) => new RegExp(`${/^\w/.test(phrase) ? '\\b' : ''}${escapeRe(phrase).replace(/\s+/g, '\\s+')}${/\w$/.test(phrase) ? '\\b' : ''}`, 'gi');

export function checkStyle(text: string, sheet: StyleSheet, opts: { book?: Pick<Book, 'pov_mode' | 'tense'>; banned?: BannedPattern[] } = {}): StyleReport {
  const v: StyleViolation[] = [];
  const add = (x: StyleViolation) => v.push(x);
  const narration = narrationMask(text);
  const words = Math.max(1, countWords(text));

  // never / prefer
  for (const w of sheet.never) for (const m of text.matchAll(wordRe(w))) add({ rule: 'never', kind: 'enforced', start: m.index!, end: m.index! + m[0].length, text: m[0], message: `“${m[0]}” is on the never list` });
  for (const p of sheet.prefer)
    for (const m of text.matchAll(wordRe(p.avoid))) {
      const fix = m[0][0] === m[0][0].toUpperCase() ? p.use[0].toUpperCase() + p.use.slice(1) : p.use;
      add({ rule: 'prefer', kind: 'enforced', start: m.index!, end: m.index! + m[0].length, text: m[0], message: `Use “${p.use}”, not “${p.avoid}”`, fix });
    }

  // banned patterns
  // A phrase on both the never list and the banned list counts once.
  for (const h of findBannedPatterns(text, opts.banned ?? [])) if (!v.some((x) => x.start <= h.index && x.end >= h.index + h.match.length)) add({ rule: 'banned', kind: 'enforced', start: h.index, end: h.index + h.match.length, text: h.match, message: `Banned pattern: ${h.label}` });

  // spelling
  if (sheet.spelling !== 'any')
    for (const f of spellingFixes(text, sheet.spelling))
      add({ rule: 'spelling', kind: 'enforced', start: f.start, end: f.end, text: f.found, message: `${sheet.spelling === 'uk' ? 'British' : 'American'} spelling: “${f.fix}”`, fix: f.fix });

  // punctuation
  const dashes = [...text.matchAll(/—/g)];
  if (sheet.em_dashes === 'ban') for (const m of dashes) add({ rule: 'em-dash', kind: 'enforced', start: m.index!, end: m.index! + 1, text: '—', message: 'No em dashes' });
  if (sheet.em_dashes === 'limit') {
    const allowed = Math.floor((sheet.em_dashes_per_1000 * words) / 1000);
    for (const m of dashes.slice(Math.max(1, allowed))) add({ rule: 'em-dash', kind: 'enforced', start: m.index!, end: m.index! + 1, text: '—', message: `Too many em dashes (at most ${sheet.em_dashes_per_1000} per 1,000 words)` });
  }
  const semis = sheet.semicolons === 'ban' ? [...text.matchAll(/;/g)] : sheet.semicolons === 'dialogue-only' ? [...narration.matchAll(/;/g)] : [];
  for (const m of semis) add({ rule: 'semicolon', kind: 'enforced', start: m.index!, end: m.index! + 1, text: ';', message: sheet.semicolons === 'ban' ? 'No semicolons' : 'No semicolons in narration' });
  const bangs = sheet.exclamations === 'ban' ? [...text.matchAll(/!/g)] : sheet.exclamations === 'dialogue-only' ? [...narration.matchAll(/!/g)] : [];
  for (const m of bangs) add({ rule: 'exclamation', kind: 'enforced', start: m.index!, end: m.index! + 1, text: '!', message: sheet.exclamations === 'ban' ? 'No exclamation marks' : 'Exclamation marks only in dialogue' });

  // quotes and dialogue tags
  for (const p of paragraphs(text)) {
    for (const q of quotedSpans(p.text)) {
      const open = p.text[q.start];
      const isSingle = open === "'" || open === '‘';
      if (sheet.quotes === 'single' && !isSingle) add({ rule: 'quotes', kind: 'enforced', start: p.start + q.start, end: p.start + q.end, text: p.text.slice(q.start, q.end), message: 'Use single quotation marks for dialogue' });
      if (sheet.quotes === 'double' && isSingle) add({ rule: 'quotes', kind: 'enforced', start: p.start + q.start, end: p.start + q.end, text: p.text.slice(q.start, q.end), message: 'Use double quotation marks for dialogue' });
      if (sheet.dialogue_tags !== 'any') {
        const after = p.text.slice(q.end, q.end + 40);
        const m = after.match(/^\s*(?:(?:he|she|they|I|we|you|[A-Z][a-z]+)\s+([a-z]+)|([a-z]+)\s+(?:he|she|they|[A-Z][a-z]+))\b/);
        const verb = m?.[1] ?? m?.[2];
        if (verb && FANCY_TAGS.has(verb)) {
          const allowed = sheet.dialogue_tags === 'said-only' ? SAID_ONLY : SIMPLE_TAGS;
          if (!allowed.has(verb)) {
            const at = p.start + q.end + after.indexOf(verb);
            add({ rule: 'dialogue-tag', kind: 'enforced', start: at, end: at + verb.length, text: verb, message: sheet.dialogue_tags === 'said-only' ? 'Dialogue tags: “said” or “asked” only' : `“${verb}” is not a plain dialogue tag`, fix: 'said' });
          }
        }
      }
    }
  }

  // sentences
  const sents = sentences(text);
  for (const s of sents)
    if (s.words > sheet.sentence_words.max) add({ rule: 'sentence-length', kind: 'enforced', start: s.start, end: s.end, text: s.text.slice(0, 80), message: `${s.words}-word sentence (max ${sheet.sentence_words.max})` });

  // point of view and tense (narration only, italics excluded)
  if (opts.book && opts.book.pov_mode !== 'first')
    for (const m of narration.matchAll(/\b(I|me|my|mine|myself)\b/g))
      add({ rule: 'pov', kind: 'enforced', start: m.index!, end: m.index! + m[0].length, text: m[0], message: 'First person in third-person narration' });
  if (opts.book?.tense === 'past')
    for (const m of narration.matchAll(/\b(is|are|am|isn['’]t|aren['’]t|has|doesn['’]t|does)\b/g))
      add({ rule: 'tense', kind: 'guided', start: m.index!, end: m.index! + m[0].length, text: m[0], message: 'Present tense in past-tense narration?' });
  if (sheet.contractions === 'avoid-in-narration')
    for (const m of narration.matchAll(/\b\w+['’](?:t|re|ve|ll|d|m)\b/g))
      add({ rule: 'contraction', kind: 'guided', start: m.index!, end: m.index! + m[0].length, text: m[0], message: 'Contraction in narration' });

  // rates (guided): flag each instance only when over budget
  const adverbs = [...narration.matchAll(ADVERB_RE)].filter((m) => isAdverb(m[1]));
  if ((adverbs.length / words) * 1000 > sheet.adverbs_per_1000_max)
    for (const m of adverbs) add({ rule: 'adverb', kind: 'guided', start: m.index!, end: m.index! + m[0].length, text: m[0], message: `Adverbs over budget (${Math.round((adverbs.length / words) * 1000)} per 1,000; max ${sheet.adverbs_per_1000_max})` });
  const filters = [...narration.matchAll(FILTER_RE)];
  if ((filters.length / words) * 1000 > sheet.filter_words_per_1000_max)
    for (const m of filters) add({ rule: 'filter-word', kind: 'guided', start: m.index!, end: m.index! + m[0].length, text: m[0], message: 'Filter words over budget: show it directly' });

  // shape (guided)
  const stats = fingerprint(text);
  if (sents.length >= 8 && (stats.sentence_mean < sheet.sentence_words.mean_min || stats.sentence_mean > sheet.sentence_words.mean_max))
    add({ rule: 'rhythm', kind: 'guided', start: 0, end: 0, text: '', message: `Average sentence ${stats.sentence_mean} words (target ${sheet.sentence_words.mean_min}–${sheet.sentence_words.mean_max})` });
  if (words > 300 && (stats.dialogue_share < sheet.dialogue_share.min || stats.dialogue_share > sheet.dialogue_share.max))
    add({ rule: 'dialogue-share', kind: 'guided', start: 0, end: 0, text: '', message: `Dialogue is ${Math.round(stats.dialogue_share * 100)}% of the scene (target ${Math.round(sheet.dialogue_share.min * 100)}–${Math.round(sheet.dialogue_share.max * 100)}%)` });
  for (const p of paragraphs(text)) {
    const n = sents.filter((s) => s.start >= p.start && s.end <= p.end).length;
    if (n > sheet.paragraph_sentences_max) add({ rule: 'paragraph-length', kind: 'guided', start: p.start, end: p.start + Math.min(60, p.text.length), text: p.text.slice(0, 60), message: `${n}-sentence paragraph (max ${sheet.paragraph_sentences_max})` });
  }

  v.sort((a, b) => a.start - b.start || a.rule.localeCompare(b.rule));
  return { violations: v, enforced: v.filter((x) => x.kind === 'enforced').length, guided: v.filter((x) => x.kind === 'guided').length, stats };
}

/** Apply every deterministic fix (spelling, preferred words, dialogue tags), right to left. */
export function applyFixes(text: string, violations: StyleViolation[]): { text: string; applied: number } {
  const fixes = violations.filter((x) => x.fix !== undefined && x.end > x.start).sort((a, b) => b.start - a.start);
  let out = text;
  let applied = 0;
  let lastStart = Infinity;
  for (const f of fixes) {
    if (f.end > lastStart) continue; // overlapping
    if (out.slice(f.start, f.end) !== f.text) continue;
    out = out.slice(0, f.start) + f.fix + out.slice(f.end);
    lastStart = f.start;
    applied++;
  }
  return { text: out, applied };
}

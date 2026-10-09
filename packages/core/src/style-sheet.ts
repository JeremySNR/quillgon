import { StyleSheet } from './schemas/index.js';
import type { Project } from './project.js';
import { countWords, narrationMask, paragraphs, segments, sentences } from './text.js';

/** The style sheet as plain rules for the writer's prompt. */
export function styleRules(p: Project): string[] {
  const s = p.style.sheet;
  const r: string[] = [];
  if (s.spelling !== 'any') r.push(`${s.spelling === 'uk' ? 'British' : 'American'} spelling throughout (${s.spelling === 'uk' ? 'colour, realise, grey, travelled' : 'color, realize, gray, traveled'}).`);
  if (s.quotes !== 'any') r.push(`Dialogue in ${s.quotes} quotation marks.`);
  if (s.dialogue_tags === 'said-only') r.push('Dialogue tags: "said" or "asked" only, or no tag. Never whispered, hissed, exclaimed and the like.');
  if (s.dialogue_tags === 'simple') r.push('Dialogue tags: plain verbs only (said, asked, told, called, replied, whispered, shouted).');
  if (s.em_dashes === 'ban') r.push('No em dashes.');
  if (s.em_dashes === 'limit') r.push(`Em dashes sparingly: at most ${s.em_dashes_per_1000} per 1,000 words.`);
  if (s.semicolons === 'ban') r.push('No semicolons.');
  if (s.semicolons === 'dialogue-only') r.push('No semicolons in narration.');
  if (s.exclamations === 'ban') r.push('No exclamation marks.');
  if (s.exclamations === 'dialogue-only') r.push('Exclamation marks only inside dialogue.');
  if (s.contractions === 'avoid-in-narration') r.push('No contractions in narration (dialogue may use them).');
  r.push(`Sentences average ${s.sentence_words.mean_min}–${s.sentence_words.mean_max} words; never more than ${s.sentence_words.max}.`);
  r.push(`Paragraphs of at most ${s.paragraph_sentences_max} sentences.`);
  r.push(`Few -ly adverbs (at most ${s.adverbs_per_1000_max} per 1,000 words) and few filter words such as "she felt", "he saw", "she noticed".`);
  if (s.never.length) r.push(`Never use: ${s.never.map((w) => `"${w}"`).join(', ')}.`);
  for (const x of s.prefer) r.push(`Write "${x.use}", not "${x.avoid}".`);
  r.push(...s.guidance);
  return r;
}

// ------------------------------------------------------------------ fingerprint

export interface Fingerprint {
  words: number;
  sentence_mean: number;
  sentence_sd: number;
  sentence_p95: number;
  dialogue_share: number;
  paragraph_sentences_mean: number;
  paragraph_sentences_p90: number;
  adverbs_per_1000: number;
  filter_words_per_1000: number;
  em_dashes_per_1000: number;
  semicolons_per_1000: number;
  narration_exclamations_per_1000: number;
  narration_contractions_per_1000: number;
  quotes: 'single' | 'double' | 'mixed' | 'none';
  spelling: 'uk' | 'us' | 'unknown';
  top_openers: { opener: string; share: number }[];
}

const NOT_ADVERBS = new Set(
  'only family early likely unlikely ugly holy lonely friendly silly belly jelly reply apply supply fly rely july italy ally bully curly daily elderly hilly lovely lively oily smelly woolly folly lily holly sly jolly melancholy assembly anomaly monopoly rally tally wily costly deadly ghostly ghastly kindly manly motherly fatherly orderly heavenly worldly comely cowardly scholarly sickly timely beastly bodily cuddly dimly gnarly grisly measly nightly weekly monthly yearly hourly quarterly'.split(' '),
);
export const ADVERB_RE = /\b([A-Za-z]{3,}ly)\b/g;
export function isAdverb(w: string): boolean {
  return !NOT_ADVERBS.has(w.toLowerCase());
}
export const FILTER_RE = /\b(?:(?:she|he|they|I|we)\s+(?:felt|saw|heard|noticed|realised|realized|wondered|watched|knew|thought|seemed)|seemed to|could see|could hear|could feel|watched as|began to|started to)\b/gi;
const CONTRACTION_RE = /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/gi;

const UK_US: [string, string][] = [
  ['colour', 'color'], ['honour', 'honor'], ['favour', 'favor'], ['labour', 'labor'], ['neighbour', 'neighbor'], ['harbour', 'harbor'],
  ['behaviour', 'behavior'], ['flavour', 'flavor'], ['humour', 'humor'], ['rumour', 'rumor'], ['vapour', 'vapor'], ['armour', 'armor'],
  ['parlour', 'parlor'], ['odour', 'odor'], ['savour', 'savor'], ['valour', 'valor'], ['vigour', 'vigor'], ['splendour', 'splendor'],
  ['grey', 'gray'], ['centre', 'center'], ['theatre', 'theater'], ['metre', 'meter'], ['litre', 'liter'], ['fibre', 'fiber'], ['sombre', 'somber'],
  ['travelled', 'traveled'], ['travelling', 'traveling'], ['traveller', 'traveler'], ['cancelled', 'canceled'], ['cancelling', 'canceling'],
  ['labelled', 'labeled'], ['modelled', 'modeled'], ['fuelled', 'fueled'], ['quarrelled', 'quarreled'], ['marvelled', 'marveled'],
  ['jewellery', 'jewelry'], ['defence', 'defense'], ['offence', 'offense'], ['pretence', 'pretense'], ['mould', 'mold'], ['plough', 'plow'],
  ['pyjamas', 'pajamas'], ['cosy', 'cozy'], ['sceptic', 'skeptic'], ['sceptical', 'skeptical'], ['analyse', 'analyze'], ['paralyse', 'paralyze'],
  ['catalogue', 'catalog'], ['aluminium', 'aluminum'], ['mum', 'mom'], ['moustache', 'mustache'], ['grey-haired', 'gray-haired'], ['kerb', 'curb'],
  ['storey', 'story'], ['manoeuvre', 'maneuver'], ['oesophagus', 'esophagus'], ['anaesthetic', 'anesthetic'], ['foetus', 'fetus'], ['draught', 'draft'],
  ['whilst', 'while'], ['amongst', 'among'], ['practise', 'practice'], ['programme', 'program'], ['cheque', 'check'], ['tyre', 'tire'],
];
const IZE_ROOTS = 'real recogn organ apolog emphas critic memor sympath character summar priorit minim maxim author civil energ fantas final harmon hypnot idol legal mobil modern neutral normal patron penal polar rational scrutin special stabil standard symbol terror theor tranquil util verbal visual vocal agon apolog jeopard'.split(' ');
const IZE_SUFFIXES = ['e', 'es', 'ed', 'ing', 'ation', 'ations', 'er', 'ers'];

/** Words spelled the other way, as [found, fix] pairs. */
export function spellingFixes(text: string, target: 'uk' | 'us'): { start: number; end: number; found: string; fix: string }[] {
  const out: { start: number; end: number; found: string; fix: string }[] = [];
  const keep = (src: string, fix: string) => (src[0] === src[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix);
  for (const [uk, us] of UK_US) {
    // Ambiguous in one direction only: "story", "check", "tire", "draft", "program", "practice", "while", "among", "mom" are fine in UK English.
    if (target === 'uk' && ['story', 'check', 'tire', 'draft', 'program', 'practice', 'while', 'among', 'curb', 'meter'].includes(us)) continue;
    if (target === 'us' && ['whilst', 'amongst'].includes(uk)) continue;
    const [from, to] = target === 'uk' ? [us, uk] : [uk, us];
    const re = new RegExp(`\\b${from}(s|ed|ing|ful|less|ish|y)?\\b`, 'gi');
    for (const m of text.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length, found: m[0], fix: keep(m[0], to + (m[1] ?? '')) });
  }
  const [a, b] = target === 'uk' ? ['iz', 'is'] : ['is', 'iz'];
  for (const root of IZE_ROOTS) {
    const re = new RegExp(`\\b${root}${a}(${IZE_SUFFIXES.join('|')})\\b`, 'gi');
    for (const m of text.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length, found: m[0], fix: keep(m[0], `${root}${b}${m[1]}`) });
  }
  return out.sort((x, y) => x.start - y.start);
}

export function fingerprint(text: string): Fingerprint {
  const sents = sentences(text);
  const words = countWords(text);
  const per1000 = (n: number) => (words ? Math.round((n / words) * 1000 * 10) / 10 : 0);
  const lens = sents.map((s) => s.words).sort((a, b) => a - b);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sd = lens.length ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) : 0;
  const pct = (arr: number[], q: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0);
  let dialogueChars = 0;
  let singles = 0;
  let doubles = 0;
  const paras = paragraphs(text);
  for (const p of paras)
    for (const s of segments(p.text)) {
      if (!s.dialogue) continue;
      dialogueChars += s.text.length;
      if (/^['‘]/.test(s.text)) singles++;
      else doubles++;
    }
  const narration = narrationMask(text);
  const paraSents = paras.map((p) => sents.filter((s) => s.start >= p.start && s.end <= p.end).length).sort((a, b) => a - b);
  const adverbs = [...narration.matchAll(ADVERB_RE)].filter((m) => isAdverb(m[1])).length;
  const uk = spellingFixes(text, 'us').length;
  const us = spellingFixes(text, 'uk').length;
  const openers = new Map<string, number>();
  for (const s of sents) {
    const w = s.text.replace(/^['‘"“]/, '').match(/^[A-Za-z']+/)?.[0]?.toLowerCase();
    if (w) openers.set(w, (openers.get(w) ?? 0) + 1);
  }
  return {
    words,
    sentence_mean: Math.round(mean * 10) / 10,
    sentence_sd: Math.round(sd * 10) / 10,
    sentence_p95: pct(lens, 0.95),
    dialogue_share: text.length ? Math.round((dialogueChars / text.replace(/\s+/g, ' ').length) * 100) / 100 : 0,
    paragraph_sentences_mean: paraSents.length ? Math.round((paraSents.reduce((a, b) => a + b, 0) / paraSents.length) * 10) / 10 : 0,
    paragraph_sentences_p90: pct(paraSents, 0.9),
    adverbs_per_1000: per1000(adverbs),
    filter_words_per_1000: per1000([...narration.matchAll(FILTER_RE)].length),
    em_dashes_per_1000: per1000((text.match(/—/g) ?? []).length),
    semicolons_per_1000: per1000((narration.match(/;/g) ?? []).length),
    narration_exclamations_per_1000: per1000((narration.match(/!/g) ?? []).length),
    narration_contractions_per_1000: per1000([...narration.matchAll(CONTRACTION_RE)].length),
    quotes: singles + doubles === 0 ? 'none' : singles > doubles * 3 ? 'single' : doubles > singles * 3 ? 'double' : 'mixed',
    spelling: uk > us * 2 && uk >= 2 ? 'uk' : us > uk * 2 && us >= 2 ? 'us' : 'unknown',
    top_openers: [...openers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([opener, n]) => ({ opener, share: Math.round((n / Math.max(1, sents.length)) * 100) / 100 })),
  };
}

/** A style sheet set from the author's own writing, with sensible bands around it. */
export function suggestSheet(fp: Fingerprint, base: StyleSheet = StyleSheet.parse({})): StyleSheet {
  const round = (n: number) => Math.round(n * 10) / 10;
  return StyleSheet.parse({
    ...base,
    spelling: fp.spelling === 'unknown' ? base.spelling : fp.spelling,
    quotes: fp.quotes === 'single' || fp.quotes === 'double' ? fp.quotes : base.quotes,
    em_dashes: fp.em_dashes_per_1000 === 0 ? 'ban' : 'limit',
    em_dashes_per_1000: round(Math.max(1, fp.em_dashes_per_1000 * 1.5)),
    semicolons: fp.semicolons_per_1000 === 0 ? 'dialogue-only' : 'allow',
    exclamations: fp.narration_exclamations_per_1000 === 0 ? 'dialogue-only' : 'allow',
    contractions: fp.narration_contractions_per_1000 < 1 ? 'avoid-in-narration' : 'any',
    sentence_words: {
      mean_min: round(Math.max(4, fp.sentence_mean - Math.max(3, fp.sentence_sd * 0.5))),
      mean_max: round(fp.sentence_mean + Math.max(3, fp.sentence_sd * 0.5)),
      max: Math.max(20, Math.round(fp.sentence_p95 * 1.5)),
    },
    dialogue_share: { min: round(Math.max(0, fp.dialogue_share - 0.25)), max: round(Math.min(1, fp.dialogue_share + 0.25)) },
    paragraph_sentences_max: Math.max(3, fp.paragraph_sentences_p90 + 2),
    adverbs_per_1000_max: round(Math.max(3, fp.adverbs_per_1000 * 1.5)),
    filter_words_per_1000_max: round(Math.max(2, fp.filter_words_per_1000 * 1.5)),
  });
}

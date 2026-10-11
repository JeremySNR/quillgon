/**
 * The habits of machine-written prose, found by code.
 *
 * Built from: Wikipedia's "Signs of AI writing" (WikiProject AI Cleanup); the humanizer skill
 * (github.com/blader/humanizer, MIT) and stop-slop (github.com/hardikpandya/stop-slop, MIT);
 * Sam Paech's slop-score and slop-forensics lists (MIT) and the Antislop paper (ICLR 2026);
 * Kobak et al. on excess vocabulary in scientific abstracts (Science Advances 2025); Reinhart
 * et al. on participial clauses (PNAS 2025); the LAMP edit categories (Chakrabarty et al., CHI 2025).
 *
 * What the research agrees on, and how this module follows it:
 *  - Structure outlasts vocabulary: word lists go stale, staged contrasts and "-ing" riders do
 *    not. Structures are strong signals; single words are weak and only count in clusters.
 *  - The author's own writing wins: anything their samples use is their voice, not a tell.
 *  - Flag rates and clusters, not every use, or the cure becomes its own machine style.
 *  - Long ban lists belong here, in code, not in the prompt that writes the prose (naming a
 *    word in a prompt can make it more likely).
 *
 * Pure and dependency-free, so the editor can underline tells as you type.
 */

export type TellFamily = 'staging' | 'inflation' | 'cliche' | 'rhythm' | 'leftover' | 'vocabulary' | 'dialogue';

export interface Tell {
  /** Stable id ("not-x-but-y", "word:tapestry"). */
  rule: string;
  family: TellFamily;
  /** Strong tells count on their own; weak ones only in clusters or at unusual rates. */
  strength: 'strong' | 'weak';
  start: number;
  end: number;
  text: string;
  message: string;
}

export interface TellOptions {
  /** True books (life stories, memoirs, guides): real names are never "stock names". */
  kind?: 'fiction' | 'true';
  /** The author's own writing: what it does is allowed. */
  samples?: string;
  /** Words and rule ids the author has allowed. */
  allow?: string[];
}

// ------------------------------------------------------------------ structures (strong)

interface Pattern {
  rule: string;
  family: TellFamily;
  re: RegExp;
  message: string;
  /** Only at the start of a paragraph. */
  paragraphStart?: boolean;
}

const BE = String.raw`(?:'s|’s| is| was| are| were)`;
const NOT_BE = String.raw`(?:isn't|isn’t|wasn't|wasn’t|aren't|aren’t|weren't|weren’t|is not|was not|are not|were not)`;
const NOT_BE_SUBJ = String.raw`(?:'s not|’s not|'re not|’re not| isn't| isn’t| wasn't| wasn’t| aren't| aren’t| weren't| weren’t| is not| was not| are not| were not)`;

const PATTERNS: Pattern[] = [
  // Staging: a contrast nobody asked for.
  { rule: 'not-x-but-y', family: 'staging', re: new RegExp(String.raw`\bnot (?:just|only|merely|simply|even) [^.?!;]{1,60}?(?:,|;|—|–| -)\s*(?:but|it${BE}|they${BE}|this${BE}|that${BE})\b`, 'gi'), message: 'A staged contrast (“not just X, but Y”). Say what it is.' },
  // The same subject both times: "It wasn't the noise. It was the silence." ("He wasn't hungry. She was tired." is not staging.)
  { rule: 'not-x-but-y', family: 'staging', re: new RegExp(String.raw`\b(it|this|that|he|she|they|we|you|i)${NOT_BE_SUBJ} (?:about |just |only |merely )?[^.?!;,]{1,50}[.;]\s+\1(?:'s|’s|'re|’re| is| was| are| were) [^.?!]{1,80}`, 'gi'), message: 'A staged contrast (“It wasn’t X. It was Y.”). Say what it was.' },
  // "wasn't anger, but grief"; not "wasn't easy, but we managed", where a clause follows.
  { rule: 'not-x-but-y', family: 'staging', re: new RegExp(String.raw`\b${NOT_BE} (?:about )?(?:the |a |an )?[\w’'-]+(?: [\w’'-]+){0,3}, but (?!(?:we|i|he|she|they|it|you|the|a|an|there|that|this|then|not|still|also|now|as|in|at|on|by|with)\b)`, 'gi'), message: 'A staged contrast (“wasn’t anger, but grief”). Say what it was.' },
  { rule: 'no-longer', family: 'staging', re: /\bno longer [^.?!;]{1,50}[.;]\s+(?:it|this|that|he|she|they|we|i)(?:'s|’s| is| was| are| were) /gi, message: 'A staged turn (“no longer X. It was Y.”).' },
  { rule: 'no-x-no-y', family: 'staging', re: /(?:^|[.!?]\s+)(?:No|Not) [^.?!\n]{1,40}\.\s+(?:No|Not) [^.?!\n]{1,40}\./g, message: 'A list of negatives (“No X. No Y.”) set up for a reveal.' },
  { rule: 'staged-question', family: 'staging', re: /\b(?:the real question is|the question isn'?t|here'?s the thing|here'?s what|let that sink in|make no mistake|the truth is|at its core|at the heart of it|the uncomfortable truth|and that'?s okay|think about it:)/gi, message: 'A staged run-up. Start with the point.' },

  // Inflation: significance claimed instead of shown.
  { rule: 'ing-rider', family: 'inflation', re: /,\s+(?:highlighting|underscoring|emphasi[sz]ing|showcasing|reflecting|symboli[sz]ing|ensuring|fostering|cementing|solidifying|signall?ing|reinforcing|illustrating|demonstrating|serving as)\b/gi, message: 'A trailing “-ing” clause that comments on what just happened. Cut it, or say it plainly.' },
  { rule: 'serves-as', family: 'inflation', re: /\b(?:serves|served|serving|stands|stood|functions|functioned) as (?:a|an|the)\b/gi, message: '“Serves as” for “is”.' },
  { rule: 'testament', family: 'inflation', re: /\b(?:a|is a|was a|stands as a|stood as a) (?:testament|reminder|tribute) (?:to|of|that)\b/gi, message: 'Significance claimed, not shown (“a testament to”).' },
  { rule: 'vital-role', family: 'inflation', re: /\bplay(?:s|ed|ing)? an? (?:vital|crucial|pivotal|key|significant|important|central) role\b/gi, message: 'Inflated significance (“plays a pivotal role”).' },
  { rule: 'legacy', family: 'inflation', re: /\b(?:enduring|lasting|indelible|profound) (?:legacy|mark|impact|impression|influence)\b|\bdeeply rooted\b|\bleft an indelible\b/gi, message: 'Inflated significance (“an enduring legacy”).' },

  // Leftovers: the habits of a chat assistant.
  { rule: 'important-to-note', family: 'leftover', re: /\b(?:it'?s|it is|it’s) (?:important|crucial|worth|essential|vital) (?:to note|to remember|noting|to consider|to understand|to recognise|to recognize)\b/gi, message: 'A didactic aside. Say the thing.' },
  { rule: 'summary', family: 'leftover', re: /\b(?:in summary|in conclusion|to sum up|all in all)\b/gi, message: 'A summary nobody needs.' },
  { rule: 'coda', family: 'leftover', re: /^(?:Ultimately|Overall|In the end|In many ways|At the end of the day|And so|Looking back),\s/gm, message: 'A paragraph that sums itself up. Let it end on its last true moment.', paragraphStart: true },
  { rule: 'chat', family: 'leftover', re: /\b(?:I hope this helps|let me know if|as of my last (?:update|knowledge)|certainly!|of course!|great question|feel free to)\b/gi, message: 'Chat residue.' },
  { rule: 'vague-attribution', family: 'leftover', re: /\b(?:some|many) (?:critics|experts|observers|people|scholars) (?:argue|say|believe|suggest|have noted)\b|\bexperts (?:say|agree|suggest|believe)\b|\bit is (?:widely|often|generally) (?:believed|said|thought)\b/gi, message: 'A vague attribution. Who, exactly?' },

  // Dialogue.
  { rule: 'adverb-tag', family: 'dialogue', re: /\b(?:said|asked|replied|whispered|murmured|added|answered)\s+(?!only\b|early\b|family\b)\w{3,}ly\b/gi, message: 'An adverb on a dialogue tag. Let the line carry it.' },
  { rule: 'voice-laced', family: 'dialogue', re: /\b(?:his|her|their|my) voice (?:barely (?:above )?a whisper|laced with|tinged with|thick with|heavy with|dripping with|steady despite)\b/gi, message: 'A stock description of a voice.' },
];

// ------------------------------------------------------------------ stock phrases (strong)

/** Multi-word clichés models reach for, from the slop-score and antislop lists. */
const PHRASES = [
  'a sense of', "couldn't help but", 'could not help but', 'let out a breath', "a breath (?:she|he|they|i) didn'?t know", 'shivers? (?:ran |went )?(?:down|up) (?:her|his|their|my) spine',
  'time stood still', 'heart pounding', 'mind racing', 'the air was thick', 'hung in the air', 'a flicker of', 'a pang of', 'something shifted', 'little did (?:he|she|they|i|we) know',
  'dust motes', 'knuckles (?:turning|turned|went) white', 'blood ran cold', 'eyes never leaving', 'a smile playing', 'with a mixture of', 'a mix of emotions', 'casting long shadows', 'the sun dipped',
  'days turned (?:into )?weeks', 'a renewed sense of', 'whatever (?:challenges )?lay ahead', 'for now,? that was enough', 'maybe,? just maybe', 'life would never be the same', 'they would face it together',
  'was only just beginning', 'in a world where', 'a dance of', 'a symphony of', 'a tapestry of', 'the fabric of', 'beacon of hope', 'glimmer of hope', 'in stark contrast', 'almost imperceptibl[ey]',
  'practi[cs]ed ease', 'moth to a flame', 'the weight of (?:it all|the world|his words|her words|the moment)', 'unspoken (?:words|tension|understanding|question)', 'a wave of (?:relief|emotion|nausea|guilt)',
  'took a deep breath', 'swallowed hard', 'shook (?:her|his|their) head', 'eyes widened', 'brow furrowed', 'jaw clenched', 'a lump in (?:her|his|my|their) throat', 'heart skipped a beat',
  'every fiber of', 'every fibre of', 'in the grand scheme', 'the calm before the storm', 'a stark reminder', 'the double-edged sword', 'ever-evolving landscape', 'navigate the complexities',
];
const PHRASE_RE = new RegExp(`\\b(?:${PHRASES.join('|')})\\b`, 'gi');

// ------------------------------------------------------------------ vocabulary (weak, clusters)

/** Words over-used by models: single uses are fine; three in a paragraph are a tell. */
export const AI_WORDS = [
  // Wikipedia's words to watch and Kobak et al.'s excess style words.
  'delve', 'delves', 'delving', 'tapestry', 'testament', 'underscore', 'underscores', 'showcase', 'showcases', 'showcasing', 'intricate', 'intricacies', 'meticulous', 'meticulously', 'pivotal', 'crucial',
  'multifaceted', 'nuanced', 'realm', 'interplay', 'landscape', 'leverage', 'leveraging', 'robust', 'seamless', 'seamlessly', 'vibrant', 'enduring', 'foster', 'fostering', 'garner', 'garnered',
  'bolster', 'bolstered', 'paramount', 'holistic', 'cornerstone', 'transformative', 'unwavering', 'indelible', 'navigate', 'navigating', 'resonate', 'resonated', 'resonates', 'profound', 'embark',
  'elevate', 'unleash', 'symphony', 'kaleidoscope', 'camaraderie', 'notably', 'moreover', 'furthermore', 'additionally', 'commendable', 'invaluable', 'groundbreaking', 'burgeoning', 'akin', 'amidst',
  // Fiction slop words (slop-score).
  'palpable', 'ethereal', 'enigmatic', 'labyrinthine', 'luminescent', 'otherworldly', 'tendrils', 'thrummed', 'shimmered', 'flickered', 'lingered', 'loomed', 'gleamed', 'glint', 'unbidden',
  'unreadable', 'unshed', 'trepidation', 'cacophony', 'precipice', 'reverberated', 'whispered', 'murmured', 'steeled', 'steepled', 'wafted', 'verdant', 'inky', 'impossibly', 'newfound', 'undercurrent',
  'quietly', 'stillness', 'ministrations',
];
const WORD_RE = new RegExp(`\\b(?:${AI_WORDS.join('|')})\\b`, 'gi');

/** Names models give characters again and again (slop-score). Fiction only. */
export const STOCK_NAMES = ['Elara', 'Lyra', 'Kael', 'Silas', 'Thorne', 'Voss', 'Seraphina', 'Elowen', 'Liora', 'Isolde', 'Lysander', 'Malachai', 'Theron', 'Finnian', 'Eldoria', 'Whisperwood', 'Oakhaven', 'Zephyr', 'Aria', 'Jaxon'];
const NAME_RE = new RegExp(`\\b(?:${STOCK_NAMES.join('|')})\\b`, 'g');

// ------------------------------------------------------------------ the check

const norm = (s: string) => s.toLowerCase().replace(/[’]/g, "'");

/**
 * What the author's own samples do: the stock phrases and words they use, and the structures
 * they reach for. All of it is allowed.
 */
export function allowedFromSamples(samples: string): Set<string> {
  const allowed = new Set<string>();
  if (!samples.trim()) return allowed;
  for (const m of samples.matchAll(WORD_RE)) allowed.add(`word:${norm(m[0])}`);
  for (const m of samples.matchAll(PHRASE_RE)) allowed.add(`phrase:${norm(m[0])}`);
  for (const p of PATTERNS) if (new RegExp(p.re.source, p.re.flags).test(samples)) allowed.add(p.rule);
  return allowed;
}

/** Every tell in the text, strong and weak, minus what the author allows. */
export function findTells(text: string, opts: TellOptions = {}): Tell[] {
  const allowed = allowedFromSamples(opts.samples ?? '');
  for (const a of opts.allow ?? []) {
    const x = norm(a.trim());
    if (!x) continue;
    allowed.add(x);
    allowed.add(`word:${x}`);
    allowed.add(`phrase:${x}`);
  }
  const out: Tell[] = [];
  const add = (t: Tell) => {
    if (!out.some((o) => o.start < t.end && t.start < o.end)) out.push(t);
  };

  for (const p of PATTERNS) {
    if (allowed.has(p.rule)) continue;
    for (const m of text.matchAll(new RegExp(p.re.source, p.re.flags))) {
      const lead = m[0].match(/^(?:[.!?]\s+)/)?.[0].length ?? 0;
      const start = m.index! + lead;
      add({ rule: p.rule, family: p.family, strength: 'strong', start, end: m.index! + m[0].length, text: m[0].slice(lead).trim(), message: p.message });
    }
  }
  for (const m of text.matchAll(PHRASE_RE)) {
    if (allowed.has(`phrase:${norm(m[0])}`)) continue;
    add({ rule: `phrase:${norm(m[0])}`, family: 'cliche', strength: 'strong', start: m.index!, end: m.index! + m[0].length, text: m[0], message: `A stock phrase (“${m[0]}”). Say it your own way, or not at all.` });
  }
  if (opts.kind !== 'true')
    for (const m of text.matchAll(NAME_RE)) add({ rule: 'stock-name', family: 'cliche', strength: 'strong', start: m.index!, end: m.index! + m[0].length, text: m[0], message: `“${m[0]}” is one of the names models give everyone. Pick one that belongs to this world.` });

  // Words: weak, and only where they cluster (three or more in one paragraph).
  for (const para of paragraphSpans(text)) {
    const hits = [...para.text.matchAll(WORD_RE)].filter((m) => !allowed.has(`word:${norm(m[0])}`));
    if (new Set(hits.map((h) => norm(h[0]))).size < 3) continue;
    for (const h of hits)
      add({ rule: `word:${norm(h[0])}`, family: 'vocabulary', strength: 'weak', start: para.start + h.index!, end: para.start + h.index! + h[0].length, text: h[0], message: `“${h[0]}” is a word models over-use, and this paragraph has several.` });
  }

  // Rhythm: the same opener three times running (four for I/he/she, which prose leans on anyway).
  const sents = sentenceSpans(text);
  for (let i = 0; i + 2 < sents.length; i++) {
    const first = (s: { text: string }) => s.text.match(/^[“"']?([A-Za-z’']+)/)?.[1]?.toLowerCase() ?? '';
    const w = first(sents[i]);
    if (!w || allowed.has('same-opener')) continue;
    const need = ['i', 'he', 'she', 'they', 'we'].includes(w) ? 4 : 3;
    if (sents.slice(i, i + need).length === need && sents.slice(i, i + need).every((s) => first(s) === w)) {
      add({ rule: 'same-opener', family: 'rhythm', strength: 'weak', start: sents[i].start, end: sents[i + need - 1].end, text: sents.slice(i, i + need).map((s) => s.text).join(' '), message: `${need} sentences in a row start with “${w}”.` });
      i += need - 1;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Lists of three ("A, B, and C"), per 1,000 words: a reflex in machine prose. */
export function triadRate(text: string): number {
  const n = [...text.matchAll(/\b[\w’'-]+(?: [\w’'-]+){0,3}, [\w’'-]+(?: [\w’'-]+){0,3},? (?:and|or) [\w’'-]+/g)].length;
  return Math.round((n / Math.max(1, wordCount(text))) * 1000 * 10) / 10;
}

/** How much sentence lengths vary (coefficient of variation): machine prose is often even. */
export function lengthVariation(text: string): number | null {
  const lens = sentenceSpans(text).map((s) => wordCount(s.text)).filter((n) => n > 0);
  if (lens.length < 8) return null;
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return Math.round((sd / mean) * 100) / 100;
}

export interface TellProfile {
  words: number;
  strong: number;
  weak: number;
  /** AI habits per 1,000 words: strong tells count 4, weak 1 (after slop-forensics' weighting). */
  score: number;
  by_family: Record<TellFamily, number>;
  top: { rule: string; count: number; example: string }[];
  triads_per_1000: number;
  length_variation: number | null;
  /** Rates that stand out against the author's samples (when there are samples). */
  rhythm: string[];
}

/** One number and a breakdown for a passage, a chapter or a book. */
export function tellProfile(text: string, opts: TellOptions = {}): TellProfile {
  const tells = findTells(text, opts);
  const words = wordCount(text);
  const strong = tells.filter((t) => t.strength === 'strong').length;
  const weak = tells.length - strong;
  const by_family = { staging: 0, inflation: 0, cliche: 0, rhythm: 0, leftover: 0, vocabulary: 0, dialogue: 0 } as Record<TellFamily, number>;
  const counts = new Map<string, { count: number; example: string }>();
  for (const t of tells) {
    by_family[t.family]++;
    const c = counts.get(t.rule) ?? { count: 0, example: t.text };
    c.count++;
    counts.set(t.rule, c);
  }
  const triads = triadRate(text);
  const variation = lengthVariation(text);
  const rhythm: string[] = [];
  const samples = opts.samples ?? '';
  if (wordCount(samples) >= 300) {
    const own = triadRate(samples);
    if (triads > own * 1.5 + 2) rhythm.push(`Lists of three: ${triads} per 1,000 words, against ${own} in your own writing.`);
    const ownVar = lengthVariation(samples);
    if (variation !== null && ownVar !== null && variation < ownVar - 0.15) rhythm.push(`Sentence lengths are more even than yours (variation ${variation} against ${ownVar}).`);
  } else if (triads > 6) rhythm.push(`Lists of three: ${triads} per 1,000 words.`);
  return {
    words,
    strong,
    weak,
    score: Math.round(((strong * 4 + weak) / Math.max(1, words)) * 1000 * 10) / 10,
    by_family,
    top: [...counts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8).map(([rule, c]) => ({ rule, ...c })),
    triads_per_1000: triads,
    length_variation: variation,
    rhythm,
  };
}

/** AI habits per 1,000 words. */
export const tellScore = (text: string, opts: TellOptions = {}) => tellProfile(text, opts).score;

// ------------------------------------------------------------------ text helpers (kept here so this module stays dependency-free)

function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}’'-]+/gu) ?? []).length;
}

function paragraphSpans(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  for (const m of text.matchAll(re)) out.push({ start: m.index!, text: m[0] });
  return out;
}

function sentenceSpans(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const m of text.matchAll(/[^.!?\n]+(?:[.!?]+["”’']?|$)/gm)) {
    const t = m[0].trim();
    if (t.length < 2) continue;
    const start = m.index! + m[0].indexOf(t);
    out.push({ start, end: start + t.length, text: t });
  }
  return out;
}

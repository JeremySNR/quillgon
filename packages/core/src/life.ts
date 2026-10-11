import { LADDER, type Ladder, type Question, type Story } from './schemas/index.js';

/**
 * Life stories, the parts that need no model: the opening question bank, how far a story has
 * been drawn out, and ages on the timeline.
 */

/**
 * The first questions in a life story. After Dan McAdams' Life Story Interview: the life as
 * chapters first, then its key scenes, each later drawn out with follow-ups. The ghostwriter
 * plans sessions from this queue and adds to it as gaps appear.
 */
export const OPENING_QUESTIONS: Omit<Question, 'status' | 'asked_in' | 'ask'>[] = [
  { id: 'q-chapters', text: 'If your life were a book, what would its chapters be? Just the names and roughly when each one starts.', why: 'The shape of the life, in your own words, before any detail.', technique: 'Life chapters', about: 'book', priority: 1 },
  { id: 'q-about', text: 'Who is this book for, and what do you most want them to understand about you when they finish it?', why: 'Decides what the book is about, and so what it leaves out.', technique: 'Purpose', about: 'book', priority: 1 },
  { id: 'q-earliest', text: 'What is your earliest memory? Take your time; even a fragment is fine.', why: 'Earliest memories set the tone of a life story.', technique: 'Key scene: earliest', about: 'book', priority: 2 },
  { id: 'q-home', text: 'Tell me about the house you grew up in. Walk me through the front door.', why: 'Places bring back people and scenes.', technique: 'Go back to the place', about: 'book', priority: 2 },
  { id: 'q-high', text: 'Think of a moment that stands out as one of the best in your life. Tell me about that one time.', why: 'A high point (McAdams).', technique: 'Key scene: high point', about: 'book', priority: 2 },
  { id: 'q-low', text: 'Was there a time that stands out as one of the hardest? Only if you want to; we can come back to it another day.', why: 'A low point (McAdams). Never pushed.', technique: 'Key scene: low point', about: 'book', priority: 3 },
  { id: 'q-turning', text: 'Was there a moment when your life went one way rather than another? What happened?', why: 'A turning point (McAdams).', technique: 'Key scene: turning point', about: 'book', priority: 2 },
  { id: 'q-people', text: 'Who are the people without whom your life would have been completely different?', why: 'The cast of the book.', technique: 'People', about: 'book', priority: 2 },
  { id: 'q-wisdom', text: 'Tell me about a time you understood something about life that you had not understood before.', why: 'A wisdom event (McAdams), and the narrator-now voice.', technique: 'Key scene: wisdom', about: 'book', priority: 3 },
];

export function openingQuestions(): Question[] {
  return OPENING_QUESTIONS.map((q) => ({ ...q, ask: '', status: 'queued', asked_in: null }));
}

/** How far up the ladder a story is, 0..1: half credit for a rung partly there. */
export function ladderScore(l: Ladder): number {
  return LADDER.reduce((n, r) => n + (l[r] === 'yes' ? 1 : l[r] === 'some' ? 0.5 : 0), 0) / LADDER.length;
}

/** The next rung to climb: the first not yet there. */
export function nextRung(l: Ladder): (typeof LADDER)[number] | null {
  return LADDER.find((r) => l[r] === 'no') ?? LADDER.find((r) => l[r] === 'some') ?? null;
}

/** Enough to write a scene: a particular time, with people, something sensory, and what it meant. */
export function enoughForScene(s: Pick<Story, 'ladder'>): boolean {
  const l = s.ladder;
  return l.happened === 'yes' && l.instance === 'yes' && l.people !== 'no' && (l.senses !== 'no' || l.words !== 'no') && (l.felt_then !== 'no' || l.means_now !== 'no');
}

export const RUNG_LABEL: Record<(typeof LADDER)[number], string> = {
  happened: 'What happened',
  instance: 'One particular time',
  people: 'Who was there',
  senses: 'What you saw and heard',
  words: 'What was said',
  felt_then: 'What you felt then',
  means_now: 'What it means now',
};

/** The first four-digit year in a date string ("1962", "summer 1962", "1962-07"). */
export function yearOf(when: string): number | null {
  const m = when.match(/\b(1[89]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

/** Age at a date, given a birth year; null when either is unknown. */
export function ageAt(born: string, when: string): number | null {
  const b = yearOf(born);
  const w = yearOf(when);
  return b !== null && w !== null && w >= b ? w - b : null;
}

// ------------------------------------------------------------------ interviewing, without a model

/** A safe, open question for each rung: the fallback when a proposed question is refused. */
export const RUNG_QUESTION: Record<(typeof LADDER)[number], (title: string) => string> = {
  happened: (t) => (t ? `Tell me about ${lowerFirst(t)}. What happened?` : 'Tell me what happened.'),
  instance: () => 'Can you remember one particular time? Tell me about that one.',
  people: () => 'Who was there?',
  senses: () => 'Picture it for a moment. What could you see and hear?',
  words: () => 'Do you remember anything anyone said?',
  felt_then: () => 'How did you feel at the time?',
  means_now: () => 'Looking back now, what do you make of it?',
};

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(I|I'm)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

const VAGUE = /\b(fine|normal|nothing much|not much|i don'?t know|the usual|ordinary|it was ok(ay)?|alright|can'?t say)\b/i;
const HABITUAL = /\b(we|i|he|she|they) (always|used to|would always|never)\b|\bevery (day|week|summer|sunday|saturday|year|morning|night)\b/i;
const FEELING = /\b(cried|crying|scared|terrified|ashamed|furious|angry|hated|loved|lonely|heartbroken|guilty|frightened|devastated|happiest|worst|best|proud)\b/i;
const SURPRISE = /\b(never told|nobody knew|no one knew|secret|found out|turned out|didn'?t know (until|then)|but then|except|to this day|i still don'?t)\b/i;

/**
 * Follow-up triggers found in code, so the interviewer cannot skip them: studies of AI
 * interviewers found the commonest failure was moving on after a vague, surprising or
 * emotional answer.
 */
export function probesFor(answer: string): string[] {
  const out: string[] = [];
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  if (words > 0 && (words < 8 || VAGUE.test(answer))) out.push('The answer was short or vague: ask for one particular time, gently.');
  if (HABITUAL.test(answer)) out.push('They generalised ("always", "used to"): ask for one particular occasion.');
  const surprise = answer.match(SURPRISE);
  if (surprise) out.push(`Something surprising ("${surprise[0]}"): follow it before the agenda.`);
  const feeling = answer.match(FEELING);
  if (feeling) out.push(`They named a strong feeling ("${feeling[0]}"): stay with it; ask about that moment, without pushing.`);
  return out;
}

const YES_NO = /^(was|were|did|is|are|do|does|had|have|has|could|would|wasn'?t|didn'?t|weren'?t|isn'?t|haven'?t|hadn'?t)\b/i;

/**
 * Does a question put words in the author's mouth? A yes/no question that brings in a name or
 * detail the author never said invites them to confirm something they may not remember: a
 * known route to false memories.
 */
export function leadingQuestion(question: string, said: string, known: string[] = []): string | null {
  const saidLower = said.toLowerCase();
  const knownLower = known.map((k) => k.toLowerCase());
  for (const sentence of question.split(/(?<=[.?!])\s+/)) {
    if (!sentence.trim().endsWith('?') || !YES_NO.test(sentence.trim())) continue;
    const words = (sentence.match(/[\p{L}'’]+/gu) ?? [])
      .slice(1)
      .filter((w) => w.length >= 4)
      .map((w) => w.toLowerCase());
    const brought = words.filter((w) => !saidLower.includes(w) && !knownLower.some((k) => k.includes(w)) && !COMMON.has(w));
    if (brought.length) return `"${sentence.trim()}" suggests a detail (${brought.slice(0, 3).join(', ')}) they have not given and asks them to confirm it. Ask an open question instead.`;
  }
  return null;
}

const COMMON = new Set(
  'that this there then they them their what when where which while with were have about your yours after before still really remember think feel felt time back like just very much more some first last also ever same other else would could should those these thing things anything something someone anyone people place again been into from over only long well good know want went come came said tell talk sure maybe already right moment there\'s that\'s wasn\'t didn\'t weren\'t hadn\'t'.split(
    ' ',
  ),
);

/** Does a question touch a topic the author put off limits? Returns the topic. */
export function touchesOffLimits(question: string, offLimits: string[]): string | null {
  const q = question.toLowerCase();
  for (const topic of offLimits) {
    const words = (topic.toLowerCase().match(/[\p{L}']{4,}/gu) ?? []).filter((w) => !COMMON.has(w));
    if (words.length && words.some((w) => q.includes(w.replace(/s$/, '')))) return topic;
  }
  return null;
}

/** Stretches of at least `min` years between birth (or the first event) and the last event with nothing in them. */
export function lifeGaps(born: string, whens: string[], now = new Date().getFullYear(), min = 6): string[] {
  const years = [...new Set(whens.map(yearOf).filter((y): y is number => y !== null))].sort((a, b) => a - b);
  const start = yearOf(born) ?? years[0];
  if (start === undefined || start === null) return [];
  const marks = [start, ...years.filter((y) => y > start), now];
  const out: string[] = [];
  for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] - 1 >= min) out.push(`${marks[i - 1] + 1} to ${marks[i] - 1}`);
  return out;
}

/** Things the author reports someone said, in quotation marks. */
export function quotedSpeech(text: string): string[] {
  return [...text.matchAll(/["“]([^"”]{3,200})["”]|'([^']{6,200})'(?=[\s,.!?]|$)/g)].map((m) => (m[1] ?? m[2]).trim());
}

// ------------------------------------------------------------------ truth: does the prose come from the material?

const STOPWORDS = new Set(
  'about above after again against also although always among another around because been before being below between both came cannot come could didn does doing done down during each even ever every from further gave give going gone got have having here hers herself himself into itself just know knew last like little made make many more most much must myself never next once only other ought ours over own quite rather really said same seem seemed shall should since some still such than that their them then there these they thing things think this those though through till together took toward under until upon very want went were what when where which while whom whose will with within without would year years your yours'.split(
    ' ',
  ),
);

/** A crude stem, enough to match "machines" with "machine" and "walked" with "walk". */
export function stem(w: string): string {
  return w
    .toLowerCase()
    .replace(/['’]s$/, '')
    .replace(/(ies)$/, 'y')
    .replace(/(ing|ed|es|s|ly)$/, '')
    .replace(/(.)\1$/, '$1');
}

const contentStems = (t: string) => (t.match(/[\p{L}'’]{4,}/gu) ?? []).filter((w) => !STOPWORDS.has(w.toLowerCase())).map(stem);

export interface Unsourced {
  /** The sentence (or quotation) as it appears in the prose. */
  text: string;
  reason: 'no-source' | 'quote-changed';
}

/**
 * Sentences of a draft that nothing the author said supports, and quotations that are not word
 * for word what was said. Conservative: a sentence is flagged only when most of its content words
 * appear nowhere in the material, so connective prose ("The next morning I went back") passes.
 */
export function unsourced(prose: string, material: string[], quotes: string[], max = 6): Unsourced[] {
  const vocab = new Set(material.flatMap(contentStems));
  const norm = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const known = quotes.map(norm);
  const out: Unsourced[] = [];
  for (const m of prose.matchAll(/["“]([^"”]{8,400})["”]/g)) {
    const q = norm(m[1]);
    if (known.some((k) => k === q || k.includes(q) || q.includes(k))) continue;
    const words = contentStems(m[1]);
    if (words.length >= 3) out.push({ text: m[0], reason: 'quote-changed' });
  }
  const plain = prose.replace(/\[TK:[^\]]*\]/g, ' ').replace(/["“][^"”]*["”]/g, ' ');
  for (const sentence of plain.split(/(?<=[.!?])\s+/)) {
    const words = contentStems(sentence);
    if (words.length < 4) continue;
    const found = words.filter((w) => vocab.has(w)).length / words.length;
    if (found < 0.4) out.push({ text: sentence.trim(), reason: 'no-source' });
  }
  return out.slice(0, max);
}

/** The gap markers a draft left for the author ("[TK: the street]"). */
export function gapMarkers(prose: string): string[] {
  return [...prose.matchAll(/\[TK:[^\]]*\]/g)].map((m) => m[0]);
}

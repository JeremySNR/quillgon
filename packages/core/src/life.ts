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

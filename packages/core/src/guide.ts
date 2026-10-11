import type { GuidePreset, Question } from './schemas/index.js';
import { stem } from './life.js';

/**
 * Guides (non-fiction that teaches what the author knows), the parts that need no model: the
 * opening questions, and checks a reader's trust depends on. A statistic nobody can source, a
 * tax figure with no date, advice worded as a personal recommendation, a worked example whose
 * sums do not add up: each is found by code and becomes a margin note.
 */

/**
 * The first questions for a guide, after how ghostwriters of business books begin: the reader
 * and the promise first, then the author's method and the stories that prove it.
 */
export function guideOpeningQuestions(preset: GuidePreset = 'general'): Question[] {
  const q = (id: string, text: string, why: string, technique: string, priority: 1 | 2 | 3): Question => ({ id, text, why, technique, about: 'book', ask: '', priority, status: 'queued', asked_in: null });
  const out = [
    q('q-reader', 'Who is this book for? Describe one real person you have helped who is exactly that reader, and where they were stuck.', 'A book for everyone is for no one: the reader decides what goes in.', 'The reader', 1),
    q('q-promise', 'What will that reader be able to do after the book that they cannot do now?', 'The promise every chapter has to keep.', 'The promise', 1),
    q('q-wrong', 'What is the usual advice on this, and where is it wrong?', 'Why this book, when so many others exist.', 'Against the grain', 1),
    q('q-method', 'Walk me through how you actually do it, step by step, the way you would with a new client.', 'The method, before it is tidied into a framework.', 'Your method', 1),
    q('q-learned', 'How did you learn this? Tell me about the moment it clicked for you.', 'Where your authority comes from, as a story.', 'Origin story', 2),
    q('q-client', 'Tell me about one person whose results changed because of what you showed them. What happened, step by step?', 'Proof, as a story readers remember.', 'A real case', 2),
    q('q-beginner', 'What do beginners get wrong most often, and what does it cost them?', 'Experts skip what they find obvious: this is where readers get stuck.', 'Play the beginner', 2),
    q('q-cant', 'What can this book not do for the reader? Where should they get other help?', 'Honest limits make the rest believable.', 'Limits', 3),
  ];
  if (preset === 'coaching') out.push(q('q-words', 'When someone pushes back, what exactly do you say? Give me the words you use.', 'Scripts are what readers copy.', 'The exact words', 2));
  if (preset === 'finance') out.push(q('q-where', 'Which country and tax year should the figures in the book hold for?', 'Allowances and rates change every year and differ between countries.', 'Jurisdiction', 1));
  if (preset === 'self-help') out.push(q('q-evidence', 'What tells you this works: your clients, research you trust, or both?', 'The book should say which, honestly.', 'What it rests on', 2));
  return out;
}

const sentencesOf = (text: string) =>
  text
    .replace(/\[TK:[^\]]*\]/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);

/** Numbers as written ("61%", "£12,570", "3.5", "two in five" is left to the model). */
const numbersIn = (s: string) => [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));

const STAT = /\b\d[\d,.]*\s?(%|per ?cent\b)|\b\d+ (in|out of) (\d+|ten|five|four|three)\b|\b(studies|research|surveys?|data|experts?|scientists) (show|shows|found|finds|suggest|suggests|say|says|prove|proves)\b|\baccording to\b/i;

/**
 * Sentences that state a statistic or lean on research, which nothing supports: neither the
 * author's own words nor the evidence library. Every number in the sentence must appear in the
 * support, and for "studies show" the sentence's content words too.
 */
export function unbackedClaims(prose: string, support: string[], max = 8): string[] {
  const all = support.join(' \n ');
  const numbers = new Set(numbersIn(all));
  const vocab = new Set((all.match(/[\p{L}'’]{4,}/gu) ?? []).map(stem));
  const out: string[] = [];
  for (const s of sentencesOf(prose.replace(/["“][^"”]*["”]/g, ' '))) {
    if (!STAT.test(s)) continue;
    const nums = numbersIn(s).filter((n) => !/^(19|20)\d\d$/.test(n));
    const numbersOk = nums.every((n) => numbers.has(n));
    const words = (s.match(/[\p{L}'’]{4,}/gu) ?? []).map(stem);
    const wordsOk = !words.length || words.filter((w) => vocab.has(w)).length / words.length >= 0.5;
    if (!(numbersOk && (nums.length ? true : wordsOk))) out.push(s);
  }
  return out.slice(0, max);
}

const DATED = /\b(allowance|threshold|tax[- ]free|tax band|basic rate|higher rate|additional rate|rate of tax|income tax|capital gains|inheritance tax|national insurance|state pension|pension (allowance|limit)|annual allowance|isa|401\(?k\)?|ira|roth|interest rate|base rate|bank rate|inflation|minimum wage|living wage|benefit cap|stamp duty|vat)\b/i;
const AMOUNT = /[£$€]\s?\d|\d[\d,.]*\s?(%|per ?cent\b|k\b|thousand|million)/i;

/** Finance: figures that change with the year or the country, stated without saying when or where they hold. */
export function datedFigures(prose: string, asOf: string, max = 8): string[] {
  const out: string[] = [];
  for (const s of sentencesOf(prose)) {
    if (!DATED.test(s) || !AMOUNT.test(s)) continue;
    const dated = /\b(19|20)\d\d\b|\b(tax year|this year|as of|at the time of writing|currently)\b/i.test(s) || (!!asOf && s.includes(asOf));
    if (!dated) out.push(s);
  }
  return out.slice(0, max);
}

const ADVICE = /\byou (should|must|need to|ought to) (buy|sell|invest|put (your|it|all)|move (your|it)|switch|borrow|take out|cash in|withdraw)\b|\bguaranteed (return|returns|profit|profits|income|growth)\b|\brisk[- ]free\b|\bcan'?t (lose|go wrong)\b|\bsure[- ]fire\b|\b(double|triple) your money\b/i;

/** Finance: wording that reads as a personal recommendation or a promise of returns. */
export function adviceWording(prose: string, max = 8): string[] {
  return sentencesOf(prose)
    .filter((s) => ADVICE.test(s))
    .slice(0, max);
}

export interface SumCheck {
  text: string;
  stated: number;
  expected: number;
}

const num = (s: string) => Number(s.replace(/[£$€,\s]/g, ''));
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.02);
const PER: Record<string, number> = { week: 52, month: 12, year: 1 };
const SPAN: Record<string, number> = { week: 1 / 52, weeks: 1 / 52, month: 1 / 12, months: 1 / 12, year: 1, years: 1 };

/**
 * Worked examples whose sums do not add up. Recognises the shapes worked examples use:
 * "10% of £2,000 is £200", "£150 × 12 = £1,800", "£200 a month for 5 years comes to £12,000",
 * "£1,000 at 5% a year for 10 years grows to £1,629". Anything else is left alone.
 */
export function checkSums(text: string): SumCheck[] {
  const out: SumCheck[] = [];
  const M = String.raw`[£$€]?\s?\d[\d,]*(?:\.\d+)?`;
  for (const s of text.split(/(?<=[.!?])\s+|\n+/)) {
    let m: RegExpMatchArray | null;
    if ((m = s.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s?(?:%|per ?cent) of (${M}) (?:is|=|comes to|gives you|equals) (${M})`, 'i')))) {
      const expected = (Number(m[1]) / 100) * num(m[2]);
      if (!close(num(m[3]), expected)) out.push({ text: s.trim(), stated: num(m[3]), expected: Math.round(expected * 100) / 100 });
      continue;
    }
    if ((m = s.match(new RegExp(String.raw`(${M})\s?(?:×|x|\*|times)\s?(${M})\s?(?:=|is|comes to|makes) (${M})`, 'i')))) {
      const expected = num(m[1]) * num(m[2]);
      if (!close(num(m[3]), expected)) out.push({ text: s.trim(), stated: num(m[3]), expected: Math.round(expected * 100) / 100 });
      continue;
    }
    if ((m = s.match(new RegExp(String.raw`(${M}) at (\d+(?:\.\d+)?)\s?(?:%|per ?cent)(?: a year| per year| annually| interest)?,? (?:for|over) (\d+) years?,?.*?(?:grows to|becomes|is worth|turns into|ends up as|will be) (${M})`, 'i')))) {
      const expected = num(m[1]) * (1 + Number(m[2]) / 100) ** Number(m[3]);
      if (!close(num(m[4]), expected)) out.push({ text: s.trim(), stated: num(m[4]), expected: Math.round(expected) });
      continue;
    }
    if ((m = s.match(new RegExp(String.raw`(${M}) (?:a|per|each|every) (week|month|year),? (?:for|over) (\d+) (weeks?|months?|years?),?.*?(?:comes to|adds up to|is|makes|totals?|=|that's) (${M})`, 'i')))) {
      if (/\d\s?(%|per ?cent)/i.test(s)) continue; // with interest: not simple multiplication
      const expected = num(m[1]) * PER[m[2].toLowerCase()] * Number(m[3]) * SPAN[m[4].toLowerCase()];
      if (!close(num(m[5]), expected)) out.push({ text: s.trim(), stated: num(m[5]), expected: Math.round(expected * 100) / 100 });
    }
  }
  return out;
}

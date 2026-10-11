import type { Project } from './project.js';
import { uniq } from './util.js';

/**
 * Dictation, the parts that need no model: the book's personal dictionary, a deterministic
 * clean-up (used offline, as the fallback, and as the verbatim floor), and the guardrails that
 * decide whether a model's clean-up may replace what was said.
 */

export type CleanupLevel = 'verbatim' | 'light' | 'polished';

/**
 * Names the recogniser and the clean-up must spell right: the book's own word list first, then
 * the people and places in focus (a scene's cast and setting), then everyone else.
 */
export function dictionaryFor(p: Project, focus: { scene?: string | null } = {}): string[] {
  const card = focus.scene ? p.scenes.get(focus.scene)?.card : undefined;
  const people = [...p.characters.values()];
  const inScene = new Set(card ? [card.pov, ...card.characters] : []);
  const names = (c: (typeof people)[number]) => [c.bio.name, ...c.bio.aliases];
  const places = p.locations.locations;
  return uniq(
    [
      ...p.book.voice.dictionary,
      ...people.filter((c) => inScene.has(c.id)).flatMap(names),
      ...places.filter((l) => l.id === card?.location).map((l) => l.name),
      ...people.filter((c) => !inScene.has(c.id)).flatMap(names),
      ...places.filter((l) => l.id !== card?.location).map((l) => l.name),
    ]
      .map((w) => w.trim())
      .filter(Boolean),
  );
}

/** A Whisper-style prompt: the spellings, in a sentence, short enough for the prompt window (~224 tokens). */
export function recognitionPrompt(words: string[], maxChars = 600): string {
  const out: string[] = [];
  let len = 0;
  for (const w of words) {
    if (len + w.length + 2 > maxChars) break;
    out.push(w);
    len += w.length + 2;
  }
  return out.length ? `Names: ${out.join(', ')}.` : '';
}

const FILLERS = /(^|[\s,.;:!?])(?:u+m+|u+h+|e+r+m+|e+r+|a+h+|h+m+|mm+)(?=[\s,.;:!?]|$)[,]?/gi;
/** Self-corrections that cancel what came just before them ("Tuesday, no wait, Wednesday"). */
const BACKTRACK = /\b(?:no wait|no,? sorry|sorry,? I mean|scratch that|let me start again|actually no)\b[,.]?\s*/i;

/**
 * The deterministic clean-up. Verbatim only fixes spacing and the join with the text before the
 * cursor; light also drops fillers, stutters and self-corrections, and sentence-cases. Nothing
 * is ever added except punctuation and capitals.
 */
export function cleanDictation(raw: string, opts: { level?: CleanupLevel; before?: string; names?: string[] } = {}): string {
  const level = opts.level ?? 'light';
  let t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (level !== 'verbatim') {
    t = t.replace(FILLERS, (_m, lead: string) => (lead.trim() ? lead : ' '));
    // "I I think" → "I think"; "the the" → "the".
    t = t.replace(/\b(\w+)(?:,?\s+\1\b)+/gi, '$1');
    // A self-correction cancels what came just before it. "Scratch that" takes back the whole
    // clause; "no wait" and friends swap out as many words as the correction has
    // ("on Tuesday, no wait, Wednesday" → "on Wednesday").
    for (let guard = 0; guard < 5; guard++) {
      const m = t.match(BACKTRACK);
      if (!m || m.index === undefined) break;
      const head = t.slice(0, m.index).replace(/[.!?,;:\s]+$/, '');
      const tail = t.slice(m.index + m[0].length);
      const clauseStart = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), ...['.', '!', '?'].map((c) => head.lastIndexOf(c))) + 1;
      const clause = head.slice(clauseStart).trim().split(/\s+/).filter(Boolean);
      const correction = (tail.match(/^[^,.;:!?]*/)?.[0] ?? '').trim().split(/\s+/).filter(Boolean);
      const whole = /scratch that|start again/i.test(m[0]);
      const drop = whole ? clause.length : Math.min(clause.length, Math.max(1, correction.length));
      const kept = [head.slice(0, clauseStart).trim(), clause.slice(0, clause.length - drop).join(' ')].filter(Boolean).join(' ');
      t = `${kept} ${tail}`.trim();
    }
    t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/([,.;:!?])(?=\w)/g, '$1 ').replace(/,{2,}/g, ',').replace(/^[,.;:]\s*/, '').replace(/\s{2,}/g, ' ').trim();
    // Sentence case inside the dictation.
    t = t.replace(/([.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
    t = t.replace(/\bi\b/g, 'I');
  }
  return joinToCursor(t, opts.before ?? '', opts.names ?? []);
}

/** Fit dictated text to where it lands: a capital after a full stop, lower case mid-sentence, a space between. */
export function joinToCursor(text: string, before: string, names: string[] = []): string {
  if (!text) return '';
  const prev = before.replace(/[ \t]+$/, '');
  const midSentence = /[\p{L}\p{N},;:—–-]$/u.test(prev);
  const firstWord = text.match(/^[\p{L}']+/u)?.[0] ?? '';
  const keepCase = firstWord === 'I' || /^I'/.test(firstWord) || names.some((n) => n.split(/\s+/)[0] === firstWord) || /^[A-Z]{2,}$/.test(firstWord);
  let out = text;
  if (midSentence && !keepCase) out = out.charAt(0).toLowerCase() + out.slice(1);
  else if (!midSentence) out = out.charAt(0).toUpperCase() + out.slice(1);
  const needsSpace = before.length > 0 && !/\s$/.test(before) && !/^[,.;:!?]/.test(out);
  return (needsSpace ? ' ' : '') + out;
}

const STOP = new Set(
  'about above after again also always among another around because before being below between both cannot could doing down during each every from further have having here hers herself himself into itself just more most myself never once only other ought ours ourselves over same should some such than that their theirs them themselves then there these they this those through under until very were what when where which while whom whose with would your yours yourself yourselves'.split(' '),
);
const contentWords = (t: string) => (t.toLowerCase().match(/[\p{L}']{4,}/gu) ?? []).filter((w) => !STOP.has(w));

export interface CleanupCheck {
  ok: boolean;
  /** Why the clean-up was refused, for the author ("added the name 'Margaret'"). */
  flags: string[];
}

/**
 * May the model's clean-up replace what was said? It must not bring in a name the speaker never
 * said (or the dictionary does not hold), and must keep most of the speaker's words: tidying
 * removes fillers and false starts, it does not rewrite.
 */
export function checkCleanup(raw: string, cleaned: string, opts: { names?: string[]; level?: CleanupLevel } = {}): CleanupCheck {
  const flags: string[] = [];
  const rawLower = raw.toLowerCase();
  const known = new Set((opts.names ?? []).flatMap((n) => n.toLowerCase().split(/\s+/)));
  const sentences = cleaned.split(/(?<=[.!?]["”’']?)\s+/);
  const introduced = new Set<string>();
  for (const s of sentences) {
    const words = s.match(/[\p{L}'’]+/gu) ?? [];
    words.forEach((w, i) => {
      if (i === 0 || !/^\p{Lu}/u.test(w) || w === 'I' || /^I['’]/.test(w)) return;
      const lw = w.toLowerCase().replace(/['’]s$/, '');
      if (!rawLower.includes(lw) && !known.has(lw)) introduced.add(w);
    });
  }
  if (introduced.size) flags.push(`added ${[...introduced].map((w) => `“${w}”`).join(', ')}, which you did not say`);
  const said = new Set(contentWords(raw));
  const kept = contentWords(cleaned);
  if (said.size >= 4) {
    const added = kept.filter((w) => !said.has(w)).length / Math.max(1, kept.length);
    const keptSet = new Set(kept);
    const lost = [...said].filter((w) => !keptSet.has(w)).length / said.size;
    const limit = opts.level === 'polished' ? { added: 0.45, lost: 0.5 } : { added: 0.2, lost: 0.35 };
    if (added > limit.added) flags.push('brought in words you did not use');
    if (lost > limit.lost) flags.push('dropped too much of what you said');
  }
  return { ok: flags.length === 0, flags };
}

/** A WAV file's duration in seconds, or null when the buffer is not a PCM WAV. */
export function wavSeconds(buf: Uint8Array): number | null {
  if (buf.length < 44) return null;
  const text = (a: number, b: number) => String.fromCharCode(...buf.subarray(a, b));
  if (text(0, 4) !== 'RIFF' || text(8, 12) !== 'WAVE') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = text(off, off + 4);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') byteRate = view.getUint32(off + 16, true);
    if (id === 'data') return byteRate ? Math.min(size, buf.length - off - 8) / byteRate : null;
    off += 8 + size + (size % 2);
  }
  return null;
}

/** Text segmentation shared by dialogue attribution, style checks and fingerprints. */

const OPEN = new Set(["'", '‘', '"', '“']);
const CLOSE = new Set(["'", '’', '"', '”']);
const BEFORE_OPEN = /[\s(—–-]/;
const AFTER_CLOSE = /[\s,.;:!?—–)]/;

/** Quoted spans in a paragraph, telling apostrophes (don't, Mara's) from closing quotes. */
export function quotedSpans(para: string): { start: number; end: number; text: string }[] {
  const spans: { start: number; end: number; text: string }[] = [];
  let open = -1;
  for (let i = 0; i < para.length; i++) {
    const ch = para[i];
    const prev = i > 0 ? para[i - 1] : ' ';
    const next = i + 1 < para.length ? para[i + 1] : ' ';
    if (open < 0) {
      if (OPEN.has(ch) && BEFORE_OPEN.test(prev) && !/\s/.test(next)) open = i;
    } else if (CLOSE.has(ch) && !/\s/.test(prev) && AFTER_CLOSE.test(next)) {
      spans.push({ start: open, end: i + 1, text: para.slice(open + 1, i) });
      open = -1;
    }
  }
  return spans;
}


export interface Segment {
  start: number;
  end: number;
  text: string;
  dialogue: boolean;
}

/** Split a paragraph into narration and dialogue segments. */
export function segments(para: string, offset = 0): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const s of quotedSpans(para)) {
    if (s.start > cursor) out.push({ start: offset + cursor, end: offset + s.start, text: para.slice(cursor, s.start), dialogue: false });
    out.push({ start: offset + s.start, end: offset + s.end, text: para.slice(s.start, s.end), dialogue: true });
    cursor = s.end;
  }
  if (cursor < para.length) out.push({ start: offset + cursor, end: offset + para.length, text: para.slice(cursor), dialogue: false });
  return out;
}

export interface Paragraph {
  start: number;
  end: number;
  text: string;
}

export function paragraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const re = /\n\s*\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > start) out.push({ start, end: m.index, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  if (start < text.length) out.push({ start, end: text.length, text: text.slice(start) });
  return out.filter((p) => p.text.trim());
}

export interface Sentence {
  start: number;
  end: number;
  text: string;
  words: number;
}

const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|vs|etc|e\.g|i\.e)\.$/;

/** Sentences across a text, with offsets. Dialogue inside a sentence stays part of it. */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  for (const p of paragraphs(text)) {
    let start = 0;
    const t = p.text;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;
      let j = i + 1;
      while (j < t.length && /['’"”)\]]/.test(t[j])) j++;
      if (j < t.length && !/\s/.test(t[j])) continue;
      if (ABBREV.test(t.slice(Math.max(0, i - 5), i + 1))) continue;
      const nextStart = t.slice(j).search(/\S/);
      if (nextStart >= 0 && /[a-z]/.test(t[j + nextStart])) continue; // 'Yes,' he said. / ...dialogue continues
      const seg = t.slice(start, j);
      if (seg.trim()) out.push({ start: p.start + start, end: p.start + j, text: seg.trim(), words: countWords(seg) });
      start = j;
    }
    const rest = t.slice(start);
    if (rest.trim()) out.push({ start: p.start + start, end: p.end, text: rest.trim(), words: countWords(rest) });
  }
  return out;
}

export function countWords(s: string): number {
  return (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
}

/** Narration only (dialogue and *italic thoughts* removed), keeping offsets via spaces. */
export function narrationMask(text: string): string {
  let out = '';
  for (const p of paragraphs(text)) {
    out = out.padEnd(p.start, ' ');
    for (const s of segments(p.text, p.start)) out = out.padEnd(s.start, ' ') + (s.dialogue ? ' '.repeat(s.text.length) : s.text);
  }
  out = out.padEnd(text.length, ' ');
  return out.replace(/\*[^*\n]+\*/g, (m) => ' '.repeat(m.length));
}

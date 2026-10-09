/**
 * style/banned-patterns.md format, one pattern per list item:
 *
 *   - delve                      plain phrase, case-insensitive, whole words
 *   - "a testament to"           quoted phrase
 *   - /\bnot (just|only) \w+, but\b/i   regex
 *   - em-dash: /—/g  (max 2 per scene)   optional label and per-scene allowance
 *
 * Lines that are not list items are ignored, so the file can carry headings and notes.
 */
export interface BannedPattern {
  label: string;
  source: string;
  regex: RegExp;
  /** Matches allowed per scene before it is flagged. */
  allowance: number;
}

export interface BannedHit {
  label: string;
  match: string;
  index: number;
  line: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseBannedPatterns(text: string): BannedPattern[] {
  const out: BannedPattern[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const m = rawLine.match(/^\s*[-*]\s+(.*)$/);
    if (!m) continue;
    let item = m[1].trim();
    if (!item) continue;
    let allowance = 0;
    const allow = item.match(/\(max\s+(\d+)(?:\s+per\s+scene)?\)\s*$/i);
    if (allow) {
      allowance = Number(allow[1]);
      item = item.slice(0, allow.index).trim();
    }
    let label = '';
    const labelled = item.match(/^([\w\s-]+):\s+(\/.*\/[a-z]*|".*")$/);
    if (labelled) {
      label = labelled[1].trim();
      item = labelled[2];
    }
    let regex: RegExp;
    const re = item.match(/^\/(.*)\/([a-z]*)$/);
    if (re) {
      const flags = new Set(re[2].split(''));
      flags.add('g');
      try {
        regex = new RegExp(re[1], [...flags].join(''));
      } catch (e) {
        throw new Error(`invalid regex in banned patterns: ${item} (${(e as Error).message})`);
      }
    } else {
      const phrase = item.replace(/^"(.*)"$/, '$1').trim();
      const start = /^\w/.test(phrase) ? '\\b' : '';
      const end = /\w$/.test(phrase) ? '\\b' : '';
      regex = new RegExp(`${start}${escapeRe(phrase).replace(/\s+/g, '\\s+')}${end}`, 'gi');
    }
    out.push({ label: label || item.replace(/^"(.*)"$/, '$1'), source: item, regex, allowance });
  }
  return out;
}

/** Mechanical, no model call. Returns hits beyond each pattern's allowance. */
export function findBannedPatterns(text: string, patterns: BannedPattern[]): BannedHit[] {
  const hits: BannedHit[] = [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (idx: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  for (const p of patterns) {
    const found: BannedHit[] = [];
    p.regex.lastIndex = 0;
    for (const m of text.matchAll(p.regex)) {
      found.push({ label: p.label, match: m[0], index: m.index ?? 0, line: lineOf(m.index ?? 0) });
      if (m[0] === '') break;
    }
    if (found.length > p.allowance) hits.push(...found.slice(p.allowance));
  }
  return hits.sort((a, b) => a.index - b.index);
}

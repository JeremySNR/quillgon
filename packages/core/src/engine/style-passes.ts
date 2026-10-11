import type { AgentSuite, SpanEdit, VoiceFlag } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import { dialogue } from '../context.js';
import { findBannedPatterns, type BannedHit } from '../style.js';
import { applyFixes, checkStyle, styleCheckOptions, type StyleViolation } from '../style-check.js';
import { styleRules } from '../style-sheet.js';
import { judgeBothWays } from './judge.js';
import { findTells } from '../tells.js';
import { stem } from '../life.js';

export interface StylePassReport {
  voiceFlags: VoiceFlag[];
  bannedBefore: BannedHit[];
  bannedAfter: BannedHit[];
  /** Deterministic fixes applied (spelling, preferred words, dialogue tags). */
  autoFixes: number;
  rounds: { edits: number; applied: number; enforcedBefore: number; enforcedAfter: number; kept: boolean; why: string }[];
  /** What is still wrong after repair; shown to the author, never hidden. */
  remaining: StyleViolation[];
  enforcedBefore: number;
  enforcedAfter: number;
  guidedAfter: number;
  /** Strong AI-writing habits before and after the passes. */
  tellsBefore: number;
  tellsAfter: number;
  /** True books: edits refused because they would add or change what the author said. */
  refused: { find: string; replace: string; why: string }[];
  /** True books: places the line editor wanted more specific; questions for the author, not edits. */
  asks: { quote: string; text: string }[];
}

/** What a true book's line editor must not touch or add to. */
export interface TruthGuard {
  /** Words that were said: never edited. */
  verbatim: string[];
  /** Everything the author said: a replacement may not bring in content words from anywhere else. */
  material: string[];
}

export type Progress = (stage: string, detail?: string) => void;

/** Apply span edits whose `find` text occurs exactly once; skip the rest. */
export function applySpanEdits(text: string, edits: SpanEdit[]): { text: string; applied: SpanEdit[] } {
  let out = text;
  const applied: SpanEdit[] = [];
  for (const e of edits) {
    const at = out.indexOf(e.find);
    if (at < 0 || out.indexOf(e.find, at + 1) >= 0 || e.find === e.replace) continue;
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
    applied.push(e);
  }
  return { text: out, applied };
}

/**
 * Run after every prose write, in order:
 *  1. voice check: flag drifting lines; the reviser rewrites flagged lines only
 *  2. deterministic fixes: spelling, preferred words, dialogue tags (no model)
 *  3. repair rounds: code finds style violations; the line editor proposes span edits
 *     (LAMP categories + violations). A round is kept only if it removes enforced
 *     violations, or keeps them level and wins a both-ways judge against the original.
 * Extraction is done by the caller once the prose is settled.
 */
export async function runStylePasses(
  store: GraphStore,
  agents: AgentSuite,
  sceneId: string,
  prose: string,
  progress: Progress = () => undefined,
  opts: { repair?: boolean; voice?: boolean; truth?: TruthGuard } = {},
): Promise<{ prose: string; report: StylePassReport }> {
  const p = store.project;
  const card = store.scene(sceneId).card;
  const sheet = p.style.sheet;
  const checkOpts = styleCheckOptions(p);
  const check = (t: string) => checkStyle(t, sheet, checkOpts);
  const strongTells = (t: string) => (sheet.tells === 'off' ? 0 : findTells(t, { samples: checkOpts.samples, kind: checkOpts.kind, allow: sheet.allow }).filter((x) => x.strength === 'strong').length);
  const tellsBefore = strongTells(prose);
  const refused: StylePassReport['refused'] = [];
  const asks: StylePassReport['asks'] = [];
  let text = prose;

  progress('voice', 'Checking each character against their voice sheet');
  const lines = (opts.voice === false ? [] : dialogue(p, sceneId, text))
    .filter((l) => l.character)
    .map((l) => ({ character: l.character!, line: l.line }));
  let voiceFlags: VoiceFlag[] = [];
  if (lines.length) {
    const voices = card.characters
      .filter((c) => p.characters.has(c))
      .map((c) => ({ character: c, name: p.characters.get(c)!.bio.name, voice: p.characters.get(c)!.voice }));
    voiceFlags = (await agents.voice({ scene: sceneId, lines, voices })).flags.filter((f) => text.includes(f.line));
    if (voiceFlags.length) {
      progress('voice', `Revising ${voiceFlags.length} line${voiceFlags.length === 1 ? '' : 's'}`);
      text = (await agents.reviseLines({ prose: text, flags: voiceFlags.map((f) => ({ text: f.line, reason: f.reason, suggestion: f.suggestion })) })).prose;
    }
  }

  progress('banned', 'Checking every word against the style sheet');
  const bannedBefore = findBannedPatterns(text, p.style.banned);
  const first = check(text);
  const fixed = applyFixes(text, first.violations);
  text = fixed.text;

  const rounds: StylePassReport['rounds'] = [];
  if (opts.repair !== false) {
    for (let round = 1; round <= Math.max(1, sheet.repair_passes); round++) {
      const before = check(text);
      progress('humanise', `Line edit, round ${round}`);
      const out = await agents.humanise({
        prose: text,
        skill: '',
        banned_hits: findBannedPatterns(text, p.style.banned).map((h) => ({ text: h.match, rule: h.label })),
        violations: before.violations.filter((v) => v.text).slice(0, 40).map((v) => ({ rule: v.rule, text: v.text, message: v.message })),
        style_rules: styleRules(p),
        style_samples: p.style.samples.slice(0, 4000),
        mode: opts.truth ? 'true' : 'fiction',
      });
      const vetted = vetEdits(out.edits, text, opts.truth, (t) => strongTells(t));
      refused.push(...vetted.refused);
      for (const a of vetted.asks) if (!asks.some((x) => x.quote === a.quote)) asks.push(a);
      const candidate = applySpanEdits(text, vetted.edits);
      if (!candidate.applied.length) {
        rounds.push({ edits: out.edits.length, applied: 0, enforcedBefore: before.enforced, enforcedAfter: before.enforced, kept: false, why: 'nothing to change' });
        break;
      }
      const after = check(candidate.text);
      let kept = false;
      let why = '';
      if (after.enforced < before.enforced) {
        kept = true;
        why = `fixed ${before.enforced - after.enforced} enforced issue(s)`;
      } else if (after.enforced === before.enforced) {
        progress('judge', 'Judging the edit against the original, both ways');
        const verdict = await judgeBothWays(agents, {
          task: 'Two versions of the same scene. Which is better written, closer to the reference voice, and free of AI-writing habits, without changing what happens?',
          criteria: ['Same events and facts', 'Closer to the reference voice', 'Fewer clichés, less exposition, less purple prose', 'Specific rather than generic'],
          a: text,
          b: candidate.text,
          reference: p.style.samples.slice(0, 3000),
        });
        kept = verdict.winner === 'b';
        why = kept ? 'judge preferred the edit both ways' : verdict.winner === 'tie' ? 'judge split: kept the original' : 'judge preferred the original';
      } else {
        why = 'the edit introduced new style violations';
      }
      rounds.push({ edits: out.edits.length, applied: candidate.applied.length, enforcedBefore: before.enforced, enforcedAfter: kept ? after.enforced : before.enforced, kept, why });
      if (!kept) break;
      text = candidate.text;
      if (after.violations.length === 0) break;
    }
  }

  const final = check(text);
  return {
    prose: text.trim(),
    report: {
      voiceFlags,
      bannedBefore,
      bannedAfter: findBannedPatterns(text, p.style.banned),
      autoFixes: fixed.applied,
      rounds,
      remaining: final.violations,
      enforcedBefore: first.enforced,
      enforcedAfter: final.enforced,
      guidedAfter: final.guided,
      tellsBefore,
      tellsAfter: strongTells(text),
      refused,
      asks,
    },
  };
}

const CONTENT = /[\p{L}'’]{3,}/gu;
const FUNCTION_WORDS = new Set(
  'the and but for nor yet with from into onto over under then than that this these those there their they them was were are has had have not its it’s it\'s his her him she our out who whom what when where which while would could should will can did does done been being very just only even also back down away off again ever still such some any each every both few more most much many own same other another'.split(' '),
);

/**
 * Edits a line editor proposed, checked by code before any is applied. An edit that brings in a
 * new AI habit is dropped. In a true book an edit may only cut or reword: it may not touch the
 * words someone said or a gap left for the author, or add a name, figure or content word that is
 * neither in the passage it replaces nor anywhere in what the author said. A request for more
 * specific detail becomes a question for the author.
 */
export function vetEdits(edits: SpanEdit[], text: string, truth: TruthGuard | undefined, strong: (t: string) => number) {
  const kept: SpanEdit[] = [];
  const refusedOut: { find: string; replace: string; why: string }[] = [];
  const asksOut: { quote: string; text: string }[] = [];
  const vocab = truth ? new Set(truth.material.join(' ').match(CONTENT)?.map((w) => stem(w)) ?? []) : null;
  for (const e of edits) {
    if (strong(e.replace) > strong(e.find)) {
      refusedOut.push({ find: e.find, replace: e.replace, why: 'it adds an AI-writing habit' });
      continue;
    }
    if (truth) {
      const at = text.indexOf(e.find);
      const span = at < 0 ? e.find : text.slice(Math.max(0, at - 1), at + e.find.length + 1);
      if (truth.verbatim.some((q) => q && (span.includes(q) || q.includes(e.find) || (at >= 0 && overlaps(text, at, e.find.length, q))))) {
        refusedOut.push({ find: e.find, replace: e.replace, why: 'it changes words someone said' });
        continue;
      }
      if (/\[TK:/.test(e.find) || /\[TK:/.test(e.replace)) {
        refusedOut.push({ find: e.find, replace: e.replace, why: 'gaps are for the author to fill' });
        continue;
      }
      if (e.category === 'lack-of-specificity') {
        asksOut.push({ quote: e.find, text: e.reason ? `This could be more particular: ${e.reason}` : 'This is general. Can you remember one particular detail here?' });
        continue;
      }
      const before = new Set((e.find.match(CONTENT) ?? []).map((w) => stem(w)));
      const added = (e.replace.match(CONTENT) ?? []).filter((w) => !FUNCTION_WORDS.has(w.toLowerCase()) && !before.has(stem(w)) && !vocab!.has(stem(w)));
      const numbers = (e.replace.match(/\d[\d,.]*/g) ?? []).filter((n) => !e.find.includes(n));
      if (numbers.length || added.length > 1 || added.some((w) => /^[A-Z]/.test(w))) {
        refusedOut.push({ find: e.find, replace: e.replace, why: `it adds what you did not say (${[...numbers, ...added].slice(0, 3).join(', ')})` });
        continue;
      }
    }
    kept.push(e);
  }
  return { edits: kept, refused: refusedOut, asks: asksOut };
}

/** Does the span [at, at+len) overlap any occurrence of q in text? */
function overlaps(text: string, at: number, len: number, q: string): boolean {
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) if (i < at + len && at < i + q.length) return true;
  return false;
}

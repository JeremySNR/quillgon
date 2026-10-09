import type { AgentSuite, SpanEdit, VoiceFlag } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import { dialogue } from '../context.js';
import { findBannedPatterns, type BannedHit } from '../style.js';
import { applyFixes, checkStyle, type StyleViolation } from '../style-check.js';
import { styleRules } from '../style-sheet.js';
import { judgeBothWays } from './judge.js';

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
  opts: { repair?: boolean } = {},
): Promise<{ prose: string; report: StylePassReport }> {
  const p = store.project;
  const card = store.scene(sceneId).card;
  const sheet = p.style.sheet;
  const check = (t: string) => checkStyle(t, sheet, { book: p.book, banned: p.style.banned });
  let text = prose;

  progress('voice', 'Checking each character against their voice sheet');
  const lines = dialogue(p, sceneId, text)
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
      });
      const candidate = applySpanEdits(text, out.edits);
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
    },
  };
}

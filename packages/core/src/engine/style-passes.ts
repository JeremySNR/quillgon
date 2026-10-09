import type { AgentSuite, VoiceFlag } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import { dialogue } from '../context.js';
import { findBannedPatterns, type BannedHit } from '../style.js';

export interface StyleReport {
  voiceFlags: VoiceFlag[];
  bannedBefore: BannedHit[];
  bannedAfter: BannedHit[];
  humanised: boolean;
}

export type Progress = (stage: string, detail?: string) => void;

/**
 * Run after every prose write, in order:
 *  1. voice check — flag drifting lines; the reviser rewrites flagged lines only
 *  2. banned patterns — mechanical, no model call
 *  3. humaniser — wording only, never events or facts (also removes the banned hits)
 * Extraction (pass 4) is done by the caller once the final prose is settled.
 */
export async function runStylePasses(
  store: GraphStore,
  agents: AgentSuite,
  sceneId: string,
  prose: string,
  progress: Progress = () => undefined,
  opts: { humanise?: boolean } = {},
): Promise<{ prose: string; report: StyleReport }> {
  const p = store.project;
  const card = store.scene(sceneId).card;
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

  progress('banned', 'Matching banned patterns');
  const bannedBefore = findBannedPatterns(text, p.style.banned);

  let humanised = false;
  if (opts.humanise !== false) {
    progress('humanise', 'Humaniser pass (wording only)');
    text = (await agents.humanise({ prose: text, skill: '', banned_hits: bannedBefore.map((h) => ({ text: h.match, rule: h.label })) })).prose;
    humanised = true;
  }
  const bannedAfter = findBannedPatterns(text, p.style.banned);
  return { prose: text.trim(), report: { voiceFlags, bannedBefore, bannedAfter, humanised } };
}

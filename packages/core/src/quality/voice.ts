import type { Project } from '../project.js';
import { sceneOrder } from '../project.js';
import type { GraphStore } from '../store.js';
import { dialogue } from '../context.js';
import { cosine, LocalEmbedder, tokens } from '../embed.js';
import { findBannedPatterns } from '../style.js';
import { timestamp } from '../util.js';

export interface VoiceReport {
  ran_at: string;
  repeated_phrases: { phrase: string; count: number; scenes: string[] }[];
  overused_openers: { opener: string; count: number; share: number }[];
  similar_voices: { a: string; b: string; similarity: number; lines: number }[];
  banned: { scene: string; label: string; match: string; line: number }[];
  warnings: number;
}

/** Voice and repetition across the whole book. Mechanical: no model calls. */
export function voiceReport(p: Project, opts: { ngram?: number; minRepeats?: number; similarity?: number } = {}): VoiceReport {
  const n = opts.ngram ?? 4;
  const minRepeats = opts.minRepeats ?? 3;
  const order = sceneOrder(p).filter((s) => p.scenes.get(s)?.prose);

  // Repeated distinctive phrases: n-grams with at least two content words.
  const grams = new Map<string, { count: number; scenes: Set<string> }>();
  for (const sid of order) {
    const narration = p.scenes.get(sid)!.prose!.body;
    const words = narration.toLowerCase().replace(/[‘’]/g, "'").match(/[a-z']+/g) ?? [];
    for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n);
      if (tokens(g.join(' ')).length < 2) continue;
      const k = g.join(' ');
      const e = grams.get(k) ?? { count: 0, scenes: new Set<string>() };
      e.count++;
      e.scenes.add(sid);
      grams.set(k, e);
    }
  }
  const repeated_phrases = [...grams.entries()]
    .filter(([, v]) => v.count >= minRepeats && v.scenes.size >= 2)
    .map(([phrase, v]) => ({ phrase, count: v.count, scenes: [...v.scenes] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  // Overused sentence openers (first two words of narrative sentences).
  const openers = new Map<string, number>();
  let sentences = 0;
  for (const sid of order) {
    const body = p.scenes.get(sid)!.prose!.body.replace(/['‘"“][^'’"”]*['’"”]/g, ' ');
    for (const s of body.split(/(?<=[.!?])\s+/)) {
      const w = s.trim().match(/^[A-Za-z']+\s+[A-Za-z']+/)?.[0]?.toLowerCase();
      if (!w) continue;
      sentences++;
      openers.set(w, (openers.get(w) ?? 0) + 1);
    }
  }
  const overused_openers = [...openers.entries()]
    .map(([opener, count]) => ({ opener, count, share: sentences ? count / sentences : 0 }))
    .filter((o) => o.count >= 5 && o.share >= 0.03)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Characters whose dialogue is indistinguishable.
  const embedder = new LocalEmbedder(512);
  const byChar = new Map<string, string[]>();
  for (const sid of order) {
    for (const l of dialogue(p, sid, p.scenes.get(sid)!.prose!.body)) {
      if (!l.character) continue;
      byChar.set(l.character, [...(byChar.get(l.character) ?? []), l.line]);
    }
  }
  const vecs = [...byChar.entries()].filter(([, lines]) => lines.length >= 8).map(([c, lines]) => ({ c, lines: lines.length, v: embedder.embedOne(lines.join(' ')) }));
  const similar_voices: VoiceReport['similar_voices'] = [];
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++) {
      const sim = cosine(vecs[i].v, vecs[j].v);
      if (sim >= (opts.similarity ?? 0.6)) similar_voices.push({ a: vecs[i].c, b: vecs[j].c, similarity: Math.round(sim * 100) / 100, lines: Math.min(vecs[i].lines, vecs[j].lines) });
    }

  const banned = order.flatMap((sid) => findBannedPatterns(p.scenes.get(sid)!.prose!.body, p.style.banned).map((h) => ({ scene: sid, label: h.label, match: h.match, line: h.line })));
  const warnings = repeated_phrases.length + overused_openers.length + similar_voices.length + banned.length;
  return { ran_at: new Date().toISOString(), repeated_phrases, overused_openers, similar_voices, banned, warnings };
}

export function runVoiceReport(store: GraphStore): VoiceReport {
  const r = voiceReport(store.project);
  store.writeReport('voice-latest.json', JSON.stringify(r, null, 2));
  store.writeReport(
    `voice-${timestamp()}.md`,
    [
      `# Voice and repetition — ${r.ran_at}`,
      '',
      '## Repeated phrases',
      ...(r.repeated_phrases.length ? r.repeated_phrases.map((x) => `- "${x.phrase}" ×${x.count} (${x.scenes.join(', ')})`) : ['None.']),
      '',
      '## Overused sentence openers',
      ...(r.overused_openers.length ? r.overused_openers.map((x) => `- "${x.opener}…" ×${x.count} (${Math.round(x.share * 100)}%)`) : ['None.']),
      '',
      '## Indistinguishable voices',
      ...(r.similar_voices.length ? r.similar_voices.map((x) => `- ${x.a} / ${x.b}: ${x.similarity}`) : ['None.']),
      '',
      '## Banned patterns',
      ...(r.banned.length ? r.banned.map((x) => `- ${x.scene} line ${x.line}: ${x.label} ("${x.match}")`) : ['None.']),
    ].join('\n') + '\n',
  );
  store.updateBook({ health: { ...store.book.health, voice_warnings: r.warnings } });
  return r;
}

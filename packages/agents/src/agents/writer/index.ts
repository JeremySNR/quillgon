import { WriterInput, WriterOutput } from '@novel/core';
import { defineAgent } from '../define.js';

export const writer = defineAgent({
  name: 'writer',
  task: 'write',
  input: WriterInput,
  output: WriterOutput,
  maxTokens: 32000,
  render: (i) => {
    const c = i.card;
    const parts: string[] = [];
    parts.push(`# Write scene ${c.id}: ${c.title}`);
    parts.push(`Book: ${i.book.title}. Point of view: ${i.book.pov_mode}, ${i.book.tense} tense. Target: about ${i.target_words} words.`);
    parts.push(
      [
        '## Scene card',
        `- POV: ${c.pov}`,
        `- Where: ${c.location}`,
        `- When: ${c.time}`,
        `- Purpose: ${c.purpose}`,
        `- Characters present: ${c.characters.join(', ')}`,
        `- Reveals (exactly these): ${c.reveals.join(', ') || 'nothing new'}`,
        `- Who speaks of what: ${c.mentions.map((m) => `${m.character} → ${m.fact}`).join('; ') || '—'}`,
        `- Outcome: ${c.outcome}`,
        '',
        'Beats, in order:',
        ...c.beats.map((b, n) => `${n + 1}. ${b}`),
      ].join('\n'),
    );
    if (i.facts.length) parts.push(`## Facts in play\n${i.facts.map((f) => `- \`${f.id}\`: ${f.statement}`).join('\n')}`);
    parts.push(
      `## Where everyone stands as the scene opens\n${i.states
        .map((s) =>
          s.snapshot
            ? `- **${s.name}** knows: ${s.snapshot.knows.join(', ') || 'nothing yet'}; wants: ${s.snapshot.wants || '—'}; feels: ${Object.entries(s.snapshot.feels).map(([k, v]) => `${v} toward ${k}`).join(', ') || '—'}; at: ${s.snapshot.location ?? '—'}`
            : `- **${s.name}**: first appearance`,
        )
        .join('\n')}`,
    );
    parts.push(
      `## Voices\n${i.voices
        .map((v) => `### ${v.name}\nPatterns: ${v.voice.speech_patterns.join('; ')}\nSample lines: ${v.voice.sample_lines.map((l) => `“${l}”`).join(' ')}\nAvoid: ${v.voice.avoid.join('; ')}\n${v.voice.notes}`)
        .join('\n\n')}`,
    );
    if (i.threads.length) parts.push(`## Threads this scene touches\n${i.threads.map((t) => `- ${t.title || t.id} (${t.kind}): ${t.description}`).join('\n')}`);
    if (i.recent_cards.length) parts.push(`## The scenes just before (cards)\n${i.recent_cards.map((r) => `- ${r.id} ${r.title}: ${r.outcome}`).join('\n')}`);
    if (i.previous_prose) parts.push(`## The previous scene, in full\n${i.previous_prose}`);
    const ob = i.obligations;
    if (ob.plant.length) parts.push(`## Plant in this scene (setups the book must later pay off)\n${ob.plant.map((o) => `- [${o.kind}] ${o.description}`).join('\n')}`);
    if (ob.pay.length) parts.push(`## Pay off in this scene\n${ob.pay.map((o) => `- [${o.kind}] ${o.description}`).join('\n')}`);
    if (ob.keep_open.length) parts.push(`## Still open (keep alive, do not resolve)\n${ob.keep_open.map((o) => `- ${o.description}`).join('\n')}`);
    if (i.style_rules.length) parts.push(`## Style sheet (checked by code)\n${i.style_rules.map((r) => `- ${r}`).join('\n')}`);
    if (i.style_samples) parts.push(`## Style samples\n${i.style_samples}`);
    if (i.banned_patterns.length) parts.push(`## Banned patterns (never use)\n${i.banned_patterns.map((b) => `- ${b}`).join('\n')}`);
    if (i.similar_scenes.length)
      parts.push(`## Similar scenes elsewhere in the book (do not repeat their images or phrasing)\n${i.similar_scenes.map((s) => `### ${s.id}\n${s.excerpt}`).join('\n\n')}`);
    return parts.join('\n\n');
  },
});

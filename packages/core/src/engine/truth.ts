import type { Project } from '../project.js';
import { usableEvidence } from '../research.js';
import { isGuide } from '../schemas/index.js';
import type { TruthGuard } from './style-passes.js';

/** Everything the author (or someone they asked) said about these stories: the only material a true book may use. */
export function storyMaterial(p: Project, storyIds: string[]): { text: string[]; quotes: string[] } {
  const text: string[] = [];
  const quotes: string[] = [];
  const turn = (ref: { session: string; turn: number } | null) => (ref ? p.sessions.get(ref.session)?.turns[ref.turn] : undefined);
  for (const id of storyIds) {
    const s = p.stories.get(id);
    if (!s) continue;
    text.push(s.title, s.summary, s.place, s.when, s.then, s.now, ...s.details.map((d) => d.text), ...s.versions.map((v) => v.text));
    for (const q of s.quotes) quotes.push(q.text), text.push(q.text);
    for (const x of [...s.details, ...s.quotes]) {
      const t = turn(x.from);
      if (t && !t.off_record) text.push(t.text);
    }
    for (const id2 of s.people) text.push(p.characters.get(id2)?.bio.name ?? '');
    // Answers to margin notes count as things the author said.
    for (const sc of p.scenes.values()) if (sc.card.stories?.includes(id)) for (const n of sc.notes?.notes ?? []) if (n.answer) text.push(n.answer);
  }
  text.push(p.characters.get(p.book.life.narrator ?? '')?.bio.name ?? '');
  return { text: text.filter(Boolean), quotes };
}

/**
 * What a true book's line editor may not change or add to: the words that were said, and the
 * vocabulary of everything the author told us (and, for a guide, the research it may cite).
 */
export function truthGuard(p: Project, storyIds: string[]): TruthGuard {
  const m = storyMaterial(p, storyIds);
  const evidence = isGuide(p.book) ? usableEvidence(p.research).flatMap((e) => [e.claim, e.quote]) : [];
  return { verbatim: m.quotes, material: [...m.text, ...evidence] };
}


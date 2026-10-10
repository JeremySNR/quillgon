import type { Project } from './project.js';
import { sceneOrder, stateAt, stateBefore } from './project.js';
import type { ProjectIndex } from './index-db.js';
import type { WriterInput } from './agents/contracts.js';
import { obligationsForScene } from './obligations.js';
import { styleRules } from './style-sheet.js';
import { BUDGET, clip, storySoFar, wordsPerScene } from './scope.js';

/**
 * Writer context per scene. Deliberately scoped: full-manuscript context makes the
 * writer summarise and hedge; scoped context makes it write.
 */
export function writerContext(p: Project, sceneId: string, index: ProjectIndex | null): WriterInput {
  const order = sceneOrder(p);
  const idx = order.indexOf(sceneId);
  const scene = p.scenes.get(sceneId);
  if (!scene) throw new Error(`unknown scene "${sceneId}"`);
  const card = scene.card;
  const prev = idx > 0 ? p.scenes.get(order[idx - 1]) : null;
  const recent = order.slice(Math.max(0, idx - 3), idx).map((id) => p.scenes.get(id)!.card);
  const states = card.characters.map((c) => ({
    character: c,
    name: p.characters.get(c)?.bio.name ?? c,
    snapshot: stateBefore(p, c, sceneId, order)?.snapshot ?? null,
  }));
  const speaking = new Set([card.pov, ...card.characters]);
  const voices = [...speaking]
    .filter((c) => p.characters.has(c))
    .map((c) => ({ character: c, name: p.characters.get(c)!.bio.name, voice: p.characters.get(c)!.voice }));
  const threads = card.threads_touched.map((t) => p.threads.get(t)).filter((t) => !!t);
  const factIds = new Set([...card.reveals, ...card.mentions.map((m) => m.fact), ...states.flatMap((s) => s.snapshot?.knows ?? [])]);
  const facts = p.factGlossary.facts.filter((f) => factIds.has(f.id));
  const similar = index
    ? index
        .similar(`${card.title}\n${card.purpose}\n${card.beats.join('\n')}`, { exclude: [sceneId, order[idx - 1] ?? ''], limit: 3 })
        .map((r) => p.scenes.get(r.scene))
        .filter((s) => s?.prose)
        .map((s) => ({ id: s!.id, excerpt: excerpt(s!.prose!.body, 900) }))
    : [];
  return {
    intent: p.intent,
    book: { title: p.book.title, pov_mode: p.book.pov_mode, tense: p.book.tense },
    card,
    previous_prose: prev?.prose?.body ?? null,
    story_so_far: storySoFar(p, sceneId),
    recent_cards: recent,
    states,
    voices,
    threads,
    facts,
    style_samples: clip(p.style.samples, BUDGET.styleSamples),
    banned_patterns: p.style.banned.map((b) => b.source),
    similar_scenes: similar,
    target_words: wordsPerScene(p),
    obligations: obligationsForScene(p, sceneId, order),
    style_rules: styleRules(p),
  };
}

function excerpt(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(' ')) + ' …';
}

export interface DialogueLine {
  character: string | null;
  line: string;
  paragraph: number;
}

export { quotedSpans } from './text.js';
import { quotedSpans } from './text.js';

/**
 * Pull dialogue from prose and attribute it to speakers. Heuristic: a character's name
 * or alias outside the quotes in the same paragraph; in two-hander scenes, alternate.
 */
export function dialogue(p: Project, sceneId: string, prose: string): DialogueLine[] {
  const card = p.scenes.get(sceneId)?.card;
  const cast = (card?.characters ?? []).map((id) => {
    const bio = p.characters.get(id)?.bio;
    const names = [bio?.name.split(' ')[0], bio?.name, ...(bio?.aliases ?? [])].filter((x): x is string => !!x);
    return { id, names };
  });
  const out: DialogueLine[] = [];
  let lastSpeaker: string | null = null;
  /** Set by a narrative paragraph that names exactly one character: they usually speak next. */
  let actor: string | null = null;
  const namedIn = (text: string) =>
    cast.filter((c) => c.names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)));
  const paras = prose.split(/\n\s*\n/);
  paras.forEach((para, pi) => {
    const spans = quotedSpans(para);
    const lines = spans.map((s) => s.text.trim()).filter((l) => l.length > 1);
    if (!lines.length) {
      const named = namedIn(para);
      actor = named.length === 1 ? named[0].id : null;
      return;
    }
    let outside = '';
    let cursor = 0;
    for (const s of spans) {
      outside += para.slice(cursor, s.start) + ' ';
      cursor = s.end;
    }
    outside += para.slice(cursor);
    const named = namedIn(outside);
    let speaker: string | null = null;
    if (named.length === 1) speaker = named[0].id;
    else if (named.length > 1) {
      // The name closest to the first quote ("Tom said", "said Tom").
      const firstQuote = spans[0].start;
      let best: { id: string; d: number } | null = null;
      for (const c of named) {
        for (const n of c.names) {
          const i = para.indexOf(n);
          if (i >= 0 && !spans.some((s) => i > s.start && i < s.end)) {
            const d = Math.abs(i - firstQuote);
            if (!best || d < best.d) best = { id: c.id, d };
          }
        }
      }
      speaker = best?.id ?? null;
    } else if (actor) {
      speaker = actor;
    } else if (cast.length === 2 && lastSpeaker) {
      speaker = cast.find((c) => c.id !== lastSpeaker)?.id ?? null;
    }
    for (const l of lines) out.push({ character: speaker, line: l, paragraph: pi });
    if (speaker) lastSpeaker = speaker;
    actor = null;
  });
  return out;
}

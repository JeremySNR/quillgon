import fs from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';
import { LifeFact, type AgentSuite } from './agents/contracts.js';
import type { Engine } from './engine/engine.js';
import { leadingQuestion, touchesOffLimits, unsourced } from './life.js';
import { tellScore } from './tells.js';

/**
 * The ghostwriter's eval: invented lives with hidden facts, a simulated interviewee who reveals
 * them only to good questions, and deterministic scores on what came out and how. Change the
 * ghostwriter prompt, run again, compare.
 */

export const EvalLife = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  narrator: z.string(),
  born: z.string().default(''),
  title: z.string(),
  off_limits: z.array(z.string()).default([]),
  facts: z.array(LifeFact).min(1),
});
export type EvalLife = z.infer<typeof EvalLife>;
export const LifeSet = z.object({ lives: z.array(EvalLife).min(1) });

export function loadLives(file: string): EvalLife[] {
  return LifeSet.parse(YAML.parse(fs.readFileSync(file, 'utf8'))).lives;
}

export interface LifeMetrics {
  id: string;
  turns: number;
  /** Share of the hidden facts that ended up filed in the book (0..1). */
  elicited: number;
  /** Of the deeper facts (anything but the gist), the share drawn out. */
  depth: number;
  /** Questions the code refused (leading or off limits) per ghostwriter turn. */
  refused_rate: number;
  /** Questions actually asked that still suggest a detail (should be 0). */
  leading_asked: number;
  /** Of answers with a surprising fact in them, the share whose next question followed it up. */
  followup_rate: number | null;
  /** Questions that touched an off-limits topic (should be 0). */
  off_limits_asked: number;
  /** Drafted sentences nothing the interviewee said supports, per sentence drafted. */
  invented_rate: number;
  gaps_left: number;
  /** AI writing habits per 1,000 drafted words (tells.ts). */
  ai_habits_per_1k: number;
  notes: number;
  chapters: number;
  words: number;
}

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(ing|ed|es|s)$/, '')));
const hasFact = (text: string, f: LifeFact) => {
  const t = text.toLowerCase();
  const hits = f.keywords.filter((k) => t.includes(k.toLowerCase())).length;
  return hits >= Math.ceil(f.keywords.length / 2);
};

/**
 * Interview a simulated person for `sessions` sessions of `turns` exchanges, shape the book, draft
 * every chapter, and score it. The engine's agents must include an interviewee (the offline
 * suite and the model suite both do).
 */
export async function runLifeEval(engine: Engine, life: EvalLife, opts: { sessions?: number; turns?: number; progress?: (s: string) => void } = {}): Promise<LifeMetrics> {
  const agents: AgentSuite = engine.agents;
  const store = engine.store;
  const sessions = opts.sessions ?? 2;
  const turns = opts.turns ?? 10;
  if (life.off_limits.length) store.saveNotebook({ ...store.project.notebook, off_limits: life.off_limits });
  const told = new Set<string>();
  let asked = 0;
  let leading = 0;
  let offLimits = 0;
  let surprising = 0;
  let followed = 0;
  let refusedBefore = 0;
  const said: string[] = [];
  for (let n = 0; n < sessions; n++) {
    opts.progress?.(`${life.id}: session ${n + 1}`);
    let s = await engine.interviews.start();
    for (let k = 0; k < turns; k++) {
      const q = s.turns[s.turns.length - 1].text;
      asked++;
      if (leadingQuestion(q, said.join(' '))) leading++;
      if (touchesOffLimits(q, life.off_limits)) offLimits++;
      const out = await agents.interviewee({ narrator: life.narrator, born: life.born, facts: life.facts, told: [...told], history: s.turns.slice(-8).map((t) => ({ role: t.role, text: t.text })), question: q });
      out.told.forEach((id) => told.add(id));
      said.push(out.answer);
      s = await engine.interviews.answer(s.id, { text: out.answer });
      const next = s.turns[s.turns.length - 1];
      if (next.technique === 'Open question') refusedBefore++;
      const surprise = life.facts.find((f) => f.surprising && out.told.includes(f.id));
      if (surprise) {
        surprising++;
        const qw = words(next.text);
        if ([...words(surprise.text)].some((w) => qw.has(w) && w.length > 4)) followed++;
      }
    }
    await engine.interviews.end(s.id);
  }
  opts.progress?.(`${life.id}: shaping and drafting`);
  const filed = [
    ...[...store.project.stories.values()].flatMap((st) => [st.title, st.summary, st.then, st.now, ...st.details.map((d) => d.text), ...st.quotes.map((q) => q.text)]),
    ...store.project.timeline.events.map((e) => e.description),
    ...[...store.project.characters.values()].map((c) => c.bio.name),
  ].join(' \n ');
  const elicitedFacts = life.facts.filter((f) => hasFact(filed, f));
  const deep = life.facts.filter((f) => f.tier !== 'gist');
  let chapters = 0;
  let sentences = 0;
  let invented = 0;
  let gaps = 0;
  let notes = 0;
  let wordsDrafted = 0;
  const drafted: string[] = [];
  if (store.project.stories.size) {
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    for (const ch of engine.life.chapters()) {
      if (!engine.life.storiesOf(ch.id).some((x) => !x.sensitive)) continue;
      const ids = await engine.life.draftChapter(ch.id);
      chapters++;
      for (const id of ids) {
        const sc = store.project.scenes.get(id)!;
        const prose = sc.prose?.body ?? '';
        wordsDrafted += prose.split(/\s+/).filter(Boolean).length;
        drafted.push(prose);
        sentences += prose.split(/(?<=[.!?])\s+/).filter((x) => x.split(/\s+/).length >= 4).length;
        invented += unsourced(prose, said, [], 100).length;
        gaps += (prose.match(/\[TK:/g) ?? []).length;
        notes += (sc.notes?.notes ?? []).length;
      }
    }
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    id: life.id,
    turns: asked,
    elicited: round(elicitedFacts.length / life.facts.length),
    depth: round(deep.length ? deep.filter((f) => elicitedFacts.includes(f)).length / deep.length : 1),
    refused_rate: round(refusedBefore / Math.max(1, asked)),
    leading_asked: leading,
    followup_rate: surprising ? round(followed / surprising) : null,
    off_limits_asked: offLimits,
    invented_rate: round(invented / Math.max(1, sentences)),
    gaps_left: gaps,
    ai_habits_per_1k: tellScore(drafted.join('\n\n'), { kind: 'true' }),
    notes,
    chapters,
    words: wordsDrafted,
  };
}

/** Mean of each metric across lives. */
export function lifeSummary(ms: LifeMetrics[]) {
  const mean = (f: (m: LifeMetrics) => number | null) => {
    const xs = ms.map(f).filter((x): x is number => x !== null);
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null;
  };
  return {
    lives: ms.length,
    elicited: mean((m) => m.elicited),
    depth: mean((m) => m.depth),
    refused_rate: mean((m) => m.refused_rate),
    leading_asked: ms.reduce((n, m) => n + m.leading_asked, 0),
    followup_rate: mean((m) => m.followup_rate),
    off_limits_asked: ms.reduce((n, m) => n + m.off_limits_asked, 0),
    invented_rate: mean((m) => m.invented_rate),
    ai_habits_per_1k: mean((m) => m.ai_habits_per_1k),
  };
}

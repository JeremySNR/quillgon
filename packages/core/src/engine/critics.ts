import type { AgentSuite, CritiqueOutput, ShapeFinding, StructureAlternative } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import type { Project } from '../project.js';
import { sceneOrder } from '../project.js';
import { cosine, LocalEmbedder } from '../embed.js';
import { obligationIssues } from '../obligations.js';

/**
 * Judge the plan before a word of prose exists, where changes are cheapest.
 * The structural tells of AI fiction (stated themes, single-track plots, flat escalation,
 * tidy resolutions, archetypes) are invisible to prose polishing; they are caught here.
 */

export function synopsis(p: Project, sceneId: string): string {
  const c = p.scenes.get(sceneId)!.card;
  return `${c.title}. ${c.purpose} ${c.beats.join('. ')}. ${c.outcome}`.replace(/\.\s*\./g, '.').trim();
}

/** The whole plan as readable text: acts, chapters, scene synopses. */
export function planText(p: Project): string {
  const lines: string[] = [];
  for (const a of p.structure.acts) {
    lines.push(`## ${a.title || a.id}`);
    for (const ch of a.chapters) {
      lines.push(`### ${ch.title || ch.id}${ch.summary ? ` — ${ch.summary}` : ''}`);
      for (const s of ch.scenes) if (p.scenes.has(s)) lines.push(`- ${s}: ${synopsis(p, s)}`);
    }
  }
  if (p.threads.size) lines.push('', '## Threads', ...[...p.threads.values()].map((t) => `- ${t.title || t.id} (${t.kind}): ${t.description} [set up ${t.setup_scene ?? t.setup_chapter ?? '?'}, paid off ${t.payoff_scene ?? t.payoff_chapter ?? '?'}]`));
  if (p.obligations.size) lines.push('', '## Setups and payoffs', ...[...p.obligations.values()].map((o) => `- ${o.description} [${o.setup_scene ?? '?'} → ${o.payoff_scene ?? 'unpaid'}]`));
  return lines.join('\n');
}

export function alternativeText(alt: StructureAlternative): string {
  return [
    `# ${alt.label} (${alt.kind})`,
    alt.rationale,
    ...alt.acts.flatMap((a) => [`## ${a.title}`, ...a.chapters.map((c) => `- ${c.title}: ${c.summary}`)]),
    '## Threads',
    ...alt.threads.map((t) => `- ${t.title} (${t.kind}): ${t.description} [${t.setup_chapter ?? '?'} → ${t.payoff_chapter ?? '?'}]`),
  ].join('\n');
}

/** Structural checks that need no model. */
export function mechanicalShape(p: Project): ShapeFinding[] {
  const out: ShapeFinding[] = [];
  const order = sceneOrder(p);
  if (order.length < 4) return out;
  const threadsByScene = order.map((s) => p.scenes.get(s)!.card.threads_touched);
  const distinct = new Set(threadsByScene.flat());
  if (distinct.size <= 1)
    out.push({ kind: 'single-track', where: 'book', evidence: `Every scene serves ${distinct.size ? 'one thread' : 'no thread'}.`, suggestion: 'Add a B-story (a relationship or a rival goal) that pulls against the main line.', severity: 'high' });
  const lastTwo = new Set(order.slice(-2));
  const threads = [...p.threads.values()];
  if (threads.length >= 3 && threads.every((t) => t.payoff_scene && lastTwo.has(t.payoff_scene)))
    out.push({ kind: 'tidy-resolution', where: 'ending', evidence: 'Every thread resolves in the last two scenes.', suggestion: 'Let one thread pay off earlier, or leave one unresolved at a cost.', severity: 'medium' });
  const third = Math.floor(order.length / 3);
  const middle = order.slice(third, order.length - third);
  const quiet = middle.filter((s) => {
    const c = p.scenes.get(s)!.card;
    return !c.reveals.length && !c.pays_off.length && !c.plot_points.length && !c.sets_up.length;
  });
  if (middle.length >= 3 && quiet.length / middle.length > 0.5)
    out.push({ kind: 'sagging-middle', where: `${middle[0]}–${middle[middle.length - 1]}`, evidence: `${quiet.length} of ${middle.length} middle scenes reveal nothing, plant nothing and pay nothing off.`, suggestion: 'Move a reveal or a reversal into the middle; give the protagonist a costly choice there.', severity: 'high' });
  for (const t of threads) {
    if (t.kind !== 'relationship' || !t.setup_scene || !t.payoff_scene) continue;
    const gap = order.indexOf(t.payoff_scene) - order.indexOf(t.setup_scene);
    if (gap >= 0 && gap < Math.max(3, order.length / 5))
      out.push({ kind: 'rushed', where: t.id, evidence: `“${t.title}” resolves ${gap} scene${gap === 1 ? '' : 's'} after it starts.`, suggestion: 'Stretch it: add a setback between setup and payoff.', severity: 'medium' });
  }
  for (const i of obligationIssues(p).filter((x) => /never paid off|never set up/.test(x.message)))
    out.push({ kind: 'unpaid-setup', where: i.scene, evidence: i.message, suggestion: 'Plan a payoff scene, or cut the setup.', severity: 'medium' });
  return out;
}

export interface Critique extends CritiqueOutput {
  level: string;
  ran_at: string;
  mechanical: ShapeFinding[];
}

export async function critiquePlan(store: GraphStore, agents: AgentSuite): Promise<Critique> {
  const p = store.project;
  const out = await agents.critique({
    intent: p.intent,
    level: 'book',
    plan: planText(p),
    characters: [...p.characters.values()].map((c) => ({ id: c.id, name: c.bio.name, want: c.bio.want, need: c.bio.need, arc: c.bio.arc })),
  });
  const critique: Critique = { ...out, level: 'book', ran_at: new Date().toISOString(), mechanical: mechanicalShape(p) };
  store.writeReport('critique-latest.json', JSON.stringify(critique, null, 2));
  return critique;
}

export async function critiqueAlternatives(store: GraphStore, agents: AgentSuite, alts: StructureAlternative[]): Promise<CritiqueOutput[]> {
  const p = store.project;
  return Promise.all(
    alts.map((a) =>
      agents.critique({
        intent: p.intent,
        level: 'structure',
        plan: alternativeText(a),
        characters: a.characters.map((c) => ({ id: c.bio.id, name: c.bio.name, want: c.bio.want, need: c.bio.need, arc: c.bio.arc })),
      }),
    ),
  );
}

// ------------------------------------------------------------------ sameness test

export interface Predictability {
  scene: string;
  /** Share of the model's own probability mass that lands on the chosen turn. */
  score: number;
  verdict: 'predictable' | 'expected' | 'surprising';
  chosen: string;
  samples: { text: string; probability: number; similarity: number }[];
}

/**
 * Sample what the model would make happen in this scene without seeing the card's turn.
 * If the chosen turn is where most of the samples land, the beat is the median choice.
 */
export async function predictability(store: GraphStore, agents: AgentSuite, sceneId: string, opts: { k?: number; threshold?: number } = {}): Promise<Predictability> {
  const p = store.project;
  const order = sceneOrder(p);
  const idx = order.indexOf(sceneId);
  const c = p.scenes.get(sceneId)!.card;
  const context = order
    .slice(Math.max(0, idx - 8), idx)
    .map((s) => `- ${synopsis(p, s)}`)
    .join('\n');
  const setup = `${c.title}. ${c.purpose} Present: ${c.characters.map((x) => p.characters.get(x)?.bio.name ?? x).join(', ')}. It opens: ${c.beats[0] ?? ''}`;
  const chosen = `${c.beats.slice(1).join('. ')}. ${c.outcome}`;
  const out = await agents.sampleTurns({ intent: p.intent, context, setup, k: opts.k ?? 6 });
  const e = new LocalEmbedder();
  const cv = e.embedOne(chosen);
  const threshold = opts.threshold ?? 0.3;
  const samples = out.turns.map((t) => ({ ...t, similarity: Math.round(cosine(cv, e.embedOne(t.text)) * 100) / 100 }));
  const total = samples.reduce((n, s) => n + s.probability, 0) || 1;
  const score = Math.round((samples.filter((s) => s.similarity >= threshold).reduce((n, s) => n + s.probability, 0) / total) * 100) / 100;
  return { scene: sceneId, score, verdict: score >= 0.5 ? 'predictable' : score >= 0.25 ? 'expected' : 'surprising', chosen, samples };
}

import type { Obligation } from './schemas/index.js';
import type { Project } from './project.js';
import { sceneOrder } from './project.js';

/**
 * The obligations ledger. Every clue, promise, question and Chekhov's gun the book plants
 * must be paid off later; the writer is told exactly which ones to plant, which to pay,
 * and which to keep alive without resolving.
 */

export interface SceneObligations {
  plant: Obligation[];
  pay: Obligation[];
  keep_open: Obligation[];
}

export function obligationsForScene(p: Project, sceneId: string, order = sceneOrder(p), limit = 6): SceneObligations {
  const card = p.scenes.get(sceneId)?.card;
  if (!card) return { plant: [], pay: [], keep_open: [] };
  const idx = order.indexOf(sceneId);
  const pos = (s: string | null) => (s ? order.indexOf(s) : -1);
  const plant = card.sets_up.map((id) => p.obligations.get(id)).filter((o): o is Obligation => !!o);
  const pay = card.pays_off.map((id) => p.obligations.get(id)).filter((o): o is Obligation => !!o);
  const touching = new Set([...card.threads_touched]);
  // Open *at this point in the story*: set up earlier, paid later (or not yet planned).
  const keep_open = [...p.obligations.values()]
    .filter((o) => o.status !== 'dropped')
    .filter((o) => !card.sets_up.includes(o.id) && !card.pays_off.includes(o.id))
    .filter((o) => pos(o.setup_scene) >= 0 && pos(o.setup_scene) < idx && (pos(o.payoff_scene) === -1 || pos(o.payoff_scene) > idx))
    // Most relevant first: same thread, then soonest payoff.
    .sort((a, b) => Number(b.threads.some((t) => touching.has(t))) - Number(a.threads.some((t) => touching.has(t))) || (pos(a.payoff_scene) === -1 ? 1e9 : pos(a.payoff_scene)) - (pos(b.payoff_scene) === -1 ? 1e9 : pos(b.payoff_scene)))
    .slice(0, limit);
  return { plant, pay, keep_open };
}

/** Recompute each obligation's setup and payoff scenes from the cards that reference it. */
export function resolveObligationScenes(p: Project): Obligation[] {
  const order = sceneOrder(p);
  const changed: Obligation[] = [];
  for (const o of p.obligations.values()) {
    const setup = order.find((s) => p.scenes.get(s)!.card.sets_up.includes(o.id)) ?? null;
    const payoff = order.find((s) => p.scenes.get(s)!.card.pays_off.includes(o.id)) ?? null;
    if (setup !== o.setup_scene || payoff !== o.payoff_scene) changed.push({ ...o, setup_scene: setup ?? o.setup_scene, payoff_scene: payoff ?? o.payoff_scene });
  }
  return changed;
}

export interface ObligationIssue {
  obligation: string;
  scene: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

/** Mechanical ledger checks: orphans, payoffs before setups, written payoffs that never land. */
export function obligationIssues(p: Project): ObligationIssue[] {
  const order = sceneOrder(p);
  const pos = (s: string | null) => (s ? order.indexOf(s) : -1);
  const out: ObligationIssue[] = [];
  const last = order[order.length - 1] ?? '';
  const written = (s: string | null) => !!(s && p.scenes.get(s)?.prose);
  const extracted = (s: string | null) => (s ? (p.scenes.get(s)?.facts?.obligations ?? []) : []);
  const allPlanned = order.length > 0 && order.every((s) => p.scenes.has(s));
  for (const o of p.obligations.values()) {
    if (o.status === 'dropped') continue;
    const label = `"${o.description}"`;
    if (!o.setup_scene && o.payoff_scene)
      out.push({ obligation: o.id, scene: o.payoff_scene, severity: 'high', message: `${label} is paid off in ${o.payoff_scene} but never set up` });
    if (o.setup_scene && o.payoff_scene && pos(o.payoff_scene) <= pos(o.setup_scene))
      out.push({ obligation: o.id, scene: o.payoff_scene, severity: 'high', message: `${label} is paid off in ${o.payoff_scene} before it is set up in ${o.setup_scene}` });
    if (o.eligible_from && o.payoff_scene && pos(o.payoff_scene) < pos(o.eligible_from))
      out.push({ obligation: o.id, scene: o.payoff_scene, severity: 'medium', message: `${label} pays off in ${o.payoff_scene}, before it is allowed (${o.eligible_from})` });
    if (o.setup_scene && !o.payoff_scene && allPlanned && o.kind !== 'question')
      out.push({ obligation: o.id, scene: o.setup_scene, severity: 'medium', message: `${label} is set up in ${o.setup_scene} and never paid off` });
    if (written(o.setup_scene) && !extracted(o.setup_scene).some((x) => x.id === o.id) && p.scenes.get(o.setup_scene!)?.facts)
      out.push({ obligation: o.id, scene: o.setup_scene!, severity: 'medium', message: `${label} should be planted in ${o.setup_scene}, but the prose doesn't plant it` });
    if (written(o.payoff_scene) && p.scenes.get(o.payoff_scene!)?.facts && !extracted(o.payoff_scene).some((x) => x.id === o.id && x.action === 'paid'))
      out.push({ obligation: o.id, scene: o.payoff_scene!, severity: 'high', message: `${label} should pay off in ${o.payoff_scene}, but the prose doesn't pay it off` });
    if (o.payoff_scene === null && o.setup_scene && o.kind === 'question' && written(last) && allPlanned)
      out.push({ obligation: o.id, scene: o.setup_scene, severity: 'low', message: `question ${label} is still open at the end of the book` });
  }
  return out;
}

/** Status after extraction of a scene. */
export function obligationStatusAfter(o: Obligation, actions: { id: string; action: string }[]): Obligation['status'] {
  const mine = actions.filter((a) => a.id === o.id);
  if (mine.some((a) => a.action === 'paid')) return 'paid';
  if (mine.some((a) => a.action === 'planted') && o.status === 'planned') return 'open';
  return o.status;
}

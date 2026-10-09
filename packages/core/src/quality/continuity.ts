import type { AgentSuite } from '../agents/contracts.js';
import type { Project } from '../project.js';
import { sceneOrder, stateAt } from '../project.js';
import type { GraphStore } from '../store.js';
import { proseHash } from '../sync.js';
import { timestamp } from '../util.js';

export interface ContinuityIssue {
  kind: 'dead-acts' | 'unknown-fact' | 'payoff-before-setup' | 'time-backwards' | 'location-jump' | 'model';
  scene: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

const SLOTS = ['dawn', 'morning', 'midday', 'noon', 'afternoon', 'dusk', 'evening', 'night', 'midnight'];

/** Parse a card's free-form time into [date, slot] for ordering; null if unparseable. */
export function parseSceneTime(t: string): { date: string; slot: number } | null {
  const date = t.match(/\d{4}-\d{2}-\d{2}|\bd\d+\b|\bday \d+\b/i)?.[0];
  if (!date) return null;
  const norm = date.replace(/^day (\d+)$/i, (_, n) => `d${String(n).padStart(4, '0')}`).replace(/^d(\d+)$/i, (_, n) => `d${String(n).padStart(4, '0')}`);
  const lower = t.toLowerCase();
  let slot = -1;
  SLOTS.forEach((s, i) => {
    if (lower.includes(s)) slot = Math.max(slot, i);
  });
  const hm = t.match(/T?(\d{2}):(\d{2})/);
  if (hm) slot = Math.floor((Number(hm[1]) / 24) * SLOTS.length);
  return { date: norm, slot };
}

/** Mechanical checks. No model calls; cheap enough to run on every save. */
export function mechanicalContinuity(p: Project): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const order = sceneOrder(p);
  const name = (id: string) => p.characters.get(id)?.bio.name.split(' ')[0] ?? id;
  const near = new Map<string, Set<string>>();
  for (const l of p.locations.locations) {
    near.set(l.id, new Set([...(near.get(l.id) ?? []), ...l.near]));
    for (const n of l.near) near.set(n, new Set([...(near.get(n) ?? []), l.id]));
  }

  order.forEach((sid, idx) => {
    const card = p.scenes.get(sid)!.card;

    // A character acts while dead. Death is sticky: any earlier snapshot with alive: false.
    for (const c of card.characters) {
      const ch = p.characters.get(c);
      const diedIn = ch ? order.slice(0, idx).find((s) => ch.state[s]?.alive === false) : undefined;
      if (diedIn) issues.push({ kind: 'dead-acts', scene: sid, severity: 'high', message: `${name(c)} appears in ${sid} but died in ${diedIn}` });
    }

    // A character references a fact not in their knows[] at that scene.
    const mentions = [...card.mentions];
    for (const f of p.scenes.get(sid)!.facts?.facts ?? [])
      if (f.predicate === 'mentions' && !mentions.some((m) => m.character === f.subject && m.fact === f.object)) mentions.push({ character: f.subject, fact: f.object });
    for (const m of mentions) {
      const at = stateAt(p, m.character, sid, order);
      if (!p.characters.has(m.character)) continue;
      if (!at || !at.snapshot.knows.includes(m.fact))
        issues.push({ kind: 'unknown-fact', scene: sid, severity: 'high', message: `${name(m.character)} speaks about "${m.fact}" in ${sid} without knowing it` });
    }

    // Location jump with no travel time between consecutive scenes.
    if (idx > 0) {
      const prev = p.scenes.get(order[idx - 1])!.card;
      const tp = parseSceneTime(prev.time);
      const tc = parseSceneTime(card.time);
      if (tp && tc) {
        if (tc.date < tp.date || (tc.date === tp.date && tc.slot >= 0 && tp.slot >= 0 && tc.slot < tp.slot))
          issues.push({ kind: 'time-backwards', scene: sid, severity: 'medium', message: `${sid} (${card.time}) is earlier than ${prev.id} (${prev.time})` });
        const sameMoment = tc.date === tp.date && tc.slot === tp.slot;
        if (sameMoment && prev.location !== card.location && !near.get(prev.location)?.has(card.location)) {
          for (const c of card.characters.filter((x) => prev.characters.includes(x)))
            issues.push({ kind: 'location-jump', scene: sid, severity: 'low', message: `${name(c)} is at ${prev.location} in ${prev.id} and at ${card.location} in ${sid} at the same time` });
        }
      }
    }
  });

  // Threads paid off before they are set up.
  for (const t of p.threads.values()) {
    if (t.setup_scene && t.payoff_scene && order.indexOf(t.payoff_scene) >= 0 && order.indexOf(t.payoff_scene) < order.indexOf(t.setup_scene))
      issues.push({ kind: 'payoff-before-setup', scene: t.payoff_scene, severity: 'high', message: `thread "${t.title || t.id}" pays off in ${t.payoff_scene} before its setup in ${t.setup_scene}` });
  }

  // Timeline events out of order in the file.
  const tl = p.timeline.events;
  for (let i = 1; i < tl.length; i++)
    if (tl[i].when < tl[i - 1].when)
      issues.push({ kind: 'time-backwards', scene: tl[i].scenes[0] ?? '', severity: 'low', message: `timeline event "${tl[i].id}" is listed after a later event` });

  return issues;
}

export interface ContinuityReport {
  ran_at: string;
  mechanical: ContinuityIssue[];
  model: ContinuityIssue[];
  checked_pairs: string[];
}

/**
 * Mechanical checks always; model-assisted pair checks only for consecutive pairs whose
 * prose changed since the last run (incremental, cheap model).
 */
export async function runContinuity(store: GraphStore, agents: AgentSuite | null, opts: { model?: boolean; progress?: (s: string, d?: string) => void } = {}): Promise<ContinuityReport> {
  const p = store.project;
  const mechanical = mechanicalContinuity(p);
  const model: ContinuityIssue[] = [];
  const checked: string[] = [];
  const prior = JSON.parse(store.readReport('continuity-latest.json') ?? '{"pairs":{},"model":[]}') as { pairs: Record<string, string>; model: ContinuityIssue[] };
  const pairs: Record<string, string> = { ...prior.pairs };
  if (agents && opts.model !== false) {
    const order = sceneOrder(p);
    for (let i = 1; i < order.length; i++) {
      const a = p.scenes.get(order[i - 1])!;
      const b = p.scenes.get(order[i])!;
      if (!a.prose || !b.prose) continue;
      const key = `${a.id}>${b.id}`;
      const h = proseHash(a.prose.body + b.prose.body);
      if (pairs[key] === h) {
        model.push(...prior.model.filter((m) => m.scene === a.id || m.scene === b.id).filter((m) => !model.includes(m)));
        continue;
      }
      opts.progress?.('continuity', `Checking ${a.id} → ${b.id}`);
      const states = b.card.characters.map((c) => ({ character: c, name: p.characters.get(c)?.bio.name ?? c, after_a: stateAt(p, c, a.id, order)?.snapshot ?? null }));
      const out = await agents.continuity({ a: { id: a.id, card: a.card, prose: a.prose.body }, b: { id: b.id, card: b.card, prose: b.prose.body }, states });
      for (const c of out.contradictions) model.push({ kind: 'model', scene: c.scene, severity: c.severity, message: c.description });
      pairs[key] = h;
      checked.push(key);
    }
  }
  const report: ContinuityReport = { ran_at: new Date().toISOString(), mechanical, model, checked_pairs: checked };
  store.writeReport('continuity-latest.json', JSON.stringify({ ...report, pairs }, null, 2));
  const md = [
    `# Continuity report — ${report.ran_at}`,
    '',
    `## Mechanical (${mechanical.length})`,
    ...(mechanical.length ? mechanical.map((i) => `- **${i.scene}** [${i.severity}] ${i.message}`) : ['None.']),
    '',
    `## Model-assisted (${model.length})`,
    ...(model.length ? model.map((i) => `- **${i.scene}** [${i.severity}] ${i.message}`) : ['None.']),
  ].join('\n');
  store.writeReport(`continuity-${timestamp()}.md`, md + '\n');
  store.updateBook({ health: { ...p.book.health, open_continuity_issues: mechanical.length + model.length } });
  return report;
}

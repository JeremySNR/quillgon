import type { Fact, Obligation, PlotPoint, SceneCard, StateSnapshot, Thread } from './schemas/index.js';
import { paths, sceneOrder, type Project } from './project.js';
import type { ProjectIndex } from './index-db.js';
import { uniq } from './util.js';

/**
 * Impact analysis: given a change to the graph, which scenes might now be wrong?
 * No model calls. Works entirely off references, facts and state snapshots.
 *
 *  hop 0  the changed scene itself (its own prose must follow its card)
 *  hop 1  direct reference to the changed entity or fact
 *  hop 2  reached via a thread's other end or a character's state
 *  hop 3  similarity only (listed, never proposed unless the author expands)
 */

export type Change =
  | { kind: 'card'; scene: string; before: SceneCard; after: SceneCard; description?: string }
  | { kind: 'state'; character: string; scene: string; before: StateSnapshot | null; after: StateSnapshot | null; description?: string }
  | { kind: 'character'; character: string; field: 'bio' | 'voice'; description?: string }
  | { kind: 'thread'; before: Thread | null; after: Thread | null; description?: string }
  | { kind: 'plot'; before: PlotPoint | null; after: PlotPoint | null; description?: string }
  | { kind: 'obligation'; before: Obligation | null; after: Obligation | null; description?: string }
  | { kind: 'reorder'; before: string[]; after: string[]; description?: string }
  | { kind: 'delete-scene'; scene: string; card: SceneCard; orderBefore: string[]; description?: string };

/**
 * The files an edit of this kind writes. A ripple commits these as its origin commit,
 * apart from any other uncommitted work, so reverting the ripple reverts exactly the edit.
 */
export function changeFiles(change: Change): string[] {
  switch (change.kind) {
    case 'card':
      return [paths.card(change.scene)];
    case 'state':
      return [paths.state(change.character)];
    case 'character':
      return [paths.bio(change.character), paths.voice(change.character)];
    case 'thread':
      return [...new Set([change.before?.id, change.after?.id].filter((x): x is string => !!x))].map(paths.thread);
    case 'plot':
      return [...new Set([change.before?.id, change.after?.id].filter((x): x is string => !!x))].map(paths.plotPoint);
    case 'obligation': {
      const ids = [change.before?.id, change.after?.id].filter((x): x is string => !!x);
      // Moving where an obligation is planted or paid also rewrites those scenes' cards.
      const scenes = [change.before, change.after].flatMap((o) => (o ? [o.setup_scene, o.payoff_scene] : [])).filter((x): x is string => !!x);
      return [...new Set([...ids.map(paths.obligation), ...scenes.map(paths.card)])];
    }
    case 'reorder':
      return [paths.structure];
    case 'delete-scene': {
      // Deleting a scene also drops it from the structure and from its cast's state files.
      const cast = [...new Set([change.card.pov, ...change.card.characters])];
      return [`scenes/${change.scene}`, paths.structure, ...cast.map(paths.state)];
    }
  }
}

export interface Impact {
  scene: string;
  hop: 0 | 1 | 2 | 3;
  reasons: string[];
  confidence: number;
  /** Set when the scene is locked: it becomes a conflict, not a proposal. */
  conflict: null | { lock: SceneCard['lock']; status: SceneCard['status'] };
}

export interface ImpactResult {
  change: Change;
  description: string;
  origin: string | null;
  impacts: Impact[];
}

export interface ImpactOptions {
  /** Include hop-3 similarity candidates (they are always listed, never proposed by default). */
  similarity?: boolean;
  similarityThreshold?: number;
  maxSimilar?: number;
}

class Collector {
  private m = new Map<string, Impact>();
  constructor(private p: Project) {}
  add(scene: string, hop: Impact['hop'], reason: string, confidence: number) {
    if (!this.p.scenes.has(scene)) return;
    const cur = this.m.get(scene);
    if (!cur) {
      const card = this.p.scenes.get(scene)!.card;
      const locked = card.lock !== 'none' || card.status === 'locked';
      this.m.set(scene, { scene, hop, reasons: [reason], confidence, conflict: locked ? { lock: card.lock, status: card.status } : null });
      return;
    }
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
    if (hop < cur.hop) cur.hop = hop;
    cur.confidence = Math.max(cur.confidence, confidence);
  }
  has(scene: string) {
    return this.m.has(scene);
  }
  values() {
    return [...this.m.values()];
  }
}

const name = (p: Project, id: string) => p.characters.get(id)?.bio.name.split(' ')[0] ?? id;
const factLabel = (p: Project, id: string) => p.factGlossary.facts.find((f) => f.id === id)?.statement ?? id;
const sceneLabel = (p: Project, id: string) => {
  const t = p.scenes.get(id)?.card.title;
  return t ? `${id} "${t}"` : id;
};

/** All (character, fact) mentions in a scene, from the card and from extracted prose facts. */
function mentionsIn(p: Project, scene: string): { character: string; fact: string; source: 'card' | 'prose' }[] {
  const s = p.scenes.get(scene);
  if (!s) return [];
  const out: { character: string; fact: string; source: 'card' | 'prose' }[] = s.card.mentions.map((m) => ({ ...m, source: 'card' as const }));
  for (const f of s.facts?.facts ?? []) {
    if (f.predicate === 'mentions' && !out.some((m) => m.character === f.subject && m.fact === f.object))
      out.push({ character: f.subject, fact: f.object, source: 'prose' });
  }
  return out;
}

/** Does `character` learn `fact` in `scene` according to its card? */
function learnsIn(p: Project, scene: string, character: string, fact: string): boolean {
  const c = p.scenes.get(scene)?.card;
  if (!c) return false;
  if (c.deltas.some((d) => d.character === character && d.learns.includes(fact))) return true;
  return c.reveals.includes(fact) && c.characters.includes(character) && !c.deltas.some((d) => d.character === character && d.forgets.includes(fact));
}

/** What a character knows right before a scene starts (latest snapshot strictly before it). */
function knowsBefore(p: Project, character: string, scene: string, order: string[]): Set<string> {
  const ch = p.characters.get(character);
  if (!ch) return new Set();
  const idx = order.indexOf(scene);
  for (let i = idx - 1; i >= 0; i--) {
    const snap = ch.state[order[i]];
    if (snap) return new Set(snap.knows);
  }
  return new Set();
}

/**
 * Later scenes (after `fromIdx`) where `character` mentions `fact`, stopping at the first
 * later scene where they learn it through another route.
 */
function laterMentions(p: Project, order: string[], fromIdx: number, character: string, fact: string): string[] {
  const out: string[] = [];
  for (let i = fromIdx + 1; i < order.length; i++) {
    const sid = order[i];
    if (learnsIn(p, sid, character, fact)) break;
    if (mentionsIn(p, sid).some((m) => m.character === character && m.fact === fact)) out.push(sid);
  }
  return out;
}

/** True when the character knew the fact before any scene card teaches it (backstory). */
function priorKnowledge(p: Project, character: string, fact: string, order: string[]): boolean {
  const ch = p.characters.get(character);
  if (!ch) return false;
  for (const sid of order) {
    if (learnsIn(p, sid, character, fact)) return false;
    if (ch.state[sid]?.knows.includes(fact)) return true;
  }
  return false;
}

function nextSceneWith(p: Project, order: string[], fromIdx: number, character: string): string | null {
  for (let i = fromIdx + 1; i < order.length; i++) {
    if (p.scenes.get(order[i])?.card.characters.includes(character)) return order[i];
  }
  return null;
}

function threadEnds(t: Thread): string[] {
  return [t.setup_scene, t.payoff_scene].filter((x): x is string => !!x);
}

export function describeChange(p: Project, c: Change): string {
  if (c.description) return c.description;
  switch (c.kind) {
    case 'card': {
      const parts = cardDiffSummary(c.before, c.after);
      return `Scene ${sceneLabel(p, c.scene)} changed: ${parts.join('; ') || 'edited'}`;
    }
    case 'state': {
      const b = new Set(c.before?.knows ?? []);
      const a = new Set(c.after?.knows ?? []);
      const lost = [...b].filter((f) => !a.has(f));
      const gained = [...a].filter((f) => !b.has(f));
      const bits: string[] = [];
      if (lost.length) bits.push(`no longer knows ${lost.map((f) => `"${factLabel(p, f)}"`).join(', ')}`);
      if (gained.length) bits.push(`now knows ${gained.map((f) => `"${factLabel(p, f)}"`).join(', ')}`);
      if ((c.before?.location ?? null) !== (c.after?.location ?? null)) bits.push(`is now at ${c.after?.location ?? 'an unknown place'}`);
      if ((c.before?.alive ?? true) !== (c.after?.alive ?? true)) bits.push(c.after?.alive === false ? 'is dead' : 'is alive');
      if ((c.before?.wants ?? '') !== (c.after?.wants ?? '')) bits.push(`now wants ${c.after?.wants}`);
      return `${name(p, c.character)} at the end of ${sceneLabel(p, c.scene)} ${bits.join('; ') || 'changed'}`;
    }
    case 'character':
      return `${name(p, c.character)}'s ${c.field === 'bio' ? 'biography' : 'voice sheet'} changed`;
    case 'thread':
      return `Thread "${(c.after ?? c.before)?.title || (c.after ?? c.before)?.id}" ${c.after ? (c.before ? 'changed' : 'added') : 'removed'}`;
    case 'plot':
      return `Plot point "${(c.after ?? c.before)?.title || (c.after ?? c.before)?.id}" ${c.after ? (c.before ? 'changed' : 'added') : 'removed'}: ${(c.after ?? c.before)?.description}`;
    case 'obligation':
      return `Setup “${(c.after ?? c.before)?.description}” ${c.after ? (c.before ? 'changed' : 'added') : 'removed'}`;
    case 'reorder':
      return 'Scenes were reordered';
    case 'delete-scene':
      return `Scene ${c.scene} "${c.card.title}" was deleted`;
  }
}

export function cardDiffSummary(a: SceneCard, b: SceneCard): string[] {
  const out: string[] = [];
  const arr = (k: keyof SceneCard) => JSON.stringify(a[k]) !== JSON.stringify(b[k]);
  for (const k of ['title', 'pov', 'location', 'time', 'purpose', 'outcome'] as const) if (a[k] !== b[k]) out.push(`${k} changed`);
  for (const k of ['beats', 'characters', 'threads_touched', 'plot_points', 'reveals', 'mentions', 'deltas', 'sets_up', 'pays_off'] as const) if (arr(k)) out.push(`${k} changed`);
  return out;
}

/** Facts diff for prose edits flowing back. Presentation-only edits produce no graph-level change. */
export function factsDiff(before: Fact[], after: Fact[]) {
  const k = (f: Fact) => `${f.subject}|${f.predicate}|${f.object}`;
  const b = new Map(before.map((f) => [k(f), f]));
  const a = new Map(after.map((f) => [k(f), f]));
  const added = [...a.entries()].filter(([key]) => !b.has(key)).map(([, f]) => f);
  const removed = [...b.entries()].filter(([key]) => !a.has(key)).map(([, f]) => f);
  return { added, removed, graphLevel: added.length + removed.length > 0 };
}

export function analyseImpact(p: Project, change: Change, index: ProjectIndex | null, opts: ImpactOptions = {}): ImpactResult {
  const order = change.kind === 'reorder' ? change.after.filter((s) => p.scenes.has(s)) : sceneOrder(p);
  const pos = (s: string) => order.indexOf(s);
  const out = new Collector(p);
  let origin: string | null = null;
  const description = describeChange(p, change);

  switch (change.kind) {
    case 'card': {
      const { before: b, after: a } = change;
      origin = change.scene;
      const idx = pos(change.scene);
      if (p.scenes.get(change.scene)?.prose && cardDiffSummary(b, a).length) out.add(change.scene, 0, 'card edited; prose must follow', 1);

      // Facts no longer revealed here: characters who learned them here and mention them later.
      const lostReveals = b.reveals.filter((f) => !a.reveals.includes(f));
      for (const f of lostReveals) {
        const learners = uniq([...b.characters, ...b.deltas.filter((d) => d.learns.includes(f)).map((d) => d.character)]);
        for (const ch of learners) {
          if (knowsBefore(p, ch, change.scene, order).has(f)) continue;
          for (const s of laterMentions(p, order, idx, ch, f))
            out.add(s, 1, `${name(p, ch)} speaks about "${factLabel(p, f)}", which is no longer revealed in ${change.scene}`, 0.9);
        }
      }
      // Facts newly revealed here: later scenes that reveal them again.
      for (const f of a.reveals.filter((x) => !b.reveals.includes(x))) {
        for (let i = idx + 1; i < order.length; i++) {
          if (p.scenes.get(order[i])?.card.reveals.includes(f)) out.add(order[i], 1, `reveals "${factLabel(p, f)}", which is now revealed earlier in ${change.scene}`, 0.8);
        }
      }
      // Per-character learning removed via deltas.
      for (const d of b.deltas) {
        const nd = a.deltas.find((x) => x.character === d.character);
        for (const f of d.learns.filter((x) => !(nd?.learns ?? []).includes(x))) {
          if (a.reveals.includes(f) && a.characters.includes(d.character)) continue;
          for (const s of laterMentions(p, order, idx, d.character, f))
            out.add(s, 1, `${name(p, d.character)} speaks about "${factLabel(p, f)}" but no longer learns it in ${change.scene}`, 0.9);
        }
      }
      // Characters removed from the scene: whatever they learned here, they no longer learn.
      for (const ch of b.characters.filter((c) => !a.characters.includes(c))) {
        for (const f of b.reveals) {
          if (knowsBefore(p, ch, change.scene, order).has(f)) continue;
          for (const s of laterMentions(p, order, idx, ch, f))
            out.add(s, 2, `${name(p, ch)} is no longer present in ${change.scene} to learn "${factLabel(p, f)}"`, 0.7);
        }
      }
      // Location continuity: the next scene for each character here.
      if (b.location !== a.location) {
        for (const ch of a.characters) {
          const n = nextSceneWith(p, order, idx, ch);
          if (n) out.add(n, 2, `${name(p, ch)} now comes from ${a.location}, not ${b.location}`, 0.5);
        }
      }
      // Threads: if the scene's story content changed, the other ends of its threads.
      const storyChanged = ['beats', 'outcome', 'purpose', 'reveals'].some((k) => JSON.stringify(b[k as keyof SceneCard]) !== JSON.stringify(a[k as keyof SceneCard]));
      const threads = uniq([...b.threads_touched, ...a.threads_touched]);
      for (const tid of threads) {
        const t = p.threads.get(tid);
        if (!t) continue;
        const touchedChanged = b.threads_touched.includes(tid) !== a.threads_touched.includes(tid);
        if (!storyChanged && !touchedChanged) continue;
        for (const end of threadEnds(t)) {
          if (end === change.scene) continue;
          out.add(end, 2, `${end === t.setup_scene ? 'sets up' : 'pays off'} thread "${t.title || t.id}", which ${change.scene} touches`, touchedChanged ? 0.6 : 0.5);
        }
      }
      // Obligations: a setup no longer planted here strands its payoff; a payoff moved here
      // must not come before its setup.
      for (const oid of uniq([...b.sets_up, ...a.sets_up, ...b.pays_off, ...a.pays_off])) {
        const o = p.obligations.get(oid);
        if (!o) continue;
        const label = `“${o.description}”`;
        if (b.sets_up.includes(oid) && !a.sets_up.includes(oid) && o.payoff_scene && o.payoff_scene !== change.scene)
          out.add(o.payoff_scene, 1, `pays off ${label}, which is no longer set up in ${change.scene}`, 0.9);
        if (!b.sets_up.includes(oid) && a.sets_up.includes(oid) && o.setup_scene && o.setup_scene !== change.scene)
          out.add(o.setup_scene, 1, `also sets up ${label}, now planted in ${change.scene}`, 0.6);
        if (b.pays_off.includes(oid) !== a.pays_off.includes(oid) && o.setup_scene && o.setup_scene !== change.scene)
          out.add(o.setup_scene, 2, `sets up ${label}, whose payoff ${a.pays_off.includes(oid) ? 'now lands' : 'no longer lands'} in ${change.scene}`, 0.5);
        if (storyChanged && a.sets_up.includes(oid) && b.sets_up.includes(oid) && o.payoff_scene && o.payoff_scene !== change.scene)
          out.add(o.payoff_scene, 2, `pays off ${label}, set up in ${change.scene}, which changed`, 0.5);
      }
      break;
    }

    case 'obligation': {
      const ob = change.before;
      const oa = change.after;
      const label = `“${(oa ?? ob)!.description}”`;
      for (const sid of uniq([ob?.setup_scene, oa?.setup_scene].filter((x): x is string => !!x))) out.add(sid, 1, `sets up ${label}`, 0.9);
      for (const sid of uniq([ob?.payoff_scene, oa?.payoff_scene].filter((x): x is string => !!x))) out.add(sid, 1, `pays off ${label}`, 0.9);
      break;
    }

    case 'state': {
      origin = change.scene;
      const idx = pos(change.scene);
      const b = change.before ?? { knows: [], wants: '', feels: {}, location: null, alive: true };
      const a = change.after ?? { knows: [], wants: '', feels: {}, location: null, alive: true };
      for (const f of b.knows.filter((x) => !a.knows.includes(x))) {
        for (const s of laterMentions(p, order, idx, change.character, f))
          out.add(s, 1, `${name(p, change.character)} speaks about "${factLabel(p, f)}", which they no longer know after ${change.scene}`, 0.9);
      }
      for (const f of a.knows.filter((x) => !b.knows.includes(x))) {
        for (let i = idx + 1; i < order.length; i++) {
          if (learnsIn(p, order[i], change.character, f)) {
            out.add(order[i], 1, `${name(p, change.character)} learns "${factLabel(p, f)}" here but now already knows it from ${change.scene}`, 0.6);
            break;
          }
        }
      }
      if (b.location !== a.location) {
        const n = nextSceneWith(p, order, idx, change.character);
        if (n) out.add(n, 1, `${name(p, change.character)} now starts from ${a.location ?? 'somewhere else'}`, 0.5);
      }
      if (b.alive && !a.alive) {
        for (let i = idx + 1; i < order.length; i++)
          if (p.scenes.get(order[i])?.card.characters.includes(change.character)) out.add(order[i], 1, `${name(p, change.character)} appears but is dead after ${change.scene}`, 1);
      }
      const feelsChanged = Object.keys({ ...b.feels, ...a.feels }).filter((o) => b.feels[o] !== a.feels[o]);
      for (const other of feelsChanged) {
        let seen = 0;
        for (let i = idx + 1; i < order.length && seen < 2; i++) {
          const c = p.scenes.get(order[i])?.card;
          if (c && c.characters.includes(change.character) && c.characters.includes(other)) {
            out.add(order[i], 2, `${name(p, change.character)} now feels "${a.feels[other] ?? 'nothing in particular'}" toward ${name(p, other)}`, 0.4);
            seen++;
          }
        }
      }
      if (b.wants !== a.wants) {
        const n = nextSceneWith(p, order, idx, change.character);
        if (n) out.add(n, 2, `${name(p, change.character)} now wants: ${a.wants}`, 0.4);
      }
      break;
    }

    case 'character': {
      for (const sid of order) {
        const c = p.scenes.get(sid)!.card;
        if (change.field === 'voice') {
          const speaks = c.characters.includes(change.character) && c.characters.length > 1;
          if (speaks || c.pov === change.character) out.add(sid, 1, `${name(p, change.character)} speaks here; voice sheet changed`, 0.5);
        } else {
          if (c.pov === change.character) out.add(sid, 1, `point-of-view character ${name(p, change.character)} changed`, 0.6);
          else if (c.characters.includes(change.character)) out.add(sid, 2, `${name(p, change.character)} appears; biography changed`, 0.3);
        }
      }
      break;
    }

    case 'thread': {
      const b = change.before;
      const a = change.after;
      const id = (a ?? b)!.id;
      const ends = uniq([...(b ? threadEnds(b) : []), ...(a ? threadEnds(a) : [])]);
      for (const e of ends) out.add(e, 1, `${e === a?.setup_scene || e === b?.setup_scene ? 'setup' : 'payoff'} of thread "${(a ?? b)!.title || id}"`, 0.9);
      const contentChanged = !a || !b || a.kind !== b.kind || a.description !== b.description || a.status !== b.status || a.title !== b.title;
      if (contentChanged) {
        for (const sid of order) {
          if (p.scenes.get(sid)!.card.threads_touched.includes(id)) out.add(sid, 1, `touches thread "${(a ?? b)!.title || id}"`, 0.6);
        }
      }
      if (a && a.setup_scene && a.payoff_scene && pos(a.payoff_scene) < pos(a.setup_scene)) {
        out.add(a.payoff_scene, 1, 'pays off before its setup', 1);
      }
      break;
    }

    case 'plot': {
      const pp = (change.after ?? change.before)!;
      for (const sid of order) {
        if (p.scenes.get(sid)!.card.plot_points.includes(pp.id)) out.add(sid, 1, `stages plot point "${pp.title || pp.id}"`, 0.95);
      }
      const threads = uniq([...(change.before?.threads ?? []), ...(change.after?.threads ?? [])]);
      for (const tid of threads) {
        const t = p.threads.get(tid);
        if (!t) continue;
        for (const e of threadEnds(t)) out.add(e, 2, `${e === t.setup_scene ? 'sets up' : 'pays off'} thread "${t.title || t.id}", tied to this plot point`, 0.6);
      }
      break;
    }

    case 'reorder': {
      const before = change.before;
      const firstMoved = order.findIndex((s, i) => before[i] !== s);
      if (firstMoved === -1) break;
      origin = order[firstMoved];
      // Moved scenes and the scenes now following them have new neighbours.
      for (let i = firstMoved; i < order.length; i++) {
        const s = order[i];
        if (before.indexOf(s) !== i) {
          out.add(s, 2, 'moved; its neighbours changed', 0.5);
        }
      }
      // Knowledge now used before it is learned. Facts a character knew before any scene
      // teaches them (backstory, per their earliest snapshot) are never "learned late".
      for (let i = 0; i < order.length; i++) {
        for (const m of mentionsIn(p, order[i])) {
          if (priorKnowledge(p, m.character, m.fact, before)) continue;
          const learnedAt = order.findIndex((s) => learnsIn(p, s, m.character, m.fact));
          if (learnedAt > i) {
            out.add(order[i], 1, `${name(p, m.character)} speaks about "${factLabel(p, m.fact)}" before learning it in ${order[learnedAt]}`, 0.95);
          }
        }
      }
      // Threads paid off before set up.
      for (const t of p.threads.values()) {
        if (t.setup_scene && t.payoff_scene && pos(t.payoff_scene) < pos(t.setup_scene)) {
          out.add(t.payoff_scene, 1, `pays off thread "${t.title || t.id}" before its setup in ${t.setup_scene}`, 1);
          out.add(t.setup_scene, 1, `sets up thread "${t.title || t.id}" after its payoff`, 1);
        }
      }
      break;
    }

    case 'delete-scene': {
      // First surviving scene that came after the deleted one.
      const oldIdx = change.orderBefore.indexOf(change.scene);
      const next = change.orderBefore.slice(oldIdx + 1).find((s) => p.scenes.has(s));
      const idx = next ? pos(next) : order.length;
      for (const f of change.card.reveals) {
        for (const ch of change.card.characters) {
          for (let i = Math.max(idx, 0); i < order.length; i++) {
            const sid = order[i];
            if (learnsIn(p, sid, ch, f)) break;
            if (mentionsIn(p, sid).some((m) => m.character === ch && m.fact === f))
              out.add(sid, 1, `${name(p, ch)} speaks about "${factLabel(p, f)}", which was revealed in the deleted scene`, 0.9);
          }
        }
      }
      for (const t of p.threads.values()) {
        if (change.card.threads_touched.includes(t.id))
          for (const e of threadEnds(t)) if (e !== change.scene) out.add(e, 1, `thread "${t.title || t.id}" lost a beat in the deleted scene`, 0.6);
      }
      if (idx >= 0 && idx < order.length) out.add(order[idx], 2, 'now follows the deleted scene\'s predecessor', 0.4);
      break;
    }
  }

  // Hop 3: similarity, later than the earliest affected scene, above threshold.
  if (opts.similarity !== false && index) {
    const flagged = out.values();
    const earliest = Math.min(
      ...[origin ? pos(origin) : Infinity, ...flagged.map((i) => pos(i.scene))].filter((n) => n >= 0),
    );
    if (Number.isFinite(earliest)) {
      const threshold = opts.similarityThreshold ?? p.book.ripple.similarity_threshold;
      const ranked = index.similar(description, { exclude: [...flagged.map((i) => i.scene), ...(origin ? [origin] : [])] });
      let n = 0;
      for (const r of ranked) {
        if (n >= (opts.maxSimilar ?? 5)) break;
        if (r.score < threshold) break;
        if (pos(r.scene) <= earliest) continue;
        out.add(r.scene, 3, `similar to the change (${Math.round(r.score * 100)}%)`, Math.round(r.score * 100) / 100);
        n++;
      }
    }
  }

  const impacts = out.values().sort((x, y) => pos(x.scene) - pos(y.scene));
  return { change, description, origin, impacts };
}

/** Split impacts into what the ripple should propose, list only, or raise as conflicts. */
export function partitionImpacts(impacts: Impact[], hopLimit: number) {
  const conflicts = impacts.filter((i) => i.conflict && i.hop <= hopLimit);
  const proposals = impacts.filter((i) => !i.conflict && i.hop <= hopLimit);
  const listed = impacts.filter((i) => i.hop > hopLimit);
  return { conflicts, proposals, listed };
}

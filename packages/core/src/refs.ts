import type { Project } from './project.js';

/**
 * Typed entity keys used across the index and impact analyser.
 * "scene:s04", "character:mara", "thread:ledger", "plot:pp-drowning", "fact:ink-mismatch", "location:quay".
 */
export type EntityKind = 'scene' | 'character' | 'thread' | 'plot' | 'fact' | 'location' | 'act' | 'chapter';
export const key = (kind: EntityKind, id: string) => `${kind}:${id}`;
export function parseKey(k: string): { kind: EntityKind; id: string } {
  const i = k.indexOf(':');
  return { kind: k.slice(0, i) as EntityKind, id: k.slice(i + 1) };
}

export interface Ref {
  from: string;
  to: string;
  field: string;
}

export interface FactRow {
  subject: string;
  predicate: string;
  object: string;
  scene: string;
  confidence: number;
  /** card = declared on the scene card; state = character state.yaml; extracted = facts.yaml from prose. */
  source: 'card' | 'state' | 'extracted';
}

/** Every reference edge in the graph. The impact analyser walks these. */
export function collectRefs(p: Project): Ref[] {
  const refs: Ref[] = [];
  const add = (from: string, to: string, field: string) => refs.push({ from, to, field });

  for (const s of p.scenes.values()) {
    const from = key('scene', s.id);
    const c = s.card;
    add(from, key('character', c.pov), 'pov');
    add(from, key('location', c.location), 'location');
    for (const ch of c.characters) add(from, key('character', ch), 'characters');
    for (const t of c.threads_touched) add(from, key('thread', t), 'threads_touched');
    for (const pp of c.plot_points) add(from, key('plot', pp), 'plot_points');
    for (const f of c.reveals) add(from, key('fact', f), 'reveals');
    for (const m of c.mentions) {
      add(from, key('fact', m.fact), 'mentions');
      add(from, key('character', m.character), 'mentions');
    }
  }
  for (const t of p.threads.values()) {
    const from = key('thread', t.id);
    if (t.setup_scene) add(from, key('scene', t.setup_scene), 'setup_scene');
    if (t.payoff_scene) add(from, key('scene', t.payoff_scene), 'payoff_scene');
    for (const b of t.beats) add(from, key('scene', b.scene), 'beats');
  }
  for (const pp of p.plotPoints.values()) {
    const from = key('plot', pp.id);
    for (const c of pp.involves) add(from, key('character', c), 'involves');
    for (const t of pp.threads) add(from, key('thread', t), 'threads');
    if (pp.position.before) add(from, key('plot', pp.position.before), 'position.before');
    if (pp.position.after) add(from, key('plot', pp.position.after), 'position.after');
  }
  for (const ch of p.characters.values()) {
    const from = key('character', ch.id);
    for (const [scene, snap] of Object.entries(ch.state)) {
      add(from, key('scene', scene), 'state');
      for (const f of snap.knows) add(from, key('fact', f), `state.${scene}.knows`);
      for (const o of Object.keys(snap.feels)) add(from, key('character', o), `state.${scene}.feels`);
    }
  }
  for (const e of p.timeline.events) for (const s of e.scenes) add(`event:${e.id}`, key('scene', s), 'timeline');
  return refs;
}

/** Facts from all three sources. Extracted facts are what the prose actually says. */
export function collectFacts(p: Project): FactRow[] {
  const rows: FactRow[] = [];
  for (const s of p.scenes.values()) {
    for (const m of s.card.mentions)
      rows.push({ subject: m.character, predicate: 'mentions', object: m.fact, scene: s.id, confidence: 1, source: 'card' });
    for (const d of s.card.deltas) {
      for (const f of d.learns) rows.push({ subject: d.character, predicate: 'knows', object: f, scene: s.id, confidence: 1, source: 'card' });
      if (d.location) rows.push({ subject: d.character, predicate: 'located_at', object: d.location, scene: s.id, confidence: 1, source: 'card' });
      if (d.dies) rows.push({ subject: d.character, predicate: 'dies', object: 'true', scene: s.id, confidence: 1, source: 'card' });
    }
    for (const f of s.facts?.facts ?? [])
      rows.push({ subject: f.subject, predicate: f.predicate, object: f.object, scene: s.id, confidence: f.confidence, source: 'extracted' });
  }
  for (const ch of p.characters.values()) {
    for (const [scene, snap] of Object.entries(ch.state)) {
      for (const f of snap.knows) rows.push({ subject: ch.id, predicate: 'knows', object: f, scene, confidence: 1, source: 'state' });
      if (snap.location) rows.push({ subject: ch.id, predicate: 'located_at', object: snap.location, scene, confidence: 1, source: 'state' });
    }
  }
  return rows;
}

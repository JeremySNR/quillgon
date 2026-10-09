import type { AgentSuite, ExtractInput, ExtractOutput } from '../agents/contracts.js';
import type { Contradiction, Fact, SceneCard, StateSnapshot } from '../schemas/index.js';
import type { GraphStore } from '../store.js';
import { sceneOrder, stateBefore } from '../project.js';
import { factsDiff } from '../impact.js';
import { uniq } from '../util.js';

export function extractInput(store: GraphStore, sceneId: string, prose?: string): ExtractInput {
  const p = store.project;
  const s = store.scene(sceneId);
  const order = sceneOrder(p);
  return {
    card: s.card,
    prose: prose ?? s.prose?.body ?? '',
    characters: [...p.characters.values()].map((c) => ({ id: c.id, name: c.bio.name, aliases: c.bio.aliases })),
    facts: p.factGlossary.facts,
    locations: p.locations.locations.map((l) => ({ id: l.id, name: l.name })),
    states_before: s.card.characters.map((c) => ({ character: c, snapshot: stateBefore(p, c, sceneId, order)?.snapshot ?? null })),
  };
}

/** Mechanical card-vs-extraction comparison, on top of whatever the extractor itself reported. */
export function compareWithCard(card: SceneCard, out: ExtractOutput): Contradiction[] {
  const found: Contradiction[] = [...out.contradictions];
  const add = (c: Contradiction) => {
    if (!found.some((f) => f.field === c.field && f.card_says === c.card_says)) found.push(c);
  };
  for (const d of card.deltas) {
    const st = out.states.find((s) => s.character === d.character);
    for (const f of d.learns) {
      const learned = st?.learns.includes(f) || out.facts.some((x) => x.subject === d.character && x.predicate === 'knows' && x.object === f);
      if (!learned) add({ field: `deltas.${d.character}.learns`, card_says: `${d.character} learns ${f}`, prose_says: 'not established in the prose' });
    }
  }
  for (const f of card.reveals) {
    const somewhere = out.facts.some((x) => x.object === f) || out.states.some((s) => s.learns.includes(f));
    if (!somewhere) add({ field: 'reveals', card_says: `reveals ${f}`, prose_says: 'not revealed in the prose' });
  }
  for (const st of out.states) {
    if (!st.alive) add({ field: `characters.${st.character}`, card_says: `${st.character} is alive`, prose_says: `${st.character} dies` });
  }
  return found;
}

export interface ExtractionResult {
  scene: string;
  output: ExtractOutput;
  facts: Fact[];
  diff: ReturnType<typeof factsDiff>;
  contradictions: Contradiction[];
  /** Card rewritten to match what the prose established (for prose edits flowing back). */
  proposedCard: SceneCard;
  states: Record<string, StateSnapshot>;
}

/** Run the extractor and compute everything, without writing. */
export async function runExtraction(store: GraphStore, agents: AgentSuite, sceneId: string, prose?: string): Promise<ExtractionResult> {
  const input = extractInput(store, sceneId, prose);
  const output = await agents.extract(input);
  const s = store.scene(sceneId);
  const facts = output.facts;
  const diff = factsDiff(s.facts?.facts ?? [], facts);
  const contradictions = compareWithCard(s.card, output);

  // Snapshots at the end of this scene: state before + what the prose says changed.
  const states: Record<string, StateSnapshot> = {};
  for (const st of output.states) {
    const before = input.states_before.find((b) => b.character === st.character)?.snapshot;
    const knows = uniq([...(before?.knows ?? []), ...st.learns]).filter((f) => !st.forgets.includes(f));
    states[st.character] = {
      knows,
      wants: st.wants ?? before?.wants ?? '',
      feels: { ...(before?.feels ?? {}), ...st.feels },
      location: st.location ?? before?.location ?? s.card.location,
      alive: st.alive,
    };
  }

  // The card as the prose now tells it.
  const proposedCard: SceneCard = structuredClone(s.card);
  const mentions = facts.filter((f) => f.predicate === 'mentions').map((f) => ({ character: f.subject, fact: f.object }));
  if (mentions.length || s.card.mentions.length) proposedCard.mentions = mentions;
  proposedCard.deltas = output.states.map((st) => {
    const prevDelta = s.card.deltas.find((d) => d.character === st.character);
    return {
      character: st.character,
      learns: st.learns,
      forgets: st.forgets,
      ...(st.location ? { location: st.location } : prevDelta?.location ? { location: prevDelta.location } : {}),
      ...(prevDelta?.wants ? { wants: prevDelta.wants } : {}),
      ...(!st.alive ? { dies: true } : {}),
    };
  });
  const present = uniq([...s.card.characters, ...output.states.map((st) => st.character)]).filter((c) => store.project.characters.has(c));
  proposedCard.characters = present;
  const revealed = uniq(output.states.flatMap((st) => st.learns)).filter((f) => !input.states_before.every((b) => b.snapshot?.knows.includes(f)));
  proposedCard.reveals = uniq([...s.card.reveals.filter((f) => revealed.includes(f) || facts.some((x) => x.object === f)), ...revealed.filter((f) => !s.card.reveals.includes(f) && card_isNew(store, sceneId, f))]);

  return { scene: sceneId, output, facts, diff, contradictions, proposedCard, states };
}

/** A fact is newly revealed here if no earlier scene card reveals it. */
function card_isNew(store: GraphStore, sceneId: string, fact: string): boolean {
  const order = store.order();
  const idx = order.indexOf(sceneId);
  return !order.slice(0, idx).some((id) => store.scene(id).card.reveals.includes(fact));
}

/**
 * Write an extraction into the graph: facts.yaml, per-scene state snapshots, new facts,
 * timeline events, and the prose's last_extracted hash. Contradictions are recorded on the
 * scene (flagged, not silently accepted).
 */
export function applyExtraction(store: GraphStore, r: ExtractionResult, opts: { adoptCard?: boolean } = {}) {
  const p = store.project;
  store.addFacts(r.output.new_facts);
  for (const [ch, snap] of Object.entries(r.states)) {
    const entry = p.characters.get(ch);
    if (!entry) continue;
    store.saveCharacterState(ch, { ...entry.state, [r.scene]: snap });
  }
  if (r.output.timeline.length) {
    const tl = structuredClone(p.timeline);
    for (const ev of r.output.timeline) {
      const existing = tl.events.find((e) => e.description === ev.description);
      if (existing) existing.scenes = uniq([...existing.scenes, r.scene]);
      else tl.events.push({ id: `e-${r.scene}-${tl.events.length + 1}`, when: ev.when, description: ev.description, scenes: [r.scene] });
    }
    store.saveTimeline(tl);
  }
  if (opts.adoptCard) store.saveCard(r.proposedCard, { adoptIntoProse: true });
  store.markExtracted(r.scene, { facts: r.facts, contradictions: opts.adoptCard ? [] : r.contradictions });
}

/**
 * Extraction accuracy against a reference (the fixture's facts.yaml): precision, recall
 * and F1 over (subject, predicate, object) triples, ignoring confidence.
 */
export function scoreFacts(expected: Fact[], actual: Fact[]) {
  const k = (f: Fact) => `${f.subject}|${f.predicate}|${f.object}`;
  const e = new Set(expected.map(k));
  const a = new Set(actual.map(k));
  const tp = [...a].filter((x) => e.has(x)).length;
  const precision = a.size ? tp / a.size : 1;
  const recall = e.size ? tp / e.size : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, missing: [...e].filter((x) => !a.has(x)), extra: [...a].filter((x) => !e.has(x)) };
}

import type { AgentSuite } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import type { Change } from '../impact.js';
import { analyseImpact } from '../impact.js';
import { Pipeline } from './pipeline.js';
import { Ripple } from './ripple.js';
import { runContinuity } from '../quality/continuity.js';
import { runVoiceReport } from '../quality/voice.js';
import { runReader } from '../quality/reader.js';
import { estimate } from './estimate.js';
import { Ideation } from './ideation.js';
import { Interviews } from './interview.js';
import { critiquePlan, critiqueAlternatives, predictability } from './critics.js';
import { runStyleCheck } from '../style-report.js';
import type { StructureAlternative } from '../agents/contracts.js';
import { sceneOrder } from '../project.js';
import type { StateSnapshot } from '../schemas/index.js';
import { uniq } from '../util.js';

/** One object the CLI and server hold: the store, the agents, and every pipeline. */
export class Engine {
  readonly pipeline: Pipeline;
  readonly ideation: Ideation;
  readonly interviews: Interviews;
  constructor(
    readonly store: GraphStore,
    readonly agents: AgentSuite,
  ) {
    this.pipeline = new Pipeline(store, agents);
    this.ideation = new Ideation(store, agents);
    this.interviews = new Interviews(store, agents);
  }

  critique() {
    return critiquePlan(this.store, this.agents);
  }

  critiqueAlternatives(alts: StructureAlternative[]) {
    return critiqueAlternatives(this.store, this.agents, alts);
  }

  predictability(scene: string) {
    return predictability(this.store, this.agents, scene);
  }

  styleCheck() {
    return runStyleCheck(this.store);
  }

  /**
   * Edit a character's state at the end of a scene. Knowledge carries forward, so a fact
   * removed (or added) here is removed from (or added to) later snapshots until a scene
   * whose card teaches (or makes them forget) it. Returns the change, ready for a ripple.
   */
  editState(character: string, scene: string, next: StateSnapshot): Change {
    const ch = this.store.project.characters.get(character);
    if (!ch) throw new Error(`unknown character "${character}"`);
    const before = ch.state[scene] ? structuredClone(ch.state[scene]) : null;
    const removed = (before?.knows ?? []).filter((f) => !next.knows.includes(f));
    const added = next.knows.filter((f) => !(before?.knows ?? []).includes(f));
    const state = { ...structuredClone(ch.state), [scene]: next };
    const order = sceneOrder(this.store.project);
    const teaches = (sid: string, f: string) => {
      const c = this.store.project.scenes.get(sid)?.card;
      return !!c && (c.deltas.some((d) => d.character === character && d.learns.includes(f)) || (c.reveals.includes(f) && c.characters.includes(character)));
    };
    const forgets = (sid: string, f: string) => !!this.store.project.scenes.get(sid)?.card.deltas.some((d) => d.character === character && d.forgets.includes(f));
    const open = { removed: new Set(removed), added: new Set(added) };
    for (const sid of order.slice(order.indexOf(scene) + 1)) {
      for (const f of [...open.removed]) if (teaches(sid, f)) open.removed.delete(f);
      for (const f of [...open.added]) if (forgets(sid, f)) open.added.delete(f);
      const snap = state[sid];
      if (!snap) continue;
      state[sid] = { ...snap, knows: uniq([...snap.knows.filter((f) => !open.removed.has(f)), ...open.added]) };
    }
    this.store.saveCharacterState(character, state);
    return { kind: 'state', character, scene, before, after: next };
  }

  impact(change: Change) {
    return analyseImpact(this.store.project, change, this.store.index);
  }

  startRipple(change: Change, opts?: { hopLimit?: number; roundCap?: number }) {
    return Ripple.start(this.store, this.agents, change, opts);
  }

  ripple(id?: string) {
    return id ? Ripple.load(this.store, this.agents, id) : Ripple.current(this.store, this.agents);
  }

  continuity(opts?: Parameters<typeof runContinuity>[2]) {
    return runContinuity(this.store, this.agents, opts);
  }

  voice() {
    return runVoiceReport(this.store);
  }

  reader(opts?: Parameters<typeof runReader>[2]) {
    return runReader(this.store, this.agents, opts);
  }

  estimate() {
    return estimate(this.store.project);
  }
}

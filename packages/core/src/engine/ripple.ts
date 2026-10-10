import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentSuite, ReviseCardInput } from '../agents/contracts.js';
import { SceneCard } from '../schemas/index.js';
import type { GraphStore } from '../store.js';
import { paths, sceneOrder, stateBefore, type Project } from '../project.js';
import { analyseImpact, cardDiffSummary, changeFiles, partitionImpacts, type Change, type Impact } from '../impact.js';
import { applyExtraction, runExtraction } from './extraction.js';
import type { Progress } from './style-passes.js';
import { cardHash } from '../sync.js';
import { timestamp } from '../util.js';
import { relevantFacts } from '../scope.js';

export type ItemStatus = 'pending' | 'proposed' | 'accepted' | 'rejected' | 'no_change' | 'conflict' | 'resolved' | 'error';
export type ProseStatus = 'none' | 'pending' | 'proposed' | 'accepted' | 'rejected' | 'locked';

export interface RippleItem {
  scene: string;
  title: string;
  hop: Impact['hop'];
  reasons: string[];
  confidence: number;
  /** 'origin' = the edited scene itself (card already changed; prose must follow). */
  kind: 'origin' | 'card' | 'conflict';
  status: ItemStatus;
  card: { before: SceneCard; after: SceneCard | null; justification: string; needs_decision: string[] } | null;
  prose: { status: ProseStatus; before: string; after: string | null; summary: string };
  conflict: { lock: SceneCard['lock']; status: SceneCard['status']; resolution: null | 'unlock' | 'keep' | 'revert' } | null;
  error: string | null;
}

export interface RippleRound {
  n: number;
  items: RippleItem[];
  /** Beyond the hop limit (similarity-only): listed, never proposed unless expanded. */
  listed: Impact[];
  applied: boolean;
  commit: string | null;
}

export interface RippleData {
  id: string;
  created: string;
  description: string;
  change: Change;
  originCommit: string | null;
  hopLimit: number;
  roundCap: number;
  rounds: RippleRound[];
  state: 'reviewing' | 'done' | 'capped' | 'reverted' | 'abandoned';
  /** Scenes already handled in any round; the cascade never revisits them. */
  handled: string[];
  /** When the cap stops the cascade: what is still inconsistent. */
  remaining: Impact[];
}

/**
 * A ripple: a change to the graph followed by a bounded, reviewable pass that brings the
 * rest of the book into line. Nothing is applied without the author accepting it; each
 * applied round is one git commit; the whole ripple can be reverted.
 */
export class Ripple {
  constructor(
    private store: GraphStore,
    private agents: AgentSuite,
    public data: RippleData,
  ) {}

  // ------------------------------------------------------------- persistence

  static dir(store: GraphStore) {
    return path.join(store.dir, paths.engine, 'ripple');
  }

  save() {
    const d = Ripple.dir(this.store);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${this.data.id}.json`), JSON.stringify(this.data, null, 2));
  }

  static load(store: GraphStore, agents: AgentSuite, id: string): Ripple {
    const f = path.join(Ripple.dir(store), `${id}.json`);
    if (!fs.existsSync(f)) throw new Error(`no ripple "${id}"`);
    return new Ripple(store, agents, JSON.parse(fs.readFileSync(f, 'utf8')));
  }

  static list(store: GraphStore): RippleData[] {
    const d = Ripple.dir(store);
    if (!fs.existsSync(d)) return [];
    return fs
      .readdirSync(d)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) as RippleData)
      .sort((a, b) => b.created.localeCompare(a.created));
  }

  static current(store: GraphStore, agents: AgentSuite): Ripple | null {
    const open = Ripple.list(store).find((r) => r.state === 'reviewing');
    return open ? new Ripple(store, agents, open) : null;
  }

  // ------------------------------------------------------------- start

  /**
   * Start a ripple for a change the author has already made through the store.
   * The originating edit is committed first, so the whole ripple can be reverted. Any other
   * uncommitted work is checkpointed separately beforehand, so a revert cannot undo it.
   */
  static async start(store: GraphStore, agents: AgentSuite, change: Change, opts: { hopLimit?: number; roundCap?: number } = {}): Promise<Ripple> {
    const existing = Ripple.current(store, agents);
    if (existing) existing.abandon();
    const impact = analyseImpact(store.project, change, store.index);
    const files = changeFiles(change, store.uncommitted());
    await store.checkpoint('Work in progress before a ripple', { exclude: files });
    const originCommit = await store.commit(`Edit: ${impact.description}`, { files });
    const r = new Ripple(store, agents, {
      // Second-granular timestamps collide when two ripples start in the same second.
      id: `${timestamp()}-${randomBytes(2).toString('hex')}`,
      created: new Date().toISOString(),
      description: impact.description,
      change,
      originCommit,
      hopLimit: opts.hopLimit ?? store.book.ripple.hop_limit,
      roundCap: opts.roundCap ?? store.book.ripple.round_cap,
      rounds: [],
      state: 'reviewing',
      handled: [],
      remaining: [],
    });
    r.addRound(impact.impacts, change);
    r.save();
    return r;
  }

  private addRound(impacts: Impact[], change: Change | null) {
    const n = this.data.rounds.length + 1;
    const { conflicts, proposals, listed } = partitionImpacts(impacts, this.data.hopLimit);
    const items: RippleItem[] = [];
    for (const i of [...conflicts, ...proposals]) {
      if (this.data.handled.includes(i.scene)) continue;
      const s = this.store.project.scenes.get(i.scene);
      if (!s) continue;
      const isOrigin = i.hop === 0 && change?.kind === 'card' && change.scene === i.scene;
      const proseLocked = s.card.lock === 'prose' || s.card.lock === 'both';
      const base = {
        scene: i.scene,
        title: s.card.title,
        hop: i.hop,
        reasons: i.reasons,
        confidence: i.confidence,
        error: null,
      };
      if (isOrigin && change?.kind === 'card') {
        items.push({
          ...base,
          kind: proseLocked ? 'conflict' : 'origin',
          status: proseLocked ? 'conflict' : 'accepted',
          card: { before: change.before, after: change.after, justification: 'edited by the author', needs_decision: [] },
          prose: { status: s.prose ? (proseLocked ? 'locked' : 'pending') : 'none', before: s.prose?.body ?? '', after: null, summary: '' },
          conflict: proseLocked ? { lock: s.card.lock, status: s.card.status, resolution: null } : null,
        });
      } else if (i.conflict) {
        items.push({
          ...base,
          kind: 'conflict',
          status: 'conflict',
          card: null,
          prose: { status: 'none', before: s.prose?.body ?? '', after: null, summary: '' },
          conflict: { lock: i.conflict.lock, status: i.conflict.status, resolution: null },
        });
      } else {
        items.push({
          ...base,
          kind: 'card',
          status: 'pending',
          card: null,
          prose: { status: 'none', before: s.prose?.body ?? '', after: null, summary: '' },
          conflict: null,
        });
      }
      this.data.handled.push(i.scene);
    }
    // Conflicts first, then story order.
    const order = sceneOrder(this.store.project);
    items.sort((a, b) => Number(b.kind === 'conflict') - Number(a.kind === 'conflict') || order.indexOf(a.scene) - order.indexOf(b.scene));
    this.data.rounds.push({ n, items, listed: listed.filter((l) => !this.data.handled.includes(l.scene)), applied: false, commit: null });
  }

  get round(): RippleRound {
    return this.data.rounds[this.data.rounds.length - 1];
  }

  item(scene: string): RippleItem {
    const it = this.round.items.find((i) => i.scene === scene);
    if (!it) throw new Error(`${scene} is not in round ${this.round.n}`);
    return it;
  }

  // ------------------------------------------------------------- step 2: card proposals

  /** Ask the reviser for each pending card, in story order (or just one scene). */
  async propose(scene?: string, progress: Progress = () => undefined) {
    const p = this.store.project;
    // A failed proposal (network, model refusal) is retried by proposing again.
    const targets = this.round.items.filter((i) => i.kind === 'card' && (i.status === 'pending' || i.status === 'error') && (!scene || i.scene === scene));
    for (const it of targets) {
      progress('propose', `Reviewing ${it.scene} "${it.title}"`);
      it.error = null;
      const card = this.store.scene(it.scene).card;
      try {
        const out = await this.agents.reviseCard(reviseCardInput(p, it.scene, this.data.description, it.reasons));
        if (out.action === 'no_change' || !out.card) {
          it.status = 'no_change';
          it.card = { before: card, after: null, justification: out.justification, needs_decision: out.needs_decision };
        } else {
          const after = SceneCard.parse({ ...out.card, id: it.scene, status: card.status, lock: card.lock });
          if (cardHash(after) === cardHash(card)) {
            it.status = 'no_change';
            it.card = { before: card, after: null, justification: out.justification, needs_decision: out.needs_decision };
          } else {
            it.status = 'proposed';
            it.card = { before: card, after, justification: out.justification, needs_decision: out.needs_decision };
          }
        }
      } catch (e) {
        it.status = 'error';
        it.error = (e as Error).message;
      }
      this.save();
    }
  }

  accept(scene: string, edited?: unknown) {
    const it = this.item(scene);
    if (it.kind === 'conflict') throw new Error(`${scene} is a conflict; resolve it first`);
    if (!it.card) throw new Error(`${scene} has no proposal yet`);
    // An edited proposal keeps the scene's own status and lock: the reviser never changes those.
    if (edited) it.card.after = SceneCard.parse({ ...(edited as object), id: scene, status: it.card.before.status, lock: it.card.before.lock });
    if (!it.card.after) throw new Error(`${scene}: nothing to accept (no_change)`);
    it.status = 'accepted';
    const s = this.store.scene(scene);
    const proseLocked = s.card.lock === 'prose' || s.card.lock === 'both';
    it.prose = { status: s.prose ? (proseLocked ? 'locked' : 'pending') : 'none', before: s.prose?.body ?? '', after: null, summary: '' };
    this.save();
  }

  reject(scene: string) {
    const it = this.item(scene);
    it.status = 'rejected';
    it.prose.status = 'none';
    this.save();
  }

  /** Re-open a decided item (undo). */
  reopen(scene: string) {
    const it = this.item(scene);
    if (it.kind !== 'card') return;
    it.status = it.card?.after ? 'proposed' : 'pending';
    it.prose = { status: 'none', before: it.prose.before, after: null, summary: '' };
    this.save();
  }

  // ------------------------------------------------------------- step 3: prose

  async proposeProse(scene?: string, progress: Progress = () => undefined) {
    const p = this.store.project;
    const targets = this.round.items.filter((i) => i.prose.status === 'pending' && i.card?.after && (!scene || i.scene === scene));
    for (const it of targets) {
      progress('prose', `Revising prose of ${it.scene} "${it.title}"`);
      const nc = it.card!.after!;
      const voices = nc.characters.filter((c) => p.characters.has(c)).map((c) => ({ character: c, name: p.characters.get(c)!.bio.name, voice: p.characters.get(c)!.voice }));
      try {
        const out = await this.agents.reviseProse({ intent: p.intent, change: this.data.description, old_card: it.card!.before, new_card: nc, old_prose: it.prose.before, voices });
        it.prose.after = out.prose;
        it.prose.summary = out.summary;
        it.prose.status = 'proposed';
      } catch (e) {
        it.error = (e as Error).message;
      }
      this.save();
    }
  }

  acceptProse(scene: string, edited?: string) {
    const it = this.item(scene);
    if (edited !== undefined) it.prose.after = edited;
    if (!it.prose.after) throw new Error(`${scene}: no prose proposal`);
    it.prose.status = 'accepted';
    this.save();
  }

  rejectProse(scene: string) {
    const it = this.item(scene);
    it.prose.status = 'rejected';
    this.save();
  }

  // ------------------------------------------------------------- conflicts

  async resolveConflict(scene: string, resolution: 'unlock' | 'keep' | 'revert') {
    const it = this.item(scene);
    if (!it.conflict) throw new Error(`${scene} is not a conflict`);
    it.conflict.resolution = resolution;
    if (resolution === 'revert') {
      await this.revert();
      return;
    }
    if (resolution === 'unlock') {
      this.store.setSceneStatus(scene, { lock: 'none', status: 'draft' });
      const s = this.store.scene(scene);
      if (it.card && it.kind === 'conflict' && it.card.justification === 'edited by the author') {
        it.kind = 'origin';
        it.status = 'accepted';
        it.prose = { status: s.prose ? 'pending' : 'none', before: s.prose?.body ?? '', after: null, summary: '' };
      } else {
        it.kind = 'card';
        it.status = 'pending';
      }
    } else {
      it.status = 'resolved';
    }
    this.save();
  }

  /** Bring a listed (beyond hop limit) scene into this round. */
  expand(scene: string) {
    const i = this.round.listed.findIndex((l) => l.scene === scene);
    if (i < 0) throw new Error(`${scene} is not listed`);
    const [imp] = this.round.listed.splice(i, 1);
    const s = this.store.scene(scene);
    this.round.items.push({
      scene,
      title: s.card.title,
      hop: imp.hop,
      reasons: imp.reasons,
      confidence: imp.confidence,
      kind: imp.conflict ? 'conflict' : 'card',
      status: imp.conflict ? 'conflict' : 'pending',
      card: null,
      prose: { status: 'none', before: s.prose?.body ?? '', after: null, summary: '' },
      conflict: imp.conflict ? { lock: imp.conflict.lock, status: imp.conflict.status, resolution: null } : null,
      error: null,
    });
    this.data.handled.push(scene);
    this.save();
  }

  // ------------------------------------------------------------- apply + cascade

  /** What still needs a decision before the round can be applied. */
  blockers(): string[] {
    const out: string[] = [];
    for (const it of this.round.items) {
      if (it.status === 'pending' || it.status === 'proposed' || it.status === 'error') out.push(`${it.scene}: card ${it.status}`);
      if (it.status === 'conflict') out.push(`${it.scene}: unresolved conflict`);
      if (it.prose.status === 'pending' || it.prose.status === 'proposed') out.push(`${it.scene}: prose ${it.prose.status}`);
    }
    return out;
  }

  /**
   * Step 4. Write accepted cards and prose, commit the round, then re-run impact analysis on
   * the cards that changed. New hop-1 scenes become the next round, up to the cap.
   */
  async apply(progress: Progress = () => undefined, opts: { extract?: boolean } = {}): Promise<RippleRound> {
    const blockers = this.blockers();
    if (blockers.length) throw new Error(`round ${this.round.n} still needs decisions:\n${blockers.join('\n')}`);
    const round = this.round;
    // Commit the round alone: earlier work (an autosave elsewhere during review) goes first.
    await this.store.commit('Work in progress before a ripple round');
    const mark = this.store.writeMark();
    const changed: { scene: string; before: SceneCard; after: SceneCard }[] = [];
    for (const it of round.items) {
      if ((it.status === 'accepted') && it.card?.after && it.kind === 'card') {
        this.store.saveCard(it.card.after);
        changed.push({ scene: it.scene, before: it.card.before, after: it.card.after });
      }
      if (it.prose.status === 'accepted' && it.prose.after) {
        progress('apply', `Writing ${it.scene}`);
        this.store.saveProse(it.scene, it.prose.after, 'generated');
        if (opts.extract !== false) {
          progress('extract', `Reading ${it.scene} back into the graph`);
          const ex = await runExtraction(this.store, this.agents, it.scene);
          applyExtraction(this.store, ex);
        }
      }
      if (it.conflict?.resolution === 'keep') {
        const line = `- ${new Date().toISOString().slice(0, 10)} · ${it.scene} "${it.title}" kept locked despite: ${this.data.description}. ${it.reasons.join('; ')}`;
        const existing = this.store.readReport('known-inconsistencies.md') ?? '# Known inconsistencies\n\nLocked scenes the author chose to keep despite a change elsewhere.\n\n';
        this.store.writeReport('known-inconsistencies.md', existing + line + '\n');
      }
    }
    const touched = round.items.filter((i) => i.status === 'accepted' || i.prose.status === 'accepted').map((i) => i.scene);
    const kept = round.items.filter((i) => i.conflict?.resolution === 'keep').map((i) => i.scene);
    const msg = [
      `Ripple round ${round.n}: ${this.data.description}`,
      '',
      touched.length ? `Revised: ${touched.join(', ')}` : 'No scenes revised',
      ...(kept.length ? [`Kept locked: ${kept.join(', ')}`] : []),
      ...round.items.filter((i) => i.status === 'no_change').map((i) => `No change needed in ${i.scene}: ${i.card?.justification ?? ''}`),
    ].join('\n');
    // Only this round's writes: an author's autosave in another scene during a slow
    // extraction is left for its own commit, so reverting the ripple cannot undo it.
    const inRound = new Set(round.items.map((i) => i.scene));
    const files = this.store.writtenSince(mark).filter((f) => {
      const scene = /^scenes\/([^/]+)\//.exec(f)?.[1];
      return !scene || inRound.has(scene);
    });
    round.commit = await this.store.commit(msg, { files });
    round.applied = true;

    // Cascade: impact of the accepted card changes.
    const next: Impact[] = [];
    for (const c of changed) {
      if (!cardDiffSummary(c.before, c.after).length) continue;
      const imp = analyseImpact(this.store.project, { kind: 'card', scene: c.scene, before: c.before, after: c.after }, this.store.index, { similarity: false });
      for (const i of imp.impacts) {
        if (i.hop !== 1 || this.data.handled.includes(i.scene) || next.some((n) => n.scene === i.scene)) continue;
        next.push(i);
      }
    }
    if (!next.length) {
      this.data.state = 'done';
    } else if (this.data.rounds.length >= this.data.roundCap) {
      this.data.state = 'capped';
      this.data.remaining = next;
    } else {
      this.addRound(next, null);
    }
    this.save();
    return round;
  }

  /**
   * Revert every commit this ripple made, including the originating edit, as one commit.
   * All or nothing: if the author has since changed the same files, nothing is reverted
   * and the error names them.
   */
  async revert() {
    const hashes = [...this.data.rounds.map((r) => r.commit).filter((h): h is string => !!h).reverse(), ...(this.data.originCommit ? [this.data.originCommit] : [])];
    try {
      await this.store.revertCommits(hashes, `Revert ripple: ${this.data.description}`);
    } finally {
      this.store.reload();
    }
    if (!this.data.originCommit) await this.restoreOrigin();
    this.data.state = 'reverted';
    this.save();
  }

  /** The originating edit was committed before the ripple started: put it back from the change. */
  private async restoreOrigin() {
    const c = this.data.change;
    if (c.kind === 'delete-scene' || c.kind === 'character') {
      // No "before" is kept in the change for these: restore every file the commit that made
      // the edit touched (the scene, and the state files a deletion rewrote) from its parent.
      const dir = c.kind === 'delete-scene' ? `scenes/${c.scene}` : `characters/${c.character}`;
      const commit = await this.lastCommitBefore(dir);
      if (commit) {
        const files = (await this.store.repo.show(commit)).files.filter((f) => f.startsWith(`${dir}/`) || (c.kind === 'delete-scene' && /^characters\/[^/]+\/state\.yaml$/.test(f)));
        await this.store.repo.restore(`${commit}~1`, files);
      }
      this.store.reload();
      if (c.kind === 'delete-scene' && commit) {
        const st = structuredClone(this.store.project.structure);
        const chapters = st.acts.flatMap((a) => a.chapters);
        const prevIdx = c.orderBefore.indexOf(c.scene) - 1;
        const prev = prevIdx >= 0 ? c.orderBefore[prevIdx] : null;
        const ch = (prev && chapters.find((x) => x.scenes.includes(prev))) || chapters[0];
        if (ch && !chapters.some((x) => x.scenes.includes(c.scene))) {
          ch.scenes.splice(prev ? ch.scenes.indexOf(prev) + 1 : 0, 0, c.scene);
          this.store.saveStructure(st);
        }
      }
      // Files restored by git are not store writes: commit the whole tree.
      await this.store.checkpoint(`Revert: ${this.data.description}`);
      return;
    }
    if (c.kind === 'card') this.store.saveCard(c.before);
    else if (c.kind === 'state') {
      const ch = this.store.project.characters.get(c.character);
      if (ch) {
        const { [c.scene]: _drop, ...rest } = ch.state;
        this.store.saveCharacterState(c.character, c.before ? { ...rest, [c.scene]: c.before } : rest);
      }
    } else if (c.kind === 'thread') c.before ? this.store.saveThread(c.before) : c.after && this.store.deleteThread(c.after.id);
    else if (c.kind === 'plot') c.before ? this.store.savePlotPoint(c.before) : c.after && this.store.deletePlotPoint(c.after.id);
    else if (c.kind === 'obligation') c.before ? this.store.saveObligation(c.before) : c.after && this.store.deleteObligation(c.after.id);
    else if (c.kind === 'reorder') {
      const st = structuredClone(this.store.project.structure);
      let i = 0;
      for (const a of st.acts) for (const ch of a.chapters) ch.scenes = ch.scenes.map(() => c.before[i++]);
      this.store.saveStructure(st);
    }
    await this.store.commit(`Revert: ${this.data.description}`);
  }

  /** The newest commit touching anything under `dir`, made before this ripple started. */
  private async lastCommitBefore(dir: string): Promise<string | null> {
    const started = Date.parse(this.data.created);
    const log = await this.store.repo.git.raw(['log', '--format=%H %cI', '--', `:(literal)${dir}`]).catch(() => '');
    for (const line of log.split('\n').filter(Boolean)) {
      const [hash, date] = line.split(' ');
      if (Date.parse(date) <= started + 1000) return hash;
    }
    return null;
  }

  abandon() {
    this.data.state = 'abandoned';
    this.save();
  }

  summary() {
    const all = this.data.rounds.flatMap((r) => r.items);
    return {
      id: this.data.id,
      description: this.data.description,
      state: this.data.state,
      round: this.round?.n ?? 0,
      cap: this.data.roundCap,
      counts: {
        conflicts: all.filter((i) => i.status === 'conflict').length,
        pending: all.filter((i) => i.status === 'pending' || i.status === 'proposed').length,
        accepted: all.filter((i) => i.status === 'accepted').length,
        rejected: all.filter((i) => i.status === 'rejected').length,
        no_change: all.filter((i) => i.status === 'no_change').length,
      },
    };
  }
}

/** What the card reviser sees for one scene: the card, who knows what, and the facts in play. */
export function reviseCardInput(p: Project, sceneId: string, change: string, reasons: string[]): ReviseCardInput {
  const card = p.scenes.get(sceneId)!.card;
  const statesBefore = card.characters.map((c) => ({ character: c, knows: stateBefore(p, c, sceneId)?.snapshot.knows ?? [] }));
  return {
    intent: p.intent,
    change,
    reasons,
    card,
    facts: relevantFacts(p, {
      must: [...card.reveals, ...card.mentions.map((m) => m.fact), ...statesBefore.flatMap((s) => s.knows)],
      query: `${change} ${reasons.join(' ')} ${card.purpose} ${card.outcome}`,
    }),
    characters: [...p.characters.values()].map((c) => ({ id: c.id, name: c.bio.name })),
    states_before: statesBefore,
  };
}

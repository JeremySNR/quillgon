import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentSuite,
  CardsInput,
  CardsOutput,
  InterviewOutput,
  StructureAlternative,
  StructureOutput,
} from '../agents/contracts.js';
import { Intent, SceneCard, type PipelineStage, type StateSnapshot } from '../schemas/index.js';
import type { GraphStore } from '../store.js';
import { paths, sceneOrder } from '../project.js';
import { canGenerate, cardHash, sceneSync } from '../sync.js';
import { writerContext } from '../context.js';
import { relevantFacts, unrevealedFacts, wordsPerScene } from '../scope.js';
import { fromYaml, slugify, uniq } from '../util.js';
import { runStylePasses, type Progress, type StylePassReport } from './style-passes.js';
import { resolveObligationScenes } from '../obligations.js';
import { recordStyleReport } from '../style-report.js';
import { applyExtraction, runExtraction, type ExtractionResult } from './extraction.js';

/** Transient planner output awaiting the author's choice. Lives in .engine/ (not committed). */
export class Proposals {
  constructor(private dir: string) {}
  private file(name: string) {
    return path.join(this.dir, paths.engine, 'proposals', `${name}.json`);
  }
  get<T>(name: string): T | null {
    const f = this.file(name);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T) : null;
  }
  set(name: string, value: unknown) {
    const f = this.file(name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(value, null, 2));
  }
  delete(name: string) {
    fs.rmSync(this.file(name), { force: true });
  }
  list(): string[] {
    const d = path.join(this.dir, paths.engine, 'proposals');
    return fs.existsSync(d) ? fs.readdirSync(d).map((f) => f.replace(/\.json$/, '')) : [];
  }
}

export interface InterviewState {
  premise: string;
  answers: { question: string; answer: string }[];
  questions: string[];
  intent: InterviewOutput['intent'] | null;
  needs_decision: string[];
}

export interface WriteResult {
  scene: string;
  words: number;
  style: StylePassReport | null;
  extraction: ExtractionResult;
  needs_decision: string[];
}

const STAGES: PipelineStage[] = ['idea', 'intent', 'plot-points', 'structure', 'cards', 'prose', 'complete'];

/**
 * The generation pipeline. Five layers, top-down, each a gate the author passes:
 * intent → plot points → structure (3 alternatives) → scene cards (2 per chapter) → prose.
 * Nothing below a gate is generated until the gate is passed.
 */
export class Pipeline {
  readonly proposals: Proposals;
  constructor(
    readonly store: GraphStore,
    readonly agents: AgentSuite,
  ) {
    this.proposals = new Proposals(store.dir);
  }

  private get p() {
    return this.store.project;
  }

  private advance(stage: PipelineStage) {
    if (STAGES.indexOf(stage) > STAGES.indexOf(this.p.book.stage)) this.store.updateBook({ stage });
  }

  // ---------------------------------------------------------------- 1. intent

  async interview(premise: string, answers: { question: string; answer: string }[] = []): Promise<InterviewState> {
    const out = await this.agents.interview({ premise, answers });
    const state: InterviewState = {
      premise,
      answers,
      questions: out.done ? [] : out.questions,
      intent: out.done ? (out.intent ?? null) : null,
      needs_decision: out.needs_decision,
    };
    this.proposals.set('interview', state);
    return state;
  }

  async approveIntent(intent: Partial<Intent>) {
    const saved = this.store.saveIntent({ ...Intent.parse({}), ...this.p.intent, ...intent, approved: true });
    this.proposals.delete('interview');
    this.advance('plot-points');
    await this.store.commit('Intent approved');
    return saved;
  }

  // ---------------------------------------------------------------- 2. plot points

  pinPlotPoint(pp: { id?: string; title?: string; description: string; position?: object; involves?: string[]; threads?: string[] }) {
    const id = pp.id ?? this.freeId('pp-' + slugify(pp.title || pp.description).slice(0, 30), (x) => this.p.plotPoints.has(x));
    return this.store.savePlotPoint({ ...pp, id, locked: true, proposed: false });
  }

  async proposePlotPoints(): Promise<{ created: string[]; needs_decision: string[] }> {
    const pinned = [...this.p.plotPoints.values()].filter((x) => !x.proposed);
    const cast = [...this.p.characters.values()].map((c) => ({ id: c.id, name: c.bio.name, role: c.bio.role }));
    const out = await this.agents.plotPoints({ intent: this.p.intent, pinned, cast, target_words: this.p.book.target_words });
    const created: string[] = [];
    for (const pp of out.plot_points) {
      if (pinned.some((x) => x.id === pp.id)) continue;
      const id = this.p.plotPoints.has(pp.id) ? this.freeId(pp.id, (x) => this.p.plotPoints.has(x)) : pp.id;
      // Planner may reference cast members that do not exist yet; keep only known or proposed ids.
      this.store.savePlotPoint({ ...pp, id, threads: [], involves: pp.involves, locked: false, proposed: true });
      created.push(id);
    }
    const existingCast = this.proposals.get<typeof out.cast>('cast') ?? [];
    this.proposals.set('cast', uniqBy([...existingCast, ...out.cast], (c) => c.id));
    return { created, needs_decision: out.needs_decision };
  }

  acceptPlotPoint(id: string, edits: object = {}) {
    const pp = this.p.plotPoints.get(id);
    if (!pp) throw new Error(`unknown plot point "${id}"`);
    return this.store.savePlotPoint({ ...pp, ...edits, proposed: false });
  }

  rejectPlotPoint(id: string) {
    this.store.deletePlotPoint(id);
  }

  async finishPlotPoints() {
    const pending = [...this.p.plotPoints.values()].filter((x) => x.proposed);
    if (pending.length) throw new Error(`accept or reject the ${pending.length} proposed plot point(s) first`);
    this.advance('structure');
    await this.store.commit('Plot points settled');
  }

  // ---------------------------------------------------------------- 3. structure

  async proposeStructures(opts: { more?: boolean } = {}): Promise<StructureOutput> {
    const previous = opts.more ? (this.proposals.get<StructureOutput>('structures')?.alternatives ?? []) : [];
    const cast = uniqBy(
      [...[...this.p.characters.values()].map((c) => ({ id: c.id, name: c.bio.name, role: c.bio.role })), ...(this.proposals.get<{ id: string; name: string; role: string }[]>('cast') ?? [])],
      (c) => c.id,
    );
    const out = await this.agents.structures({
      intent: this.p.intent,
      plot_points: [...this.p.plotPoints.values()],
      cast,
      target_words: this.p.book.target_words,
      avoid: previous.map((a) => `${a.label}: ${a.rationale}`),
    });
    const merged: StructureOutput = { alternatives: [...previous, ...out.alternatives], needs_decision: out.needs_decision };
    this.proposals.set('structures', merged);
    this.proposals.delete('structure-critiques');
    return merged;
  }

  async pickStructure(index: number): Promise<StructureAlternative> {
    const alts = this.proposals.get<StructureOutput>('structures');
    const alt = alts?.alternatives[index];
    if (!alt) throw new Error(`no structure alternative #${index}`);
    for (const c of alt.characters) {
      const prev = this.p.characters.get(c.bio.id);
      this.store.saveCharacter({ bio: c.bio, voice: c.voice, state: prev?.state ?? {} });
    }
    for (const t of alt.threads) {
      this.store.saveThread({ ...t, setup_scene: null, payoff_scene: null, beats: [], status: 'planned' });
    }
    this.store.saveStructure({
      acts: alt.acts.map((a) => ({
        id: a.id,
        title: a.title,
        chapters: a.chapters.map((c) => ({ id: c.id, title: c.title, summary: c.summary, planned_scenes: c.scene_count, scenes: [] })),
      })),
    });
    // Plot points may name cast members that only now exist; drop dangling ids.
    for (const pp of this.p.plotPoints.values()) {
      const involves = pp.involves.filter((c) => this.p.characters.has(c));
      const threads = pp.threads.filter((t) => this.p.threads.has(t));
      if (involves.length !== pp.involves.length || threads.length !== pp.threads.length) this.store.savePlotPoint({ ...pp, involves, threads });
    }
    this.proposals.delete('structures');
    this.proposals.delete('structure-critiques');
    this.proposals.delete('cast');
    this.advance('cards');
    await this.store.commit(`Structure: ${alt.label}`);
    return alt;
  }

  // ---------------------------------------------------------------- 4. scene cards

  chapters() {
    return this.p.structure.acts.flatMap((a) => a.chapters.map((c) => ({ ...c, act: a.id })));
  }

  cardsInput(chapterId: string): CardsInput {
    const chapters = this.chapters();
    const ci = chapters.findIndex((c) => c.id === chapterId);
    if (ci < 0) throw new Error(`unknown chapter "${chapterId}"`);
    const ch = chapters[ci];
    const before = chapters.slice(0, ci).flatMap((c) => c.scenes);
    const lastBefore = before[before.length - 1];
    // Scene ids are s<number>, possibly with a suffix ("s04-2"): only the leading number counts.
    const maxNum = Math.max(0, ...[...this.p.scenes.keys()].map((id) => Number(/^s(\d+)/.exec(id)?.[1]) || 0));
    const previous = before.slice(-3).map((id) => this.store.scene(id).card);
    const plotPoints = [...this.p.plotPoints.values()];
    return {
      intent: this.p.intent,
      chapter: { id: ch.id, title: ch.title, summary: ch.summary, scene_count: ch.planned_scenes || 2 },
      first_scene_number: maxNum + 1,
      plot_points: [...this.p.plotPoints.values()],
      threads: [...this.p.threads.values()],
      characters: [...this.p.characters.values()]
        .sort((a, b) => Number(/protagonist/i.test(b.bio.role)) - Number(/protagonist/i.test(a.bio.role)))
        .map((c) => ({
        id: c.id,
        name: c.bio.name,
        role: c.bio.role,
        knows: lastBefore ? (this.store.stateAt(c.id, lastBefore)?.snapshot.knows ?? []) : [],
      })),
      locations: this.p.locations.locations.map((l) => ({ id: l.id, name: l.name })),
      facts: relevantFacts(this.p, {
        must: previous.flatMap((c) => [...c.reveals, ...c.mentions.map((m) => m.fact)]),
        query: `${ch.title} ${ch.summary} ${plotPoints.map((pp) => pp.description).join(' ')} ${previous.map((c) => c.outcome).join(' ')}`,
        prefer: unrevealedFacts(this.p),
      }),
      obligations: [...this.p.obligations.values()].filter((o) => o.status !== 'paid' && o.status !== 'dropped'),
      previous_cards: previous,
      words_per_scene: wordsPerScene(this.p),
    };
  }

  async proposeCards(chapterId: string): Promise<CardsOutput> {
    const out = await this.agents.cards(this.cardsInput(chapterId));
    this.proposals.set(`cards-${chapterId}`, out);
    return out;
  }

  async pickCards(chapterId: string, index: number): Promise<string[]> {
    const out = this.proposals.get<CardsOutput>(`cards-${chapterId}`);
    const alt = out?.alternatives[index];
    if (!alt) throw new Error(`no card alternative #${index} for ${chapterId}`);
    this.store.addFacts(alt.new_facts);
    this.store.addLocations(alt.new_locations);
    for (const o of alt.new_obligations ?? []) {
      if (this.p.obligations.has(o.id)) continue;
      this.store.saveObligation({ id: o.id, kind: o.kind, description: o.description, notes: o.payoff_hint, status: 'planned' });
    }
    const ids: string[] = [];
    for (const card of alt.cards) {
      const id = this.p.scenes.has(card.id) ? this.freeId(card.id, (x) => this.p.scenes.has(x) || ids.includes(x)) : card.id;
      const clean = {
        ...card,
        id,
        characters: card.characters.filter((c) => this.p.characters.has(c)),
        threads_touched: card.threads_touched.filter((t) => this.p.threads.has(t)),
        plot_points: card.plot_points.filter((t) => this.p.plotPoints.has(t)),
        mentions: card.mentions.filter((m) => this.p.characters.has(m.character)),
        sets_up: (card.sets_up ?? []).filter((o) => this.p.obligations.has(o)),
        pays_off: (card.pays_off ?? []).filter((o) => this.p.obligations.has(o)),
        deltas: card.deltas.filter((d) => this.p.characters.has(d.character)),
        status: 'draft',
        lock: 'none',
      };
      if (!this.p.characters.has(clean.pov)) clean.pov = clean.characters[0] ?? [...this.p.characters.keys()][0];
      this.store.saveCard(clean);
      ids.push(id);
    }
    const st = structuredClone(this.p.structure);
    for (const a of st.acts) for (const c of a.chapters) if (c.id === chapterId) c.scenes = ids;
    this.store.saveStructure(st);
    this.resolveThreadEnds(chapterId, ids);
    for (const o of resolveObligationScenes(this.p)) this.store.saveObligation(o);
    this.planStates(ids);
    this.proposals.delete(`cards-${chapterId}`);
    if (this.chapters().every((c) => c.scenes.length > 0)) this.advance('prose');
    await this.store.commit(`Scene cards for ${chapterId}: ${alt.label}`);
    return ids;
  }

  /** "Skip ahead with a default": propose and take the first alternative for every chapter without cards. */
  async defaultCards(progress: Progress = () => undefined): Promise<string[]> {
    const done: string[] = [];
    for (const ch of this.chapters()) {
      if (ch.scenes.length) continue;
      progress('cards', `Planning ${ch.title || ch.id}`);
      await this.proposeCards(ch.id);
      done.push(...(await this.pickCards(ch.id, 0)));
    }
    return done;
  }

  private resolveThreadEnds(chapterId: string, sceneIds: string[]) {
    for (const t of this.p.threads.values()) {
      const touching = sceneIds.filter((s) => this.store.scene(s).card.threads_touched.includes(t.id));
      let changed = false;
      const next = { ...t };
      if (t.setup_chapter === chapterId && !t.setup_scene) {
        next.setup_scene = touching[0] ?? sceneIds[0];
        next.status = 'open';
        changed = true;
      }
      if (t.payoff_chapter === chapterId && !t.payoff_scene) {
        next.payoff_scene = touching[touching.length - 1] ?? sceneIds[sceneIds.length - 1];
        changed = true;
      }
      const beats = touching.filter((s) => s !== next.setup_scene && s !== next.payoff_scene && !t.beats.some((b) => b.scene === s));
      if (beats.length) {
        next.beats = [...t.beats, ...beats.map((s) => ({ scene: s, note: this.store.scene(s).card.title }))];
        changed = true;
      }
      if (changed) this.store.saveThread(next);
    }
  }

  /**
   * Seed per-scene state snapshots from card deltas so knowledge checks work before prose
   * exists. Extraction replaces them with what the prose actually establishes.
   */
  planStates(sceneIds: string[]) {
    const order = sceneOrder(this.p);
    const updates = new Map<string, Record<string, StateSnapshot>>();
    for (const sid of order.filter((s) => sceneIds.includes(s))) {
      const card = this.store.scene(sid).card;
      for (const c of uniq([card.pov, ...card.characters])) {
        const ch = this.p.characters.get(c);
        if (!ch) continue;
        const state = updates.get(c) ?? { ...ch.state };
        const idx = order.indexOf(sid);
        let prev: StateSnapshot | null = null;
        for (let i = idx - 1; i >= 0; i--) if (state[order[i]]) (prev = state[order[i]]), (i = -1);
        const d = card.deltas.find((x) => x.character === c);
        const learns = [...(d?.learns ?? []), ...card.reveals];
        state[sid] = {
          knows: uniq([...(prev?.knows ?? []), ...learns]).filter((f) => !(d?.forgets ?? []).includes(f)),
          wants: d?.wants ?? prev?.wants ?? '',
          feels: prev?.feels ?? {},
          location: d?.location ?? card.location,
          alive: d?.dies ? false : (prev?.alive ?? true),
        };
        updates.set(c, state);
      }
    }
    for (const [c, state] of updates) this.store.saveCharacterState(c, state);
  }

  // ---------------------------------------------------------------- 5. prose

  async writeScene(sceneId: string, opts: { style?: boolean; progress?: Progress; commit?: boolean } = {}): Promise<WriteResult> {
    const progress = opts.progress ?? (() => undefined);
    const scene = this.store.scene(sceneId);
    const ok = canGenerate(scene);
    if (!ok.ok) throw new Error(`cannot write ${sceneId}: ${ok.reason}`);
    progress('write', `Writing ${scene.card.title || sceneId}`);
    const out = await this.agents.write(writerContext(this.p, sceneId, this.store.index));
    let prose = out.prose;
    let style: StylePassReport | null = null;
    if (opts.style !== false) {
      const r = await runStylePasses(this.store, this.agents, sceneId, prose, progress);
      prose = r.prose;
      style = r.report;
      recordStyleReport(this.store, sceneId, r.report);
    }
    this.store.saveProse(sceneId, prose, 'generated', { status: 'draft' });
    progress('extract', 'Reading the prose back into the graph');
    const extraction = await runExtraction(this.store, this.agents, sceneId);
    applyExtraction(this.store, extraction);
    if (opts.commit !== false) await this.store.commit(`Write ${sceneId} "${scene.card.title}"`);
    return { scene: sceneId, words: this.store.scene(sceneId).prose!.meta.word_count, style, extraction, needs_decision: out.needs_decision };
  }

  async writeChapter(chapterId: string, opts: { progress?: Progress } = {}): Promise<WriteResult[]> {
    const ch = this.chapters().find((c) => c.id === chapterId);
    if (!ch) throw new Error(`unknown chapter "${chapterId}"`);
    const results: WriteResult[] = [];
    for (const sid of ch.scenes) {
      if (this.store.scene(sid).prose) continue;
      results.push(await this.writeScene(sid, { ...opts, commit: false }));
    }
    await this.store.commit(`Write chapter ${ch.title || chapterId}`);
    if (sceneOrder(this.p).every((s) => this.store.scene(s).prose)) this.advance('complete');
    return results;
  }

  /** Regenerate prose: 'fresh' rewrites from the card; 'minimal' changes only what the card change needs. */
  async regenerate(sceneId: string, mode: 'fresh' | 'minimal', change = 'The scene card was edited.'): Promise<{ before: string; after: string }> {
    const s = this.store.scene(sceneId);
    const before = s.prose?.body ?? '';
    if (mode === 'fresh' || !s.prose) {
      await this.writeScene(sceneId);
      return { before, after: this.store.scene(sceneId).prose!.body };
    }
    const ok = canGenerate(s);
    if (!ok.ok && sceneSync(s).state !== 'conflict') throw new Error(ok.reason);
    const oldCard = (await this.committedCard(sceneId)) ?? s.card;
    const voices = s.card.characters.filter((c) => this.p.characters.has(c)).map((c) => ({ character: c, name: this.p.characters.get(c)!.bio.name, voice: this.p.characters.get(c)!.voice }));
    const out = await this.agents.reviseProse({ intent: this.p.intent, change, old_card: oldCard, new_card: s.card, old_prose: before, voices });
    return { before, after: out.prose };
  }

  /**
   * The card the current prose was written against: the version in history whose hash is
   * the prose's `generated_from`. HEAD is not reliable, because the edited card may already
   * have been committed (by a checkpoint, or any later commit) before regenerating.
   */
  private async committedCard(sceneId: string): Promise<SceneCard | null> {
    const rel = paths.card(sceneId);
    const want = this.store.scene(sceneId).prose?.meta.generated_from ?? null;
    let head: SceneCard | null = null;
    for (const hash of await this.store.repo.history(rel, 50)) {
      const text = await this.store.repo.readAt(hash, rel).catch(() => null);
      if (!text) continue;
      const r = SceneCard.safeParse(fromYaml(text));
      if (!r.success) continue;
      head ??= r.data;
      if (!want || cardHash(r.data) === want) return r.data;
    }
    return head;
  }

  async acceptProse(sceneId: string, prose: string) {
    this.store.saveProse(sceneId, prose, 'generated');
    const ex = await runExtraction(this.store, this.agents, sceneId);
    applyExtraction(this.store, ex);
    await this.store.commit(`Revise prose of ${sceneId}`);
    return ex;
  }

  approve(sceneIds: string[]) {
    for (const id of sceneIds) this.store.setSceneStatus(id, { status: 'approved' });
  }

  // ---------------------------------------------------------------- prose edits flowing back

  /**
   * After the author edits prose: extract, and report whether the edit changed graph-level
   * facts. Presentation-only edits are reconciled immediately. Graph-level ones are held
   * for the author ("your edit changed these facts") before a ripple runs.
   */
  async reconcileProseEdit(sceneId: string): Promise<{ presentationOnly: boolean; extraction: ExtractionResult }> {
    const ex = await runExtraction(this.store, this.agents, sceneId);
    if (!ex.diff.graphLevel) {
      applyExtraction(this.store, ex);
      // Only the prose side is reconciled. If the card had moved too, the scene stays
      // card_ahead: the prose still needs to follow the card.
      const s = this.store.scene(sceneId);
      if (sceneSync(s).state === 'prose_ahead') this.store.markInSync(sceneId);
      await this.store.commit(`Edit prose of ${sceneId} (wording only)`);
      return { presentationOnly: true, extraction: ex };
    }
    this.proposals.set(`extract-${sceneId}`, ex);
    return { presentationOnly: false, extraction: ex };
  }

  /** Accept the facts an edit established: the card is updated to match, and the card change is returned for a ripple. */
  acceptProseFacts(sceneId: string) {
    const ex = this.proposals.get<ExtractionResult>(`extract-${sceneId}`);
    if (!ex) throw new Error(`no pending extraction for ${sceneId}`);
    const before = structuredClone(this.store.scene(sceneId).card);
    applyExtraction(this.store, ex, { adoptCard: true });
    this.proposals.delete(`extract-${sceneId}`);
    return { kind: 'card' as const, scene: sceneId, before, after: this.store.scene(sceneId).card };
  }

  // ---------------------------------------------------------------- helpers

  private freeId(base: string, taken: (id: string) => boolean): string {
    if (!taken(base)) return base;
    for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
  }
}

function uniqBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

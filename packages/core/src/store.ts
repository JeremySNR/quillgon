import fs from 'node:fs';
import path from 'node:path';
import {
  Book,
  FactGlossary,
  Locations,
  CharacterBio,
  CharacterState,
  CharacterVoice,
  Intent,
  PlotPoint,
  ProseMeta,
  SceneCard,
  SceneFacts,
  Structure,
  Thread,
  Timeline,
} from './schemas/index.js';
import {
  loadProject,
  parseOrThrow,
  paths,
  sceneOrder,
  scenePlaces,
  serialise,
  stateAt,
  stateBefore,
  validateReferences,
  type Issue,
  type Project,
  type ProseFile,
} from './project.js';
import { ProjectIndex } from './index-db.js';
import { Repo } from './git.js';
import { cardHash, proseHash, projectSync, sceneSync } from './sync.js';
import { parseBannedPatterns } from './style.js';
import { timestamp, toYaml, wordCount } from './util.js';

export interface OpenOptions {
  /** Use an in-memory index instead of .engine/index.sqlite (tests). */
  memoryIndex?: boolean;
  /** Skip the index entirely (validation-only commands). */
  noIndex?: boolean;
}

/**
 * The graph store is the only thing that writes to the manuscript repo.
 * Agents return structured results; the store validates and writes them,
 * keeps the derived index current, and commits.
 */
export class GraphStore {
  project!: Project;
  issues: Issue[] = [];
  private fileIssues: Issue[] = [];
  index: ProjectIndex | null = null;
  readonly repo: Repo;
  /** Files written since the last commit. */
  private dirty = new Set<string>();
  private listeners = new Set<(e: StoreEvent) => void>();

  private constructor(readonly dir: string, private opts: OpenOptions) {
    this.repo = new Repo(dir);
  }

  static open(dir: string, opts: OpenOptions = {}): GraphStore {
    const s = new GraphStore(path.resolve(dir), opts);
    s.reload();
    return s;
  }

  /** Re-read every file from disk and rebuild the index. */
  reload() {
    const { project, issues } = loadProject(this.dir);
    this.project = project;
    this.issues = issues;
    const refIssues = new Set(validateReferences(project).map((i) => `${i.file}|${i.path}|${i.message}`));
    this.fileIssues = issues.filter((i) => !refIssues.has(`${i.file}|${i.path}|${i.message}`));
    if (!this.opts.noIndex) {
      if (!this.index) this.index = this.opts.memoryIndex ? new ProjectIndex(':memory:') : ProjectIndex.forProject(this.dir);
      this.index.rebuild(project);
    }
    this.emit({ type: 'reloaded' });
  }

  close() {
    this.index?.close();
    this.index = null;
  }

  on(fn: (e: StoreEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: StoreEvent) {
    for (const fn of this.listeners) fn(e);
  }

  // --------------------------------------------------------------- reads

  get book() {
    return this.project.book;
  }
  order(): string[] {
    return sceneOrder(this.project);
  }
  places() {
    return scenePlaces(this.project);
  }
  scene(id: string) {
    const s = this.project.scenes.get(id);
    if (!s) throw new Error(`unknown scene "${id}"`);
    return s;
  }
  stateAt(character: string, scene: string) {
    return stateAt(this.project, character, scene);
  }
  stateBefore(character: string, scene: string) {
    return stateBefore(this.project, character, scene);
  }
  sync() {
    return projectSync(this.project);
  }
  sceneSync(id: string) {
    return sceneSync(this.scene(id));
  }
  errors() {
    return this.issues.filter((i) => i.severity === 'error');
  }

  // --------------------------------------------------------------- low-level write

  private write(rel: string, text: string) {
    const abs = path.join(this.dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    this.dirty.add(rel);
  }

  private remove(rel: string) {
    const abs = path.join(this.dir, rel);
    if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
    this.dirty.add(rel);
  }

  private after(entity: string) {
    // File-level problems persist until that file is rewritten; reference problems are recomputed.
    for (const rel of this.dirty) this.fileIssues = this.fileIssues.filter((i) => i.file !== rel);
    this.issues = [...this.fileIssues, ...validateReferences(this.project)];
    this.index?.update(this.project);
    this.emit({ type: 'changed', entity });
  }

  // --------------------------------------------------------------- entity writes

  saveBook(value: unknown) {
    const book = parseOrThrow(Book, value, paths.book);
    this.write(paths.book, toYaml(book));
    this.project.book = book;
    this.after('book');
    return book;
  }

  updateBook(patch: Partial<Book>) {
    return this.saveBook({ ...this.project.book, ...patch });
  }

  saveIntent(value: unknown) {
    const intent = parseOrThrow(Intent, value, paths.intent);
    this.write(paths.intent, serialise.intent(intent));
    this.project.intent = intent;
    this.after('intent');
    return intent;
  }

  savePlotPoint(value: unknown) {
    const pp = parseOrThrow(PlotPoint, value, 'plot-points/?.yaml');
    this.write(paths.plotPoint(pp.id), toYaml(pp));
    this.project.plotPoints.set(pp.id, pp);
    this.after(`plot:${pp.id}`);
    return pp;
  }

  deletePlotPoint(id: string) {
    this.remove(paths.plotPoint(id));
    this.project.plotPoints.delete(id);
    this.after(`plot:${id}`);
  }

  saveThread(value: unknown) {
    const t = parseOrThrow(Thread, value, 'threads/?.yaml');
    this.write(paths.thread(t.id), toYaml(t));
    this.project.threads.set(t.id, t);
    this.after(`thread:${t.id}`);
    return t;
  }

  deleteThread(id: string) {
    this.remove(paths.thread(id));
    this.project.threads.delete(id);
    this.after(`thread:${id}`);
  }

  saveCharacter(value: { bio: unknown; voice?: unknown; state?: unknown }) {
    const bio = parseOrThrow(CharacterBio, value.bio, 'characters/?/bio.md');
    const prev = this.project.characters.get(bio.id);
    const voice = parseOrThrow(CharacterVoice, value.voice ?? prev?.voice ?? {}, paths.voice(bio.id));
    const state = parseOrThrow(CharacterState, value.state ?? prev?.state ?? {}, paths.state(bio.id));
    this.write(paths.bio(bio.id), serialise.bio(bio));
    this.write(paths.voice(bio.id), serialise.voice(voice));
    this.write(paths.state(bio.id), toYaml(state));
    this.project.characters.set(bio.id, { id: bio.id, bio, voice, state });
    this.after(`character:${bio.id}`);
    return this.project.characters.get(bio.id)!;
  }

  saveCharacterState(id: string, value: unknown) {
    const ch = this.project.characters.get(id);
    if (!ch) throw new Error(`unknown character "${id}"`);
    const state = parseOrThrow(CharacterState, value, paths.state(id));
    this.write(paths.state(id), toYaml(state));
    ch.state = state;
    this.after(`character:${id}`);
    return state;
  }

  saveStructure(value: unknown) {
    const st = parseOrThrow(Structure, value, paths.structure);
    this.write(paths.structure, toYaml(st));
    this.project.structure = st;
    this.after('structure');
    return st;
  }

  saveTimeline(value: unknown) {
    const tl = parseOrThrow(Timeline, value, paths.timeline);
    tl.events.sort((a, b) => a.when.localeCompare(b.when));
    this.write(paths.timeline, toYaml(tl));
    this.project.timeline = tl;
    this.after('timeline');
    return tl;
  }

  saveFactGlossary(value: unknown) {
    const g = parseOrThrow(FactGlossary, value, paths.factGlossary);
    this.write(paths.factGlossary, toYaml(g));
    this.project.factGlossary = g;
    this.after('facts');
    return g;
  }

  /** Add facts that don't exist yet; existing ids are left alone. */
  addFacts(facts: { id: string; statement: string }[]) {
    const g = structuredClone(this.project.factGlossary);
    let added = 0;
    for (const f of facts) if (!g.facts.some((x) => x.id === f.id)) (g.facts.push(f), added++);
    if (added) this.saveFactGlossary(g);
  }

  saveLocations(value: unknown) {
    const l = parseOrThrow(Locations, value, paths.locations);
    this.write(paths.locations, toYaml(l));
    this.project.locations = l;
    this.after('locations');
    return l;
  }

  addLocations(locs: { id: string; name: string; description?: string }[]) {
    const l = structuredClone(this.project.locations);
    let added = 0;
    for (const x of locs)
      if (!l.locations.some((y) => y.id === x.id)) (l.locations.push({ id: x.id, name: x.name, description: x.description ?? '', near: [] }), added++);
    if (added) this.saveLocations(l);
  }

  saveStyle(value: { samples?: string; banned?: string }) {
    if (value.banned !== undefined) {
      const banned = parseBannedPatterns(value.banned);
      this.write(paths.banned, value.banned);
      this.project.style.banned = banned;
      this.project.style.bannedRaw = value.banned;
    }
    if (value.samples !== undefined) {
      this.write(paths.samples, value.samples);
      this.project.style.samples = value.samples;
    }
    this.after('style');
  }

  /**
   * Save a scene card. If the prose was in sync and `adoptIntoProse` is set (the card was
   * changed to match the prose, e.g. by extraction), the prose is re-stamped as generated
   * from the new card; otherwise the scene becomes card_ahead.
   */
  saveCard(value: unknown, opts: { adoptIntoProse?: boolean } = {}) {
    const card = parseOrThrow(SceneCard, value, 'scenes/?/card.yaml');
    const existing = this.project.scenes.get(card.id);
    this.write(paths.card(card.id), toYaml(card));
    const entry = existing ?? { id: card.id, card, prose: null, facts: null };
    entry.card = card;
    this.project.scenes.set(card.id, entry);
    if (opts.adoptIntoProse && entry.prose) {
      entry.prose.meta.generated_from = cardHash(card);
      this.write(paths.prose(card.id), serialise.prose(entry.prose));
    }
    this.after(`scene:${card.id}`);
    return entry;
  }

  /**
   * Save prose. `source` decides how hashes move:
   *  - 'generated': written from the current card; generated_from = card hash.
   *  - 'author': hand edit; hashes untouched so the scene shows prose_ahead until extracted.
   */
  saveProse(id: string, body: string, source: 'generated' | 'author', meta: Partial<ProseMeta> = {}) {
    const entry = this.scene(id);
    const prev = entry.prose?.meta ?? ProseMeta.parse({});
    const next: ProseFile = {
      meta: parseOrThrow(ProseMeta, { ...prev, ...meta, word_count: wordCount(body) }, paths.prose(id)),
      body: body.trim(),
    };
    if (source === 'generated') next.meta.generated_from = cardHash(entry.card);
    entry.prose = next;
    this.write(paths.prose(id), serialise.prose(next));
    this.after(`scene:${id}`);
    return entry;
  }

  /** Record that the prose has been read back into the graph. */
  markExtracted(id: string, facts: unknown) {
    const entry = this.scene(id);
    if (!entry.prose) throw new Error(`scene "${id}" has no prose to extract from`);
    const ph = proseHash(entry.prose.body);
    const f = parseOrThrow(SceneFacts, { ...(facts as object), extracted_from: ph }, paths.facts(id));
    entry.facts = f;
    entry.prose.meta.last_extracted = ph;
    this.write(paths.facts(id), toYaml(f));
    this.write(paths.prose(id), serialise.prose(entry.prose));
    this.after(`scene:${id}`);
    return f;
  }

  /** Accept the current card+prose pair as reconciled (author says: these agree). */
  markInSync(id: string) {
    const entry = this.scene(id);
    if (!entry.prose) return;
    entry.prose.meta.generated_from = cardHash(entry.card);
    entry.prose.meta.last_extracted = proseHash(entry.prose.body);
    this.write(paths.prose(id), serialise.prose(entry.prose));
    this.after(`scene:${id}`);
  }

  setSceneStatus(id: string, patch: { status?: SceneCard['status']; lock?: SceneCard['lock'] }) {
    const entry = this.scene(id);
    const card = { ...entry.card, ...patch };
    this.saveCard(card);
    if (entry.prose && patch.status) {
      entry.prose.meta.status = patch.status;
      this.write(paths.prose(id), serialise.prose(entry.prose));
    }
  }

  deleteScene(id: string) {
    this.remove(`scenes/${id}`);
    this.project.scenes.delete(id);
    const st = structuredClone(this.project.structure);
    for (const a of st.acts) for (const c of a.chapters) c.scenes = c.scenes.filter((s) => s !== id);
    this.saveStructure(st);
    for (const ch of this.project.characters.values()) {
      if (ch.state[id]) {
        const { [id]: _gone, ...rest } = ch.state;
        this.saveCharacterState(ch.id, rest);
      }
    }
    this.after(`scene:${id}`);
  }

  // --------------------------------------------------------------- reports

  writeReport(name: string, content: string) {
    const rel = `${paths.reports}/${name}`;
    this.write(rel, content);
    return rel;
  }

  readReport(name: string): string | null {
    const abs = path.join(this.dir, paths.reports, name);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  }

  listReports(prefix = ''): string[] {
    const dir = path.join(this.dir, paths.reports);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .sort();
  }

  appendReport(name: string, line: string) {
    const abs = path.join(this.dir, paths.reports, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, line.endsWith('\n') ? line : line + '\n');
    this.dirty.add(`${paths.reports}/${name}`);
  }

  // --------------------------------------------------------------- git

  async commit(message: string): Promise<string | null> {
    const hash = await this.repo.commit(message);
    this.dirty.clear();
    if (hash) this.emit({ type: 'committed', hash, message });
    return hash;
  }

  hasUncommitted() {
    return this.dirty.size > 0;
  }

  stamp() {
    return timestamp();
  }
}

export type StoreEvent =
  | { type: 'reloaded' }
  | { type: 'changed'; entity: string }
  | { type: 'committed'; hash: string; message: string };

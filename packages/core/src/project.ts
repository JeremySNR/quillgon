import fs from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  Book,
  CharacterBio,
  CharacterState,
  CharacterVoice,
  FactGlossary,
  Intent,
  IdeaBoard,
  Locations,
  Notebook,
  ResearchLibrary,
  Questions,
  SceneNotes,
  Session,
  Story,
  Obligation,
  PlotPoint,
  StyleSheet,
  ProseMeta,
  SceneCard,
  SceneFacts,
  Structure,
  Thread,
  Timeline,
} from './schemas/index.js';
import { fromYaml, parseFrontmatter, toYaml, withFrontmatter, wordCount } from './util.js';
import { parseBannedPatterns, type BannedPattern } from './style.js';

export interface ProseFile {
  meta: ProseMeta;
  body: string;
}

export interface SceneEntry {
  id: string;
  card: SceneCard;
  prose: ProseFile | null;
  facts: SceneFacts | null;
  /** Life stories: the ghostwriter's margin notes on the draft. */
  notes?: SceneNotes | null;
}

export interface CharacterEntry {
  id: string;
  bio: CharacterBio;
  voice: CharacterVoice;
  state: CharacterState;
}

export interface StyleFiles {
  samples: string;
  bannedRaw: string;
  banned: BannedPattern[];
  sheet: StyleSheet;
}

export interface Project {
  dir: string;
  book: Book;
  intent: Intent;
  plotPoints: Map<string, PlotPoint>;
  threads: Map<string, Thread>;
  obligations: Map<string, Obligation>;
  characters: Map<string, CharacterEntry>;
  timeline: Timeline;
  structure: Structure;
  scenes: Map<string, SceneEntry>;
  style: StyleFiles;
  locations: Locations;
  factGlossary: FactGlossary;
  idea: IdeaBoard;
  // Life stories (empty for a novel).
  stories: Map<string, Story>;
  sessions: Map<string, Session>;
  questions: Questions;
  notebook: Notebook;
  /** What research has found (any kind of book). */
  research: ResearchLibrary;
}

export interface Issue {
  severity: 'error' | 'warning';
  /** Path relative to the project root. */
  file: string;
  /** Field path inside the file, dot-joined ("beats.2"). Empty for whole-file problems. */
  path: string;
  message: string;
}

/** File layout of a manuscript repo. All paths relative to the project root. */
export const paths = {
  book: 'book.yaml',
  intent: 'intent.md',
  structure: 'structure.yaml',
  timeline: 'timeline.yaml',
  locations: 'locations.yaml',
  factGlossary: 'facts.yaml',
  plotPoint: (id: string) => `plot-points/${id}.yaml`,
  thread: (id: string) => `threads/${id}.yaml`,
  obligation: (id: string) => `obligations/${id}.yaml`,
  idea: 'idea.yaml',
  styleSheet: 'style/style.yaml',
  bio: (id: string) => `characters/${id}/bio.md`,
  voice: (id: string) => `characters/${id}/voice.md`,
  state: (id: string) => `characters/${id}/state.yaml`,
  card: (id: string) => `scenes/${id}/card.yaml`,
  prose: (id: string) => `scenes/${id}/prose.md`,
  facts: (id: string) => `scenes/${id}/facts.yaml`,
  notes: (id: string) => `scenes/${id}/notes.yaml`,
  story: (id: string) => `stories/${id}.yaml`,
  session: (id: string) => `sessions/${id}.yaml`,
  /** Recordings stay out of git (see Repo.ensureIgnored): large, and the most private thing in the book. */
  audio: (session: string, file: string) => `audio/${session}/${file}`,
  questions: 'ghostwriter/questions.yaml',
  notebook: 'ghostwriter/notebook.yaml',
  research: 'research/library.yaml',
  researchRun: (id: string) => `research/runs/${id}.yaml`,
  /** The author's own material (notes, talks, course pages), as text. */
  upload: (file: string) => `research/uploads/${file}`,
  samples: 'style/samples.md',
  banned: 'style/banned-patterns.md',
  reports: 'reports',
  engine: '.engine',
};

export class SchemaError extends Error {
  constructor(public issues: Issue[]) {
    super(issues.map((i) => `${i.file}${i.path ? ` (${i.path})` : ''}: ${i.message}`).join('\n'));
    this.name = 'SchemaError';
  }
}

/** Parse a value against a schema, returning precise issues instead of throwing. */
export function check<T>(schema: ZodType<T>, value: unknown, file: string): { value: T | null; issues: Issue[] } {
  const r = schema.safeParse(value);
  if (r.success) return { value: r.data, issues: [] };
  return {
    value: null,
    issues: r.error.issues.map((i) => ({
      severity: 'error' as const,
      file,
      path: i.path.map(String).join('.'),
      message: i.message,
    })),
  };
}

export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, file: string): T {
  const r = check(schema, value, file);
  if (r.value === null) throw new SchemaError(r.issues);
  return r.value;
}

function readIf(dir: string, rel: string): string | null {
  const p = path.join(dir, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

function listFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort();
}

// ------------------------------------------------------------------ parsers (text -> value)

export const parsers = {
  intent(text: string): unknown {
    const { data, body } = parseFrontmatter(text);
    return { ...data, notes: body.trim() };
  },
  bio(text: string): unknown {
    const { data, body } = parseFrontmatter(text);
    return { ...data, background: body.trim() };
  },
  voice(text: string): unknown {
    const { data, body } = parseFrontmatter(text);
    return { ...data, notes: body.trim() };
  },
  prose(text: string): { meta: unknown; body: string } {
    const { data, body } = parseFrontmatter(text);
    return { meta: data, body: body.trim() };
  },
};

// ------------------------------------------------------------------ serialisers (value -> text)

export const serialise = {
  yaml: (v: unknown) => toYaml(v),
  intent(i: Intent): string {
    const { notes, ...data } = i;
    return withFrontmatter(data, notes || '');
  },
  bio(b: CharacterBio): string {
    const { background, ...data } = b;
    return withFrontmatter(data, background || '');
  },
  voice(v: CharacterVoice): string {
    const { notes, ...data } = v;
    return withFrontmatter(data, notes || '');
  },
  prose(p: ProseFile): string {
    return withFrontmatter({ ...p.meta, word_count: wordCount(p.body) }, p.body);
  },
};

// ------------------------------------------------------------------ loader

export interface LoadResult {
  project: Project;
  issues: Issue[];
}

/**
 * Load a manuscript repo from disk. Never throws on content problems; every problem
 * becomes an Issue with the file and field path. Entities whose file fails validation
 * are left out of the project (so downstream code only ever sees valid data).
 */
export function loadProject(dir: string): LoadResult {
  const root = path.resolve(dir);
  const issues: Issue[] = [];

  const yamlFile = <T>(schema: ZodType<T>, rel: string, fallback: unknown, required = false): T | null => {
    const text = readIf(root, rel);
    if (text === null) {
      if (required) issues.push({ severity: 'error', file: rel, path: '', message: 'file is missing' });
      return check(schema, fallback, rel).value;
    }
    let raw: unknown;
    try {
      raw = fromYaml(text) ?? {};
    } catch (e) {
      issues.push({ severity: 'error', file: rel, path: '', message: `invalid YAML: ${(e as Error).message.split('\n')[0]}` });
      return null;
    }
    const r = check(schema, raw, rel);
    issues.push(...r.issues);
    return r.value;
  };

  const mdFile = <T>(schema: ZodType<T>, rel: string, parse: (t: string) => unknown, fallback: unknown): T | null => {
    const text = readIf(root, rel);
    if (text === null) return check(schema, fallback, rel).value;
    let raw: unknown;
    try {
      raw = parse(text);
    } catch (e) {
      issues.push({ severity: 'error', file: rel, path: '', message: `invalid frontmatter: ${(e as Error).message.split('\n')[0]}` });
      return null;
    }
    const r = check(schema, raw, rel);
    issues.push(...r.issues);
    return r.value;
  };

  const book = yamlFile(Book, paths.book, { title: 'Untitled' }, true) ?? Book.parse({ title: 'Untitled' });
  const intent = mdFile(Intent, paths.intent, parsers.intent, {}) ?? Intent.parse({});
  const structure = yamlFile(Structure, paths.structure, {}) ?? Structure.parse({});
  const timeline = yamlFile(Timeline, paths.timeline, {}) ?? Timeline.parse({});
  const locations = yamlFile(Locations, paths.locations, {}) ?? Locations.parse({});
  const factGlossary = yamlFile(FactGlossary, paths.factGlossary, {}) ?? FactGlossary.parse({});
  const idea = yamlFile(IdeaBoard, paths.idea, {}) ?? IdeaBoard.parse({});

  const plotPoints = new Map<string, PlotPoint>();
  for (const f of listFiles(path.join(root, 'plot-points'), '.yaml')) {
    const rel = `plot-points/${f}`;
    const pp = yamlFile(PlotPoint, rel, null);
    if (!pp) continue;
    if (pp.id !== f.replace(/\.yaml$/, '')) {
      issues.push({ severity: 'error', file: rel, path: 'id', message: `id "${pp.id}" does not match file name` });
    }
    plotPoints.set(pp.id, pp);
  }

  const threads = new Map<string, Thread>();
  for (const f of listFiles(path.join(root, 'threads'), '.yaml')) {
    const rel = `threads/${f}`;
    const t = yamlFile(Thread, rel, null);
    if (!t) continue;
    if (t.id !== f.replace(/\.yaml$/, '')) {
      issues.push({ severity: 'error', file: rel, path: 'id', message: `id "${t.id}" does not match file name` });
    }
    threads.set(t.id, t);
  }

  const obligations = new Map<string, Obligation>();
  for (const f of listFiles(path.join(root, 'obligations'), '.yaml')) {
    const rel = `obligations/${f}`;
    const o = yamlFile(Obligation, rel, null);
    if (!o) continue;
    if (o.id !== f.replace(/\.yaml$/, '')) {
      issues.push({ severity: 'error', file: rel, path: 'id', message: `id "${o.id}" does not match file name` });
    }
    obligations.set(o.id, o);
  }

  const characters = new Map<string, CharacterEntry>();
  for (const id of listDirs(path.join(root, 'characters'))) {
    const bio = mdFile(CharacterBio, paths.bio(id), parsers.bio, null);
    if (!bio) {
      if (!readIf(root, paths.bio(id))) issues.push({ severity: 'error', file: paths.bio(id), path: '', message: 'file is missing' });
      continue;
    }
    if (bio.id !== id) issues.push({ severity: 'error', file: paths.bio(id), path: 'id', message: `id "${bio.id}" does not match folder name` });
    const voice = mdFile(CharacterVoice, paths.voice(id), parsers.voice, {}) ?? CharacterVoice.parse({});
    const state = yamlFile(CharacterState, paths.state(id), {}) ?? {};
    characters.set(id, { id, bio, voice, state });
  }

  const scenes = new Map<string, SceneEntry>();
  for (const id of listDirs(path.join(root, 'scenes'))) {
    const card = yamlFile(SceneCard, paths.card(id), null, true);
    if (!card) continue;
    if (card.id !== id) issues.push({ severity: 'error', file: paths.card(id), path: 'id', message: `id "${card.id}" does not match folder name` });
    let prose: ProseFile | null = null;
    const proseText = readIf(root, paths.prose(id));
    if (proseText !== null) {
      const parsed = parsers.prose(proseText);
      const r = check(ProseMeta, parsed.meta, paths.prose(id));
      issues.push(...r.issues);
      if (r.value) prose = { meta: r.value, body: parsed.body };
    }
    const facts = readIf(root, paths.facts(id)) !== null ? yamlFile(SceneFacts, paths.facts(id), {}) : null;
    const notes = readIf(root, paths.notes(id)) !== null ? yamlFile(SceneNotes, paths.notes(id), {}) : null;
    scenes.set(id, { id, card, prose, facts, ...(notes ? { notes } : {}) });
  }

  const stories = new Map<string, Story>();
  for (const f of listFiles(path.join(root, 'stories'), '.yaml')) {
    const rel = `stories/${f}`;
    const st = yamlFile(Story, rel, null);
    if (!st) continue;
    if (st.id !== f.replace(/\.yaml$/, '')) issues.push({ severity: 'error', file: rel, path: 'id', message: `id "${st.id}" does not match file name` });
    stories.set(st.id, st);
  }
  const sessions = new Map<string, Session>();
  for (const f of listFiles(path.join(root, 'sessions'), '.yaml')) {
    const rel = `sessions/${f}`;
    const se = yamlFile(Session, rel, null);
    if (!se) continue;
    if (se.id !== f.replace(/\.yaml$/, '')) issues.push({ severity: 'error', file: rel, path: 'id', message: `id "${se.id}" does not match file name` });
    sessions.set(se.id, se);
  }
  const questions = yamlFile(Questions, paths.questions, {}) ?? Questions.parse({});
  const notebook = yamlFile(Notebook, paths.notebook, {}) ?? Notebook.parse({});
  const research = yamlFile(ResearchLibrary, paths.research, {}) ?? ResearchLibrary.parse({});

  const sheet = yamlFile(StyleSheet, paths.styleSheet, {}) ?? StyleSheet.parse({});
  const samples = readIf(root, paths.samples) ?? '';
  const bannedRaw = readIf(root, paths.banned) ?? '';
  let banned: BannedPattern[] = [];
  try {
    banned = parseBannedPatterns(bannedRaw);
  } catch (e) {
    issues.push({ severity: 'error', file: paths.banned, path: '', message: (e as Error).message });
  }

  const project: Project = {
    dir: root,
    book,
    intent,
    plotPoints,
    threads,
    obligations,
    characters,
    timeline,
    structure,
    scenes,
    style: { samples, bannedRaw, banned, sheet },
    locations,
    factGlossary,
    idea,
    stories,
    sessions,
    questions,
    notebook,
    research,
  };
  issues.push(...validateReferences(project));
  return { project, issues };
}

/** Every id a file references must exist. These are the edges the impact analyser walks. */
export function validateReferences(p: Project): Issue[] {
  const issues: Issue[] = [];
  const err = (file: string, field: string, message: string) => issues.push({ severity: 'error', file, path: field, message });
  const warn = (file: string, field: string, message: string) => issues.push({ severity: 'warning', file, path: field, message });
  const hasChar = (id: string) => p.characters.has(id);
  const knownLocations = new Set(p.locations.locations.map((l) => l.id));
  const checkLocation = (file: string, field: string, id: string | null) => {
    if (id && knownLocations.size > 0 && !knownLocations.has(id)) warn(file, field, `unknown location "${id}"`);
  };

  const inStructure = new Map<string, string>();
  p.structure.acts.forEach((act, ai) =>
    act.chapters.forEach((ch, ci) =>
      ch.scenes.forEach((s, si) => {
        const field = `acts.${ai}.chapters.${ci}.scenes.${si}`;
        if (!p.scenes.has(s)) err(paths.structure, field, `scene "${s}" does not exist`);
        if (inStructure.has(s)) err(paths.structure, field, `scene "${s}" appears twice`);
        inStructure.set(s, field);
      }),
    ),
  );
  for (const id of p.scenes.keys()) {
    if (!inStructure.has(id)) warn(paths.card(id), '', `scene "${id}" is not placed in structure.yaml`);
  }

  for (const s of p.scenes.values()) {
    const f = paths.card(s.id);
    const c = s.card;
    if (!hasChar(c.pov)) err(f, 'pov', `character "${c.pov}" does not exist`);
    checkLocation(f, 'location', c.location);
    c.characters.forEach((ch, i) => !hasChar(ch) && err(f, `characters.${i}`, `character "${ch}" does not exist`));
    if (hasChar(c.pov) && !c.characters.includes(c.pov)) warn(f, 'characters', `pov character "${c.pov}" is not listed in characters`);
    c.threads_touched.forEach((t, i) => !p.threads.has(t) && err(f, `threads_touched.${i}`, `thread "${t}" does not exist`));
    c.plot_points.forEach((t, i) => !p.plotPoints.has(t) && err(f, `plot_points.${i}`, `plot point "${t}" does not exist`));
    c.mentions.forEach((m, i) => !hasChar(m.character) && err(f, `mentions.${i}.character`, `character "${m.character}" does not exist`));
    c.sets_up.forEach((o, i) => !p.obligations.has(o) && err(f, `sets_up.${i}`, `obligation "${o}" does not exist`));
    c.pays_off.forEach((o, i) => !p.obligations.has(o) && err(f, `pays_off.${i}`, `obligation "${o}" does not exist`));
    c.deltas.forEach((d, i) => !hasChar(d.character) && err(f, `deltas.${i}.character`, `character "${d.character}" does not exist`));
  }

  for (const t of p.threads.values()) {
    const f = paths.thread(t.id);
    if (t.setup_scene && !p.scenes.has(t.setup_scene)) err(f, 'setup_scene', `scene "${t.setup_scene}" does not exist`);
    if (t.payoff_scene && !p.scenes.has(t.payoff_scene)) err(f, 'payoff_scene', `scene "${t.payoff_scene}" does not exist`);
    t.beats.forEach((b, i) => !p.scenes.has(b.scene) && err(f, `beats.${i}.scene`, `scene "${b.scene}" does not exist`));
  }

  for (const o of p.obligations.values()) {
    const f = paths.obligation(o.id);
    for (const k of ['setup_scene', 'eligible_from', 'payoff_scene'] as const) {
      const s = o[k];
      if (s && !p.scenes.has(s)) err(f, k, `scene "${s}" does not exist`);
    }
    o.threads.forEach((t, i) => !p.threads.has(t) && err(f, `threads.${i}`, `thread "${t}" does not exist`));
  }

  for (const pp of p.plotPoints.values()) {
    const f = paths.plotPoint(pp.id);
    pp.involves.forEach((c, i) => !hasChar(c) && err(f, `involves.${i}`, `character "${c}" does not exist`));
    pp.threads.forEach((t, i) => !p.threads.has(t) && err(f, `threads.${i}`, `thread "${t}" does not exist`));
    for (const k of ['before', 'after'] as const) {
      const ref = pp.position[k];
      if (ref && !p.plotPoints.has(ref)) err(f, `position.${k}`, `plot point "${ref}" does not exist`);
    }
  }

  for (const ch of p.characters.values()) {
    const f = paths.state(ch.id);
    for (const [sceneId, snap] of Object.entries(ch.state)) {
      if (!p.scenes.has(sceneId)) err(f, sceneId, `scene "${sceneId}" does not exist`);
      for (const other of Object.keys(snap.feels)) {
        if (!hasChar(other)) err(f, `${sceneId}.feels.${other}`, `character "${other}" does not exist`);
      }
      checkLocation(f, `${sceneId}.location`, snap.location);
    }
  }

  p.timeline.events.forEach((e, i) => {
    e.scenes.forEach((s, j) => !p.scenes.has(s) && err(paths.timeline, `events.${i}.scenes.${j}`, `scene "${s}" does not exist`));
    (e.stories ?? []).forEach((s, j) => !p.stories.has(s) && warn(paths.timeline, `events.${i}.stories.${j}`, `story "${s}" does not exist`));
    (e.people ?? []).forEach((c, j) => !hasChar(c) && warn(paths.timeline, `events.${i}.people.${j}`, `person "${c}" does not exist`));
  });

  // Life stories: stories, chapters and cards point at each other and at people.
  const chapters = new Set(p.structure.acts.flatMap((a) => a.chapters.map((c) => c.id)));
  for (const st of p.stories.values()) {
    const f = paths.story(st.id);
    st.people.forEach((c, i) => !hasChar(c) && warn(f, `people.${i}`, `person "${c}" does not exist`));
    if (st.chapter && !chapters.has(st.chapter)) warn(f, 'chapter', `chapter "${st.chapter}" does not exist`);
    [...st.quotes, ...st.details, ...st.versions].forEach((x) => {
      if (x.from && !p.sessions.has(x.from.session)) warn(f, '', `session "${x.from.session}" does not exist`);
    });
  }
  p.structure.acts.forEach((a, ai) =>
    a.chapters.forEach((c, ci) => (c.stories ?? []).forEach((s, si) => !p.stories.has(s) && warn(paths.structure, `acts.${ai}.chapters.${ci}.stories.${si}`, `story "${s}" does not exist`))),
  );
  for (const s of p.scenes.values()) (s.card.stories ?? []).forEach((st, i) => !p.stories.has(st) && warn(paths.card(s.id), `stories.${i}`, `story "${st}" does not exist`));
  const narrator = p.book.life.narrator;
  if (p.book.kind !== 'novel' && narrator && !hasChar(narrator)) err(paths.book, 'life.narrator', `character "${narrator}" does not exist`);

  const sourceIds = new Set(p.research.sources.map((s) => s.id));
  p.research.evidence.forEach((e, i) => !sourceIds.has(e.source) && warn(paths.research, `evidence.${i}.source`, `source "${e.source}" does not exist`));
  p.research.comps.forEach((c, i) => c.source && !sourceIds.has(c.source) && warn(paths.research, `comps.${i}.source`, `source "${c.source}" does not exist`));
  return issues;
}

/** Scene ids in story order (structure.yaml order). */
export function sceneOrder(p: Project): string[] {
  const out: string[] = [];
  for (const a of p.structure.acts) for (const c of a.chapters) out.push(...c.scenes);
  return out.filter((s) => p.scenes.has(s));
}

export interface ScenePlace {
  act: string;
  actTitle: string;
  chapter: string;
  chapterTitle: string;
  index: number;
}

export function scenePlaces(p: Project): Map<string, ScenePlace> {
  const m = new Map<string, ScenePlace>();
  let index = 0;
  for (const a of p.structure.acts)
    for (const c of a.chapters)
      for (const s of c.scenes) m.set(s, { act: a.id, actTitle: a.title, chapter: c.id, chapterTitle: c.title, index: index++ });
  return m;
}

/**
 * What a character knows / wants / feels at the end of a scene.
 * Snapshots are per scene; the answer is the latest snapshot at or before that scene.
 */
export function stateAt(p: Project, characterId: string, sceneId: string, order = sceneOrder(p)) {
  const ch = p.characters.get(characterId);
  if (!ch) return null;
  const idx = order.indexOf(sceneId);
  for (let i = idx; i >= 0; i--) {
    const snap = ch.state[order[i]];
    if (snap) return { scene: order[i], snapshot: snap };
  }
  return null;
}

/** State at the START of a scene (before its own events). */
export function stateBefore(p: Project, characterId: string, sceneId: string, order = sceneOrder(p)) {
  const idx = order.indexOf(sceneId);
  if (idx <= 0) return null;
  return stateAt(p, characterId, order[idx - 1], order);
}

export { parseBannedPatterns };

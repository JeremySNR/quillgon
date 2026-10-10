import type { AgentSuite, DivergeOutput, ExpandInput, IdeaCandidate, TalkOutput } from '../agents/contracts.js';
import { IdeaBoard, type CastSketch, type IdeaItem, type TalkChange } from '../schemas/index.js';
import type { GraphStore } from '../store.js';
import { cosine, LocalEmbedder } from '../embed.js';
import { slugify, uniq } from '../util.js';

/**
 * The idea → premise stage. LLM fiction converges on the same stories, and temperature
 * and "don't be generic" barely help. What does: draw ideas out of the author first, name
 * the genre's clichés and branch away from them, ask several distinct personas for
 * candidates with their own probability estimates (verbalized sampling) and favour the
 * tail, remove near-duplicates by embedding distance, and let the author keep or discard.
 * Then expand Snowflake-style: logline → paragraph → synopsis → cast.
 *
 * Alongside both runs a conversation: the author talks the idea through with a thinking
 * partner, and every turn writes what was said or settled onto the same board, so the
 * board is the conversation's memory and nothing said is lost when the chat scrolls away.
 */

export const PERSONAS = [
  'a literary novelist who distrusts plot and starts from a moral problem',
  'a genre professional who knows exactly what readers of this genre have seen too often',
  'a playwright who only cares about two people wanting incompatible things in one room',
  'a poet who starts from a single concrete image and refuses abstractions',
  'a historian who looks for the odd true detail nobody has used',
  'a comic writer who finds the absurd angle in serious material',
];

/** Names and settings models reach for constantly (from studies of LLM story corpora). */
export const STOCK = [
  'elara', 'elias', 'lyra', 'kael', 'seraphina', 'thorne', 'silas', 'aria', 'eldoria', 'aldric', 'evelyn', 'nyx', 'zephyr', 'orion', 'luna',
  'whispering woods', 'lighthouse keeper', 'forgotten library', 'ancient prophecy', 'chosen one', 'shadowy figure', 'tapestry',
  'small coastal town', 'mysterious stranger', 'hidden power', 'last of their kind', 'secret society',
];

const embedder = new LocalEmbedder();

export function stockHit(text: string): string | null {
  const t = text.toLowerCase();
  return STOCK.find((s) => new RegExp(`\\b${s}\\b`).test(t)) ?? null;
}

/** An id for a new pile item that no current item has (items can be removed by undo). */
function freeId(base: string, pile: IdeaItem[]): string {
  let n = pile.length;
  while (pile.some((i) => i.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

type Candidate = Omit<IdeaCandidate, 'kind'> & { kind: IdeaItem['kind'] };

/**
 * Add candidates to the pile, dropping near-duplicates and marking near-clichés.
 * `mine` adds them as the author's own: kept, and never sorted again.
 */
export function mergeCandidates(board: IdeaBoard, candidates: Candidate[], cliches: string[], opts: { dupe?: number; cliche?: number; mine?: boolean } = {}): IdeaBoard {
  const dupe = opts.dupe ?? 0.8;
  const clicheSim = opts.cliche ?? 0.45;
  const existing = board.pile.map((i) => embedder.embedOne(i.text));
  const clicheVecs = cliches.map((c) => ({ c, v: embedder.embedOne(c) }));
  const pile = [...board.pile];
  for (const c of candidates) {
    const v = embedder.embedOne(c.text);
    if (existing.some((e) => cosine(e, v) >= dupe)) continue;
    const nearest = clicheVecs.map((x) => ({ c: x.c, s: cosine(x.v, v) })).sort((a, b) => b.s - a.s)[0];
    const near = stockHit(c.text) ?? (nearest && nearest.s >= clicheSim ? nearest.c : null);
    const id = opts.mine ? freeId('mine', pile) : freeId(`${c.kind}-${slugify(c.text).slice(0, 24)}`, pile);
    pile.push({ id, kind: c.kind, text: c.text, probability: c.probability, persona: opts.mine ? 'you' : c.persona, status: opts.mine ? 'kept' : 'new', near_cliche: near, mine: !!opts.mine });
    existing.push(v);
  }
  return { ...board, pile, cliches: [...new Set([...board.cliches, ...cliches])] };
}

// ------------------------------------------------------------------ talking it through

const SCALARS = ['seed', 'genre', 'logline', 'paragraph', 'synopsis', 'tone', 'ending'] as const;
const LISTS = ['themes', 'never', 'open', 'cliches'] as const;
type Scalar = (typeof SCALARS)[number];
type List = (typeof LISTS)[number];
const CAST_FIELDS = ['name', 'role', 'want', 'need', 'wound', 'lie', 'arc'] as const;

export const BOARD_LABELS: Record<Scalar | List, string> = {
  seed: 'Seed',
  genre: 'Genre',
  logline: 'One sentence',
  paragraph: 'One paragraph',
  synopsis: 'One page',
  tone: 'Tone',
  ending: 'Ending',
  themes: 'Themes',
  never: 'Never',
  open: 'Still open',
  cliches: 'Steering away from',
};

/** Deep equality that ignores key order (values survive a YAML round trip in any order). */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : (v ?? null);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

const clip = (t: string, n = 48) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/**
 * Apply one partner turn to the board. Returns the new board and every change made, each
 * with its before and after value so the turn can be undone. Unknown ids are ignored:
 * the board, not the model, decides what exists.
 */
export function applyTalk(board: IdeaBoard, out: TalkOutput): { board: IdeaBoard; changes: TalkChange[] } {
  let b: IdeaBoard = structuredClone(board);
  const changes: TalkChange[] = [];

  for (const f of SCALARS) {
    const v = out.set[f];
    if (v === null || v === undefined) continue;
    const next = v.trim();
    if (next === b[f]) continue;
    const verb = !b[f] ? 'written' : next ? 'revised' : 'cleared';
    changes.push({ path: f, label: `${BOARD_LABELS[f]} ${verb}`, before: b[f], after: next });
    b = { ...b, [f]: next };
  }

  const lists: [List, string[] | null][] = [
    ['themes', out.themes],
    ['never', out.never],
    ['open', out.open],
    ['cliches', out.avoid.length ? uniq([...b.cliches, ...out.avoid.map((x) => x.trim()).filter(Boolean)]) : null],
  ];
  for (const [f, v] of lists) {
    if (!v) continue;
    const next = uniq(v.map((x) => x.trim()).filter(Boolean));
    if (same(next, b[f])) continue;
    changes.push({ path: f, label: `${BOARD_LABELS[f]} updated`, before: b[f], after: next });
    b = { ...b, [f]: next };
  }

  for (const from of ['author', 'partner'] as const) {
    const ideas = out.ideas.filter((i) => i.from === from);
    if (!ideas.length) continue;
    const had = new Set(b.pile.map((i) => i.id));
    const persona = 'thinking partner';
    b = mergeCandidates(b, ideas.map((i) => ({ kind: i.kind, text: i.text.trim(), probability: from === 'author' ? 0.5 : i.probability, persona })), [], { mine: from === 'author' });
    for (const item of b.pile.filter((i) => !had.has(i.id)))
      changes.push({ path: `idea:${item.id}`, label: `${from === 'author' ? 'Noted' : 'Suggested'}: ${clip(item.text)}`, before: null, after: item });
  }

  for (const [ids, status] of [[out.keep, 'kept'], [out.bin, 'discarded']] as const) {
    for (const id of ids) {
      const item = b.pile.find((i) => i.id === id);
      if (!item || item.status === status || item.mine) continue;
      const next = { ...item, status };
      changes.push({ path: `idea:${id}`, label: `${status === 'kept' ? 'Kept' : 'Binned'}: ${clip(item.text)}`, before: item, after: next });
      b = { ...b, pile: b.pile.map((i) => (i.id === id ? next : i)) };
    }
  }

  for (const person of out.cast) {
    const prev = b.cast.find((c) => c.id === person.id);
    if (!prev) {
      if (!person.name?.trim()) continue;
      const next: CastSketch = { id: person.id, name: '', role: '', want: '', need: '', wound: '', lie: '', arc: '' };
      for (const k of CAST_FIELDS) next[k] = person[k]?.trim() ?? '';
      changes.push({ path: `cast:${person.id}`, label: `Added ${next.name}`, before: null, after: next });
      b = { ...b, cast: [...b.cast, next] };
      continue;
    }
    const next = { ...prev };
    const touched: string[] = [];
    for (const k of CAST_FIELDS) {
      const v = person[k]?.trim();
      if (v && v !== prev[k]) (next[k] = v), touched.push(k);
    }
    if (!touched.length) continue;
    changes.push({ path: `cast:${prev.id}`, label: `${next.name}: ${touched.join(', ')}`, before: prev, after: next });
    b = { ...b, cast: b.cast.map((c) => (c.id === prev.id ? next : c)) };
  }

  for (const id of out.uncast) {
    const prev = b.cast.find((c) => c.id === id);
    if (!prev) continue;
    changes.push({ path: `cast:${id}`, label: `Removed ${prev.name}`, before: prev, after: null });
    b = { ...b, cast: b.cast.filter((c) => c.id !== id) };
  }

  return { board: b, changes };
}

/**
 * Take changes back, newest first. A field or item the author has changed since is left
 * alone: undo restores what the turn replaced, never something written after it.
 */
export function revertTalk(board: IdeaBoard, changes: TalkChange[]): IdeaBoard {
  let b: IdeaBoard = structuredClone(board);
  for (const c of [...changes].reverse()) {
    const [kind, id] = c.path.includes(':') ? c.path.split(/:(.*)/s) : [c.path, ''];
    if (kind === 'idea' || kind === 'cast') {
      const key = kind === 'idea' ? 'pile' : 'cast';
      const list = b[key] as { id: string }[];
      const current = list.find((x) => x.id === id) ?? null;
      if (!same(current, c.after)) continue;
      const rest = list.filter((x) => x.id !== id);
      const restored = c.before ? (current ? list.map((x) => (x.id === id ? c.before : x)) : [...list, c.before]) : rest;
      b = { ...b, [key]: restored };
    } else if ((SCALARS as readonly string[]).includes(kind) || (LISTS as readonly string[]).includes(kind)) {
      if (!same(b[kind as Scalar | List], c.after)) continue;
      b = { ...b, [kind]: c.before };
    }
  }
  return IdeaBoard.parse(b);
}

/** How much of the conversation the partner rereads each turn; the board carries the rest. */
const HISTORY = 40;

export type BoardPatch = Partial<Pick<IdeaBoard, Scalar | 'themes' | 'never' | 'open'>>;

export class Ideation {
  constructor(
    private store: GraphStore,
    private agents: AgentSuite,
  ) {}

  get board(): IdeaBoard {
    return this.store.project.idea;
  }

  save(board: IdeaBoard) {
    return this.store.saveIdea(board);
  }

  start(seed: string, genre = '') {
    return this.save(IdeaBoard.parse({ ...this.board, seed, genre }));
  }

  /** Diverge: several personas in parallel, verbalized sampling, deduped, tail first. */
  async diverge(opts: { kinds?: IdeaCandidate['kind'][]; personas?: number; k?: number } = {}): Promise<IdeaBoard> {
    const b = this.board;
    const kinds = opts.kinds ?? ['what-if', 'logline', 'character', 'twist', 'setting', 'image'];
    const personas = PERSONAS.slice(0, opts.personas ?? 4);
    const kept = b.pile.filter((i) => i.status === 'kept').map((i) => i.text);
    const discarded = b.pile.filter((i) => i.status === 'discarded').map((i) => i.text);
    const outs: DivergeOutput[] = await Promise.all(
      personas.map((persona) => this.agents.diverge({ seed: b.seed, genre: b.genre, persona, kinds, kept, discarded, avoid: b.cliches, k: opts.k ?? 6 })),
    );
    const cliches = outs.flatMap((o) => o.cliches);
    const candidates = outs
      .flatMap((o, i) => o.candidates.map((c) => ({ ...c, persona: c.persona || personas[i] })))
      // The tail first: the least typical ideas are the point of this exercise.
      .sort((a, b2) => a.probability - b2.probability);
    return this.save(mergeCandidates(b, candidates, cliches));
  }

  mark(id: string, status: IdeaItem['status']) {
    return this.save({ ...this.board, pile: this.board.pile.map((i) => (i.id === id ? { ...i, status } : i)) });
  }

  addOwn(text: string, kind: IdeaItem['kind'] = 'note') {
    const b = this.board;
    return this.save({ ...b, pile: [...b.pile, { id: freeId('mine', b.pile), kind, text, probability: 0.5, persona: 'you', status: 'kept', near_cliche: stockHit(text), mine: true }] });
  }

  /** Snowflake expansion, one step at a time; each produces options the author picks from. */
  async expand(step: ExpandInput['step']): Promise<IdeaBoard> {
    const b = this.board;
    const out = await this.agents.expand({
      step,
      seed: b.seed,
      kept: b.pile.filter((i) => i.status === 'kept').map((i) => `${i.kind}: ${i.text}`),
      logline: b.logline,
      paragraph: b.paragraph,
      synopsis: b.synopsis,
      avoid: b.cliches,
    });
    if (step === 'cast') return this.save({ ...b, cast: out.cast });
    return this.save({ ...b, [`${step}_options`]: out.options } as IdeaBoard);
  }

  choose(step: 'logline' | 'paragraph' | 'synopsis', text: string) {
    return this.save({ ...this.board, [step]: text } as IdeaBoard);
  }

  /** The author's own edits to the settled parts of the board. */
  update(patch: BoardPatch) {
    const allowed = [...SCALARS, 'themes', 'never', 'open'] as const;
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => (allowed as readonly string[]).includes(k)));
    return this.save({ ...this.board, ...clean });
  }

  /**
   * One turn of talking it through. The partner sees the board and the recent conversation,
   * replies, and edits the board: the author's words recorded as theirs, its own ideas left
   * in the pile to sort. Edits apply to the board as it is when the reply arrives, so
   * anything the author changed meanwhile is kept.
   */
  async talk(message: string, focus: string | null = null): Promise<IdeaBoard> {
    const text = message.trim();
    if (!text) throw new Error('say something first');
    const { talk, logline_options: _l, paragraph_options: _p, synopsis_options: _s, done: _d, ...board } = this.board;
    const history = talk.slice(-HISTORY).map((t) => ({ role: t.role, text: t.text, undone: t.undone }));
    const out = await this.agents.talk({ board, history, message: text, focus: focus || null });
    const now = this.board;
    const { board: next, changes } = applyTalk(now, out);
    return this.save({
      ...next,
      talk: [...now.talk, { role: 'author', text, focus: focus || null, changes: [], undone: false }, { role: 'partner', text: out.reply.trim(), focus: null, changes, undone: false }],
    });
  }

  /** Take back everything one partner turn wrote to the board. */
  undoTalk(turn: number) {
    const b = this.board;
    const t = b.talk[turn];
    if (!t || t.role !== 'partner' || t.undone || !t.changes.length) throw new Error('that turn has nothing to undo');
    const next = revertTalk(b, t.changes);
    return this.save({ ...next, talk: b.talk.map((x, i) => (i === turn ? { ...x, undone: true } : x)) });
  }

  /** Start the conversation afresh. The board, which is what it produced, stays. */
  clearTalk() {
    return this.save({ ...this.board, talk: [] });
  }

  /**
   * Hand the premise to the next stage: intent premise and notes, tone, ending, themes and
   * hard rules settled in conversation, the cast as characters with want / need / wound /
   * lie / arc. The interviewer then asks only what is missing.
   */
  async finish(): Promise<IdeaBoard> {
    const b = this.board;
    const p = this.store.project;
    const premise = [b.logline, b.paragraph].filter(Boolean).join('\n\n') || b.seed;
    const kept = b.pile.filter((i) => i.status === 'kept');
    this.store.saveIntent({
      ...p.intent,
      premise,
      tone: b.tone || p.intent.tone,
      ending_type: b.ending || p.intent.ending_type,
      themes: uniq([...p.intent.themes, ...b.themes]),
      notes: [
        b.synopsis && `Synopsis:\n${b.synopsis}`,
        kept.length && `Kept ideas:\n${kept.map((i) => `- (${i.kind}) ${i.text}`).join('\n')}`,
        b.cliches.length && `Avoid these clichés:\n${b.cliches.map((c) => `- ${c}`).join('\n')}`,
        b.open.length && `Still open:\n${b.open.map((q) => `- ${q}`).join('\n')}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      hard_rules: uniq([...p.intent.hard_rules, ...b.never]),
    });
    for (const c of b.cast) {
      const prev = p.characters.get(c.id);
      this.store.saveCharacter({ bio: { ...(prev?.bio ?? {}), id: c.id, name: c.name, role: c.role, want: c.want, need: c.need, wound: c.wound, lie: c.lie, arc: c.arc, goals: prev?.bio.goals ?? [c.want].filter(Boolean) } });
    }
    const done = this.save({ ...b, done: true });
    if (p.book.stage === 'idea') this.store.updateBook({ stage: 'intent' });
    await this.store.commit('Premise developed');
    return done;
  }
}

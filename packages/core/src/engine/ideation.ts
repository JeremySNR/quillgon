import type { AgentSuite, DivergeOutput, ExpandInput, IdeaCandidate } from '../agents/contracts.js';
import { IdeaBoard, type IdeaItem } from '../schemas/index.js';
import type { GraphStore } from '../store.js';
import { cosine, LocalEmbedder } from '../embed.js';
import { slugify } from '../util.js';

/**
 * The idea → premise stage. LLM fiction converges on the same stories, and temperature
 * and "don't be generic" barely help. What does: draw ideas out of the author first, name
 * the genre's clichés and branch away from them, ask several distinct personas for
 * candidates with their own probability estimates (verbalized sampling) and favour the
 * tail, remove near-duplicates by embedding distance, and let the author keep or discard.
 * Then expand Snowflake-style: logline → paragraph → synopsis → cast.
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

/** Add candidates to the pile, dropping near-duplicates and marking near-clichés. */
export function mergeCandidates(board: IdeaBoard, candidates: IdeaCandidate[], cliches: string[], opts: { dupe?: number; cliche?: number } = {}): IdeaBoard {
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
    pile.push({ id: `${c.kind}-${slugify(c.text).slice(0, 24)}-${pile.length}`, kind: c.kind, text: c.text, probability: c.probability, persona: c.persona, status: 'new', near_cliche: near, mine: false });
    existing.push(v);
  }
  return { ...board, pile, cliches: [...new Set([...board.cliches, ...cliches])] };
}

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
    return this.save({ ...b, pile: [...b.pile, { id: `mine-${b.pile.length}`, kind, text, probability: 0.5, persona: 'you', status: 'kept', near_cliche: stockHit(text), mine: true }] });
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

  /**
   * Hand the premise to the next stage: intent premise and notes, the cast as characters
   * with want / need / wound / lie / arc. The interviewer then asks only what is missing.
   */
  async finish(): Promise<IdeaBoard> {
    const b = this.board;
    const p = this.store.project;
    const premise = [b.logline, b.paragraph].filter(Boolean).join('\n\n') || b.seed;
    const kept = b.pile.filter((i) => i.status === 'kept');
    this.store.saveIntent({
      ...p.intent,
      premise,
      notes: [b.synopsis && `Synopsis:\n${b.synopsis}`, kept.length && `Kept ideas:\n${kept.map((i) => `- (${i.kind}) ${i.text}`).join('\n')}`, b.cliches.length && `Avoid these clichés:\n${b.cliches.map((c) => `- ${c}`).join('\n')}`]
        .filter(Boolean)
        .join('\n\n'),
      hard_rules: [...new Set([...p.intent.hard_rules])],
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

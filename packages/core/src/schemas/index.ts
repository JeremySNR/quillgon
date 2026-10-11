import { z } from 'zod';

/**
 * Every file in a manuscript repo is validated by one of these schemas.
 * Ids are stable slugs: never renamed, referenced everywhere by value.
 * If a fact matters for continuity it must be a field here, not a sentence in Markdown.
 */

export const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'ids must be lowercase slugs (a-z, 0-9, hyphen)');
export type Id = z.infer<typeof Id>;

export const Status = z.enum(['draft', 'approved', 'locked']);
export type Status = z.infer<typeof Status>;

export const Lock = z.enum(['none', 'card', 'prose', 'both']);
export type Lock = z.infer<typeof Lock>;

// ---------------------------------------------------------------- book.yaml

export const ModelTier = z.enum(['frontier', 'mid', 'small', 'reader']);
export type ModelTier = z.infer<typeof ModelTier>;

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const ModelConfig = z.object({
  provider: z.enum(['openai', 'codex', 'anthropic', 'openai-compatible', 'offline']).default('openai'),
  model: z.string(),
  base_url: z.preprocess(blankToUndefined, z.string().regex(/^https?:\/\/\S+$/, 'must be an http(s) URL').optional()),
  /**
   * The environment variable holding the key. Restricted to *_API_KEY names so a book file
   * (which may come from someone else) cannot send an arbitrary secret, like a cloud or
   * GitHub credential, to a model endpoint.
   */
  api_key_env: z.preprocess(blankToUndefined, z.string().regex(/^[A-Z][A-Z0-9_]*_API_KEY$/, 'must name an environment variable ending in _API_KEY').optional()),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  /** USD per million tokens, used for cost logging and `novel estimate`. */
  price_in: z.number().optional(),
  price_out: z.number().optional(),
  /** USD per million prompt-cache tokens. Default to 1.25x (write) and 0.1x (read) of price_in. */
  price_cache_write: z.number().optional(),
  price_cache_read: z.number().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

export const AgentName = z.enum([
  'muse',
  'interviewer',
  'planner',
  'writer',
  'reviser',
  'extractor',
  'voice',
  'humaniser',
  'reader',
  'continuity',
  'critic',
  'judge',
  'scribe',
  'ghostwriter',
]);
export type AgentName = z.infer<typeof AgentName>;

export const DEFAULT_MODELS: Record<ModelTier, ModelConfig> = {
  frontier: { provider: 'openai', model: 'gpt-6.1-sol', effort: 'high', price_in: 2, price_out: 10 },
  mid: { provider: 'openai', model: 'gpt-6.1-sol', effort: 'medium', price_in: 2, price_out: 10 },
  small: { provider: 'openai', model: 'gpt-6-luna', effort: 'low', price_in: 0.1, price_out: 0.5 },
  reader: { provider: 'openai', model: 'gpt-6.1-sol', effort: 'medium', price_in: 2, price_out: 10 },
};

/** Empty model lets Codex choose a model available to the signed-in account. */
export const CODEX_MODELS: Record<ModelTier, ModelConfig> = Object.fromEntries(
  ModelTier.options.map((tier) => [tier, { provider: 'codex', model: '', effort: DEFAULT_MODELS[tier].effort, price_in: 0, price_out: 0 }]),
) as Record<ModelTier, ModelConfig>;

export const DEFAULT_AGENT_TIERS: Record<AgentName, ModelTier> = {
  muse: 'frontier',
  critic: 'frontier',
  judge: 'frontier',
  interviewer: 'frontier',
  planner: 'frontier',
  writer: 'frontier',
  reviser: 'frontier',
  extractor: 'mid',
  voice: 'mid',
  humaniser: 'mid',
  reader: 'reader',
  continuity: 'small',
  scribe: 'small',
  ghostwriter: 'frontier',
};

export const PipelineStage = z.enum(['idea', 'intent', 'plot-points', 'structure', 'cards', 'prose', 'complete']);
export type PipelineStage = z.infer<typeof PipelineStage>;

/**
 * Dictation. `auto` uses a local whisper.cpp when one is configured (QUILLGON_WHISPER_CMD), else
 * OpenAI when its key is set. The transcript is tidied by the scribe at the chosen level.
 */
export const VoiceSettings = z.object({
  provider: z.enum(['auto', 'openai', 'local', 'offline']).default('auto'),
  /** Empty: the provider's default (gpt-4o-mini-transcribe for OpenAI). */
  model: z.string().default(''),
  /** ISO 639-1 code, or empty to detect. */
  language: z.string().default(''),
  cleanup: z.enum(['verbatim', 'light', 'polished']).default('light'),
  /** Words the recogniser should spell right, beyond the book's people and places. */
  dictionary: z.array(z.string()).default([]),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

/** What kind of book: a novel is planned top down; a life story is gathered from the author's memories. */
export const BookKind = z.enum(['novel', 'life-story', 'memoir']);
export type BookKind = z.infer<typeof BookKind>;
export const isLifeBook = (b: { kind: BookKind }) => b.kind !== 'novel';

/** How much of the writing the AI does in a life story. */
export const Pen = z.enum(['interviewer', 'co-writer', 'ghostwriter']);
export type Pen = z.infer<typeof Pen>;

export const LifeShape = z.enum(['chronological', 'thematic', 'braided', 'frame', 'vignettes', 'one-season']);
export type LifeShape = z.infer<typeof LifeShape>;

export const LifeSettings = z.object({
  /** Whose life: the author's own, or someone they are writing about (a parent, say). */
  subject: z.enum(['self', 'other']).default('self'),
  /** The character id of the person whose life it is; scene cards are told from their point of view. */
  narrator: Id.nullable().default(null),
  /** Year of birth, for ages on the timeline. */
  born: z.string().default(''),
  audience: z.enum(['family', 'public']).default('family'),
  pen: Pen.default('ghostwriter'),
  shape: LifeShape.nullable().default(null),
  /** The chapter that set the voice; later chapters are drafted to match it. */
  voice_sample: Id.nullable().default(null),
  /** Default length of an interview session. */
  session_minutes: z.number().int().min(5).max(120).default(30),
  /** Follow-ups on one story before the ghostwriter moves on by itself. */
  push: z.enum(['gentle', 'thorough']).default('thorough'),
});
export type LifeSettings = z.infer<typeof LifeSettings>;
export const DEFAULT_LIFE: LifeSettings = { subject: 'self', narrator: null, born: '', audience: 'family', pen: 'ghostwriter', shape: null, voice_sample: null, session_minutes: 30, push: 'thorough' };

export const Book = z.object({
  title: z.string().min(1),
  kind: BookKind.default('novel'),
  genre: z.string().default(''),
  target_words: z.number().int().positive().default(12000),
  pov_mode: z.enum(['first', 'third-limited', 'third-omniscient', 'multiple']).default('third-limited'),
  tense: z.enum(['past', 'present']).default('past'),
  stage: PipelineStage.default('idea'),
  models: z
    .object({
      frontier: ModelConfig.optional(),
      mid: ModelConfig.optional(),
      small: ModelConfig.optional(),
      reader: ModelConfig.optional(),
    })
    .default({}),
  agents: z.partialRecord(AgentName, ModelTier).default({}),
  ripple: z
    .object({
      hop_limit: z.number().int().min(1).max(3).default(2),
      round_cap: z.number().int().min(1).max(10).default(3),
      similarity_threshold: z.number().min(0).max(1).default(0.22),
    })
    .default({ hop_limit: 2, round_cap: 3, similarity_threshold: 0.22 }),
  health: z
    .object({
      last_reader_run: z.string().nullable().default(null),
      reader_mean_engagement: z.number().nullable().default(null),
      open_continuity_issues: z.number().int().default(0),
      voice_warnings: z.number().int().default(0),
    })
    .default({ last_reader_run: null, reader_mean_engagement: null, open_continuity_issues: 0, voice_warnings: 0 }),
  voice: VoiceSettings.default({ provider: 'auto', model: '', language: '', cleanup: 'light', dictionary: [] }),
  /** Life stories only. */
  life: LifeSettings.default(DEFAULT_LIFE),
});
export type Book = z.infer<typeof Book>;

// ---------------------------------------------------------------- intent.md (frontmatter)

export const Intent = z.object({
  premise: z.string().default(''),
  themes: z.array(z.string()).default([]),
  tone: z.string().default(''),
  hard_rules: z.array(z.string()).default([]),
  ending_type: z.string().default(''),
  approved: z.boolean().default(false),
  /** Free notes from the Markdown body. */
  notes: z.string().default(''),
});
export type Intent = z.infer<typeof Intent>;

// ---------------------------------------------------------------- plot-points/<id>.yaml

export const PlotPoint = z.object({
  id: Id,
  title: z.string().default(''),
  description: z.string().min(1),
  position: z
    .object({
      act: z.number().int().positive().optional(),
      before: Id.optional(),
      after: Id.optional(),
    })
    .default({}),
  involves: z.array(Id).default([]),
  threads: z.array(Id).default([]),
  /** Author-pinned events are locked; planner proposals start unlocked and proposed. */
  locked: z.boolean().default(false),
  proposed: z.boolean().default(false),
});
export type PlotPoint = z.infer<typeof PlotPoint>;

// ---------------------------------------------------------------- threads/<id>.yaml

export const Thread = z.object({
  id: Id,
  title: z.string().default(''),
  kind: z.enum(['mystery', 'arc', 'setup-payoff', 'relationship']),
  description: z.string().default(''),
  setup_scene: Id.nullable().default(null),
  payoff_scene: Id.nullable().default(null),
  /** Planned ends at chapter level, resolved to scenes once cards exist. */
  setup_chapter: Id.nullable().default(null),
  payoff_chapter: Id.nullable().default(null),
  status: z.enum(['planned', 'open', 'paid-off', 'dropped']).default('open'),
  beats: z.array(z.object({ scene: Id, note: z.string() })).default([]),
});
export type Thread = z.infer<typeof Thread>;

// ---------------------------------------------------------------- characters/<id>/

export const CharacterBio = z.object({
  id: Id,
  name: z.string().min(1),
  role: z.string().default(''),
  goals: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  /** What they think they want. */
  want: z.string().default(''),
  /** What they actually need (often in tension with the want). */
  need: z.string().default(''),
  /** The old hurt that shapes them. */
  wound: z.string().default(''),
  /** The false belief they act on until the story breaks it. */
  lie: z.string().default(''),
  /** How they change, or refuse to. Ambiguity and failure are allowed. */
  arc: z.string().default(''),
  /** Markdown body of bio.md. */
  background: z.string().default(''),
  // Life stories: real people. All optional, so a novel's files never carry them.
  /** To the narrator: "father", "workmate at Burton's". */
  relationship: z.string().optional(),
  living: z.boolean().nullable().optional(),
  born: z.string().optional(),
  died: z.string().optional(),
  /** How they appear in the book. A pseudonym or composite is disclosed in the author's note. */
  naming: z.enum(['real', 'pseudonym', 'composite']).optional(),
  /** Have they agreed to be in the book (as written)? */
  consent: z.enum(['not-asked', 'asked', 'approved', 'objected', 'not-needed']).optional(),
  /** Handle with care: kept out of drafts until the author says otherwise. */
  sensitive: z.boolean().optional(),
});
export type CharacterBio = z.infer<typeof CharacterBio>;

export const CharacterVoice = z.object({
  speech_patterns: z.array(z.string()).default([]),
  sample_lines: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  /** Markdown body of voice.md. */
  notes: z.string().default(''),
});
export type CharacterVoice = z.infer<typeof CharacterVoice>;

export const StateSnapshot = z.object({
  knows: z.array(Id).default([]),
  wants: z.string().default(''),
  feels: z.record(Id, z.string()).default({}),
  location: Id.nullable().default(null),
  alive: z.boolean().default(true),
});
export type StateSnapshot = z.infer<typeof StateSnapshot>;

/** state.yaml: scene id -> snapshot at the END of that scene. */
export const CharacterState = z.record(Id, StateSnapshot);
export type CharacterState = z.infer<typeof CharacterState>;

// ---------------------------------------------------------------- timeline.yaml

export const DatePrecision = z.enum(['day', 'month', 'year', 'decade', 'about']);
export type DatePrecision = z.infer<typeof DatePrecision>;
/** Where a remembered fact comes from. */
export const Provenance = z.enum(['memory', 'letter', 'photo', 'record', 'someone-else']);
export type Provenance = z.infer<typeof Provenance>;
export const Certainty = z.enum(['sure', 'think-so', 'unsure']);
export type Certainty = z.infer<typeof Certainty>;
/** The life-story interview's key scenes (after McAdams' Life Story Interview). */
export const KeyMoment = z.enum(['high', 'low', 'turning', 'earliest', 'wisdom']);
export type KeyMoment = z.infer<typeof KeyMoment>;

export const TimelineEvent = z.object({
  id: Id,
  /** Sortable story-world time, e.g. "1926-03-14T21:00" or "d03-evening". */
  when: z.string(),
  description: z.string(),
  scenes: z.array(Id).default([]),
  // Life stories. Optional, so a novel's timeline is unchanged.
  precision: DatePrecision.optional(),
  source: Provenance.optional(),
  certainty: Certainty.optional(),
  people: z.array(Id).optional(),
  place: z.string().optional(),
  key: KeyMoment.optional(),
  /** The stories this event belongs to. */
  stories: z.array(Id).optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const Timeline = z.object({ events: z.array(TimelineEvent).default([]) });
export type Timeline = z.infer<typeof Timeline>;

// ---------------------------------------------------------------- structure.yaml

export const Chapter = z.object({
  id: Id,
  title: z.string().default(''),
  summary: z.string().default(''),
  /** Scenes the planner intends for this chapter, before cards exist. */
  planned_scenes: z.number().int().nonnegative().default(0),
  scenes: z.array(Id).default([]),
  /** Life stories: where this chapter is in the ghostwriter's cycle. */
  stage: z.enum(['gathering', 'ready', 'draft', 'notes', 'revising', 'approved']).optional(),
  /** Life stories: drafts written so far (1 = the first draft). */
  round: z.number().int().nonnegative().optional(),
  /** Life stories: the stories this chapter tells, in order. */
  stories: z.array(Id).optional(),
});
export type Chapter = z.infer<typeof Chapter>;
export type ChapterStage = NonNullable<Chapter['stage']>;
export const Act = z.object({ id: Id, title: z.string().default(''), chapters: z.array(Chapter).default([]) });
export type Act = z.infer<typeof Act>;
export const Structure = z.object({ acts: z.array(Act).default([]) });
export type Structure = z.infer<typeof Structure>;

// ---------------------------------------------------------------- scenes/<id>/card.yaml

export const StateDelta = z.object({
  character: Id,
  learns: z.array(Id).default([]),
  forgets: z.array(Id).default([]),
  location: Id.optional(),
  wants: z.string().optional(),
  dies: z.boolean().optional(),
});
export type StateDelta = z.infer<typeof StateDelta>;

export const Mention = z.object({ character: Id, fact: Id });
export type Mention = z.infer<typeof Mention>;

export const SceneCard = z.object({
  id: Id,
  title: z.string().default(''),
  pov: Id,
  location: Id,
  time: z.string().default(''),
  purpose: z.string().default(''),
  beats: z.array(z.string()).default([]),
  characters: z.array(Id).default([]),
  threads_touched: z.array(Id).default([]),
  plot_points: z.array(Id).default([]),
  /** Facts that become true / known in this scene. */
  reveals: z.array(Id).default([]),
  /** Facts a character speaks about or acts on in this scene. */
  mentions: z.array(Mention).default([]),
  /** Expected character-state deltas, checked against extraction. */
  deltas: z.array(StateDelta).default([]),
  /** Obligations this scene plants (clues, promises, questions, Chekhov's guns). */
  sets_up: z.array(Id).default([]),
  /** Obligations this scene pays off. */
  pays_off: z.array(Id).default([]),
  outcome: z.string().default(''),
  status: Status.default('draft'),
  lock: Lock.default('none'),
  // Life stories: the memories behind the scene, and the two narrators.
  stories: z.array(Id).optional(),
  /** What the narrator knew and felt at the time. */
  then: z.string().optional(),
  /** What the narrator understands looking back. */
  now: z.string().optional(),
});
export type SceneCard = z.infer<typeof SceneCard>;

// ---------------------------------------------------------------- obligations/<id>.yaml

/**
 * The obligations ledger: everything the book promises the reader and must pay off.
 * A setup is planted in one scene and paid off in a later one; until then it is open,
 * and the writer is told to keep it alive without resolving it.
 */
export const Obligation = z.object({
  id: Id,
  kind: z.enum(['clue', 'promise', 'question', 'foreshadowing', 'chekhov', 'reveal']).default('clue'),
  description: z.string().min(1),
  setup_scene: Id.nullable().default(null),
  /** Earliest scene the payoff may happen in (defaults to right after the setup). */
  eligible_from: Id.nullable().default(null),
  payoff_scene: Id.nullable().default(null),
  status: z.enum(['planned', 'open', 'paid', 'dropped']).default('planned'),
  threads: z.array(Id).default([]),
  facts: z.array(Id).default([]),
  notes: z.string().default(''),
});
export type Obligation = z.infer<typeof Obligation>;

// ---------------------------------------------------------------- scenes/<id>/prose.md (frontmatter)

export const ProseMeta = z.object({
  word_count: z.number().int().nonnegative().default(0),
  /** Hash of the card this prose was generated from (or last reconciled with). */
  generated_from: z.string().nullable().default(null),
  /** Hash of the prose at last extraction. */
  last_extracted: z.string().nullable().default(null),
  status: Status.default('draft'),
});
export type ProseMeta = z.infer<typeof ProseMeta>;

// ---------------------------------------------------------------- scenes/<id>/facts.yaml (derived)

export const Fact = z.object({
  subject: Id,
  predicate: z.enum(['knows', 'mentions', 'located_at', 'feels', 'wants', 'dies', 'event']),
  object: z.string(),
  confidence: z.number().min(0).max(1).default(1),
});
export type Fact = z.infer<typeof Fact>;

export const Contradiction = z.object({ field: z.string(), card_says: z.string(), prose_says: z.string() });
export type Contradiction = z.infer<typeof Contradiction>;

export const SceneFacts = z.object({
  extracted_from: z.string().nullable().default(null),
  facts: z.array(Fact).default([]),
  /** Where the prose disagreed with the card at extraction. The scene is flagged until resolved. */
  contradictions: z.array(Contradiction).default([]),
  /** What the prose actually did with each obligation. */
  obligations: z.array(z.object({ id: Id, action: z.enum(['planted', 'paid', 'referenced']) })).default([]),
});
export type SceneFacts = z.infer<typeof SceneFacts>;

// ---------------------------------------------------------------- idea.yaml (the ideation board)

export const IdeaItem = z.object({
  id: z.string(),
  kind: z.enum(['logline', 'what-if', 'character', 'setting', 'twist', 'theme', 'image', 'note']),
  text: z.string(),
  probability: z.number().min(0).max(1).default(0.5),
  persona: z.string().default(''),
  status: z.enum(['new', 'kept', 'discarded']).default('new'),
  /** Close to a known cliché (embedding similarity) or a stock LLM name/setting. */
  near_cliche: z.string().nullable().default(null),
  /** Added by the author rather than generated. */
  mine: z.boolean().default(false),
});
export type IdeaItem = z.infer<typeof IdeaItem>;

export const CastSketch = z.object({ id: Id, name: z.string(), role: z.string(), want: z.string(), need: z.string(), wound: z.string(), lie: z.string(), arc: z.string() });
export type CastSketch = z.infer<typeof CastSketch>;

/** One edit a conversation turn made to the board, kept so the turn can be undone. */
export const TalkChange = z.object({
  /** A board field ("logline", "themes"…) or an item ("idea:<id>", "cast:<id>"). */
  path: z.string(),
  label: z.string(),
  before: z.unknown().default(null),
  after: z.unknown().default(null),
});
export type TalkChange = z.infer<typeof TalkChange>;

export const TalkTurn = z.object({
  role: z.enum(['author', 'partner']),
  text: z.string(),
  /** The part of the board the author pointed at, if any ("logline", "cast:mara"). */
  focus: z.string().nullable().default(null),
  changes: z.array(TalkChange).default([]),
  /** The author took this turn's changes back. */
  undone: z.boolean().default(false),
});
export type TalkTurn = z.infer<typeof TalkTurn>;

export const IdeaBoard = z.object({
  seed: z.string().default(''),
  genre: z.string().default(''),
  cliches: z.array(z.string()).default([]),
  pile: z.array(IdeaItem).default([]),
  logline: z.string().default(''),
  logline_options: z.array(z.string()).default([]),
  paragraph: z.string().default(''),
  paragraph_options: z.array(z.string()).default([]),
  synopsis: z.string().default(''),
  synopsis_options: z.array(z.string()).default([]),
  cast: z.array(CastSketch).default([]),
  /** Settled while talking it through; carried into the intent with the premise. */
  tone: z.string().default(''),
  ending: z.string().default(''),
  themes: z.array(z.string()).default([]),
  /** Things the book must never do: they become hard rules. */
  never: z.array(z.string()).default([]),
  /** Questions the conversation has raised and not yet settled. */
  open: z.array(z.string()).default([]),
  /** The thinking-partner conversation, oldest first. */
  talk: z.array(TalkTurn).default([]),
  done: z.boolean().default(false),
});
export type IdeaBoard = z.infer<typeof IdeaBoard>;

// ---------------------------------------------------------------- style/style.yaml

/**
 * The style sheet: dials, each of which maps to a check. "Enforced" rules are checked on
 * every word by code; "guided" ones are measured and judged. See style-check.ts.
 */
export const StyleSheet = z.object({
  spelling: z.enum(['any', 'uk', 'us']).default('any'),
  quotes: z.enum(['any', 'single', 'double']).default('any'),
  dialogue_tags: z.enum(['any', 'simple', 'said-only']).default('any'),
  em_dashes: z.enum(['allow', 'limit', 'ban']).default('limit'),
  em_dashes_per_1000: z.number().min(0).default(3),
  semicolons: z.enum(['allow', 'dialogue-only', 'ban']).default('allow'),
  exclamations: z.enum(['allow', 'dialogue-only', 'ban']).default('dialogue-only'),
  contractions: z.enum(['any', 'avoid-in-narration']).default('any'),
  sentence_words: z
    .object({ mean_min: z.number().default(7), mean_max: z.number().default(24), max: z.number().default(60) })
    .default({ mean_min: 7, mean_max: 24, max: 60 }),
  dialogue_share: z.object({ min: z.number().default(0), max: z.number().default(0.75) }).default({ min: 0, max: 0.75 }),
  paragraph_sentences_max: z.number().int().positive().default(9),
  adverbs_per_1000_max: z.number().min(0).default(14),
  filter_words_per_1000_max: z.number().min(0).default(6),
  /** Words and phrases that must never appear. */
  never: z.array(z.string()).default([]),
  /** Always use one word instead of another. */
  prefer: z.array(z.object({ avoid: z.string(), use: z.string() })).default([]),
  /** Rules a model judges rather than code checks ("feeling carried in objects, not named"). */
  guidance: z.array(z.string()).default([]),
  /** Repair rounds after drafting before remaining issues go to the author. */
  repair_passes: z.number().int().min(0).max(4).default(2),
});
export type StyleSheet = z.infer<typeof StyleSheet>;

// ---------------------------------------------------------------- locations.yaml (optional glossary)

export const Location = z.object({ id: Id, name: z.string(), description: z.string().default(''), near: z.array(Id).default([]) });
export type Location = z.infer<typeof Location>;
export const Locations = z.object({ locations: z.array(Location).default([]) });
export type Locations = z.infer<typeof Locations>;

// ---------------------------------------------------------------- facts glossary (optional)

export const FactDef = z.object({ id: Id, statement: z.string() });
export type FactDef = z.infer<typeof FactDef>;
export const FactGlossary = z.object({ facts: z.array(FactDef).default([]) });
export type FactGlossary = z.infer<typeof FactGlossary>;

// ================================================================ life stories

/** Where something the author said lives: a session and a turn in it. */
export const TurnRef = z.object({ session: Id, turn: z.number().int().nonnegative() });
export type TurnRef = z.infer<typeof TurnRef>;

/** How far a story has been drawn out: a gist is not a scene. */
export const LADDER = ['happened', 'instance', 'people', 'senses', 'words', 'felt_then', 'means_now'] as const;
export type Rung = (typeof LADDER)[number];
export const RungState = z.enum(['no', 'some', 'yes']);
export const Ladder = z.object(Object.fromEntries(LADDER.map((r) => [r, RungState.default('no')])) as Record<Rung, z.ZodDefault<typeof RungState>>);
export type Ladder = z.infer<typeof Ladder>;
export const EMPTY_LADDER: Ladder = Object.fromEntries(LADDER.map((r) => [r, 'no'])) as Ladder;

/**
 * stories/<id>.yaml: one remembered episode, the unit a ghostwriter turns into a scene.
 * Everything in it comes from what the author (or someone they asked) said, with its source.
 */
export const Story = z.object({
  id: Id,
  title: z.string().min(1),
  /** In the author's words, as far as possible. */
  summary: z.string().default(''),
  when: z.string().default(''),
  precision: DatePrecision.optional(),
  people: z.array(Id).default([]),
  place: z.string().default(''),
  chapter: Id.nullable().default(null),
  key: KeyMoment.nullable().default(null),
  ladder: Ladder.default(EMPTY_LADDER),
  /** Things that were said, kept word for word: revisions may not change them. */
  quotes: z.array(z.object({ text: z.string().min(1), who: z.string().default(''), from: TurnRef.nullable().default(null) })).default([]),
  /** Details the author gave, each traceable to where they said it. */
  details: z.array(z.object({ text: z.string().min(1), from: TurnRef.nullable().default(null), source: Provenance.default('memory'), certainty: Certainty.default('sure') })).default([]),
  /** The same story told differently (in two sessions, or by someone else). */
  versions: z.array(z.object({ text: z.string(), from: TurnRef.nullable().default(null), by: z.string().default('') })).default([]),
  /** What it meant then and what it means now, in the author's words. */
  then: z.string().default(''),
  now: z.string().default(''),
  sensitive: z.boolean().default(false),
  status: z.enum(['gathering', 'enough', 'parked', 'cut']).default('gathering'),
});
export type Story = z.infer<typeof Story>;

export const SessionTurn = z.object({
  role: z.enum(['ghostwriter', 'author']),
  text: z.string(),
  /** Ghostwriter turns: the interviewing technique ("one particular time", "then and now"). */
  technique: z.string().default(''),
  /** Ghostwriter turns: why it asked. */
  why: z.string().default(''),
  /** Author turns: the recordings (audio/<session>/<file>) and what the recogniser heard. */
  audio: z.array(z.string()).default([]),
  raw: z.string().nullable().default(null),
  seconds: z.number().nonnegative().default(0),
  /** Author turns kept out of the book entirely. */
  off_record: z.boolean().default(false),
  /** The story this exchange was about. */
  story: Id.nullable().default(null),
  /** What this turn filed, so it can be undone. */
  changes: z.array(TalkChange).default([]),
  undone: z.boolean().default(false),
});
export type SessionTurn = z.infer<typeof SessionTurn>;

/** sessions/<id>/session.yaml: one sitting with the ghostwriter. */
export const Session = z.object({
  id: Id,
  title: z.string().default(''),
  started: z.string(),
  ended: z.string().nullable().default(null),
  minutes: z.number().int().min(5).max(180).default(30),
  /** Who is answering: the narrator, or someone else asked about the narrator's life. */
  speaker: z.string().default(''),
  agenda: z.array(z.object({ topic: z.string(), why: z.string().default(''), question: z.string().default(''), story: Id.nullable().default(null), question_id: Id.nullable().default(null), done: z.boolean().default(false) })).default([]),
  turns: z.array(SessionTurn).default([]),
  /** Filled in when the session ends. */
  summary: z.string().default(''),
});
export type Session = z.infer<typeof Session>;

/** ghostwriter/questions.yaml: what the ghostwriter still wants to ask, and why. */
export const Question = z.object({
  id: Id,
  text: z.string().min(1),
  why: z.string().default(''),
  technique: z.string().default(''),
  /** What it is about: "story:<id>", "chapter:<id>", "person:<id>", "period:1984-1993", "book". */
  about: z.string().default('book'),
  /** Who to ask: the author (empty), or a person id ("ask Peter"). */
  ask: z.string().default(''),
  priority: z.number().int().min(1).max(3).default(2),
  status: z.enum(['queued', 'asked', 'answered', 'parked', 'off-limits']).default('queued'),
  asked_in: Id.nullable().default(null),
});
export type Question = z.infer<typeof Question>;
export const Questions = z.object({ questions: z.array(Question).default([]) });
export type Questions = z.infer<typeof Questions>;

/** ghostwriter/notebook.yaml: what the ghostwriter has learned about the author. The author can edit it. */
export const Notebook = z.object({
  /** How the author talks: phrases, rhythm, what they never say. */
  voice: z.array(z.string()).default([]),
  /** Topics never to raise. */
  off_limits: z.array(z.string()).default([]),
  /** Stories it said it would come back to. */
  promises: z.array(z.string()).default([]),
  /** Decisions the author made after the ghostwriter argued its case ("keep the last line"). */
  decisions: z.array(z.string()).default([]),
});
export type Notebook = z.infer<typeof Notebook>;

/** scenes/<id>/notes.yaml: the ghostwriter's margin notes on a draft. */
export const MarginNote = z.object({
  id: z.string(),
  kind: z.enum(['gap', 'versions', 'thin', 'voice', 'source']),
  /** Exact text in the prose the note is attached to (empty: the whole scene). */
  quote: z.string().default(''),
  text: z.string().min(1),
  /** Choices to answer with (two versions: "Session 3", "Session 7"). */
  options: z.array(z.string()).default([]),
  status: z.enum(['open', 'answered', 'resolved', 'dismissed', 'later']).default('open'),
  answer: z.string().default(''),
  round: z.number().int().nonnegative().default(1),
});
export type MarginNote = z.infer<typeof MarginNote>;
export const SceneNotes = z.object({ notes: z.array(MarginNote).default([]) });
export type SceneNotes = z.infer<typeof SceneNotes>;

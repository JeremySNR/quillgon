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

export const ModelConfig = z.object({
  provider: z.enum(['anthropic', 'openai-compatible', 'offline']).default('anthropic'),
  model: z.string(),
  base_url: z.string().optional(),
  api_key_env: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  /** USD per million tokens, used for cost logging and `novel estimate`. */
  price_in: z.number().optional(),
  price_out: z.number().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

export const AgentName = z.enum([
  'interviewer',
  'planner',
  'writer',
  'reviser',
  'extractor',
  'voice',
  'humaniser',
  'reader',
  'continuity',
]);
export type AgentName = z.infer<typeof AgentName>;

export const DEFAULT_MODELS: Record<ModelTier, ModelConfig> = {
  frontier: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', price_in: 4, price_out: 20 },
  mid: { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium', price_in: 2, price_out: 10 },
  small: { provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low', price_in: 0.1, price_out: 0.5 },
  reader: { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium', price_in: 2, price_out: 10 },
};

export const DEFAULT_AGENT_TIERS: Record<AgentName, ModelTier> = {
  interviewer: 'frontier',
  planner: 'frontier',
  writer: 'frontier',
  reviser: 'frontier',
  extractor: 'mid',
  voice: 'mid',
  humaniser: 'mid',
  reader: 'reader',
  continuity: 'small',
};

export const PipelineStage = z.enum(['intent', 'plot-points', 'structure', 'cards', 'prose', 'complete']);
export type PipelineStage = z.infer<typeof PipelineStage>;

export const Book = z.object({
  title: z.string().min(1),
  genre: z.string().default(''),
  target_words: z.number().int().positive().default(12000),
  pov_mode: z.enum(['first', 'third-limited', 'third-omniscient', 'multiple']).default('third-limited'),
  tense: z.enum(['past', 'present']).default('past'),
  stage: PipelineStage.default('intent'),
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
  /** Markdown body of bio.md. */
  background: z.string().default(''),
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

export const TimelineEvent = z.object({
  id: Id,
  /** Sortable story-world time, e.g. "1926-03-14T21:00" or "d03-evening". */
  when: z.string(),
  description: z.string(),
  scenes: z.array(Id).default([]),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const Timeline = z.object({ events: z.array(TimelineEvent).default([]) });
export type Timeline = z.infer<typeof Timeline>;

// ---------------------------------------------------------------- structure.yaml

export const Chapter = z.object({ id: Id, title: z.string().default(''), scenes: z.array(Id).default([]) });
export type Chapter = z.infer<typeof Chapter>;
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
  outcome: z.string().default(''),
  status: Status.default('draft'),
  lock: Lock.default('none'),
});
export type SceneCard = z.infer<typeof SceneCard>;

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

export const SceneFacts = z.object({
  extracted_from: z.string().nullable().default(null),
  facts: z.array(Fact).default([]),
});
export type SceneFacts = z.infer<typeof SceneFacts>;

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

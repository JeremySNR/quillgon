import { z } from 'zod';
import {
  Act,
  CastSketch,
  CharacterBio,
  CharacterVoice,
  Fact,
  Id,
  IdeaBoard,
  IdeaItem,
  Intent,
  KeyMoment,
  DatePrecision,
  Certainty,
  Ladder,
  Story,
  Obligation,
  PlotPoint,
  SceneCard,
  StateSnapshot,
  Thread,
} from '../schemas/index.js';

/**
 * Structured contracts for every agent. Agents return these and nothing else;
 * the core validates with Zod and rejects anything that does not parse.
 * Every output may carry `needs_decision`: things the agent will not invent.
 */

const NeedsDecision = z.array(z.string()).default([]);

// ------------------------------------------------------------------ interviewer

export const InterviewInput = z.object({
  premise: z.string(),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  /** Already decided (usually while talking the idea through): not to be asked again. */
  known: Intent.pick({ themes: true, tone: true, ending_type: true, hard_rules: true }).partial().default({}),
});
export type InterviewInput = z.infer<typeof InterviewInput>;

export const InterviewOutput = z.object({
  done: z.boolean(),
  /** Only questions the agent cannot infer from the premise. At most five. */
  questions: z.array(z.string()).max(5).default([]),
  intent: Intent.omit({ approved: true }).partial().optional(),
  needs_decision: NeedsDecision,
});
export type InterviewOutput = z.infer<typeof InterviewOutput>;

// ------------------------------------------------------------------ planner: plot points

export const CastMember = z.object({ id: Id, name: z.string(), role: z.string().default('') });

export const PlotPointsInput = z.object({
  intent: Intent,
  pinned: z.array(PlotPoint),
  cast: z.array(CastMember).default([]),
  target_words: z.number(),
});
export type PlotPointsInput = z.infer<typeof PlotPointsInput>;

export const PlotPointsOutput = z.object({
  plot_points: z.array(PlotPoint.omit({ locked: true, proposed: true })).min(1).max(12),
  cast: z.array(CastMember).default([]),
  needs_decision: NeedsDecision,
});
export type PlotPointsOutput = z.infer<typeof PlotPointsOutput>;

// ------------------------------------------------------------------ planner: structure

export const CharacterDraft = z.object({ bio: CharacterBio, voice: CharacterVoice });
export type CharacterDraft = z.infer<typeof CharacterDraft>;

export const StructureAlternative = z.object({
  label: z.string(),
  /** One obvious option and at least one that breaks an expectation. */
  kind: z.enum(['obvious', 'unexpected', 'wildcard']),
  rationale: z.string(),
  acts: z.array(
    Act.extend({
      chapters: z.array(z.object({ id: Id, title: z.string(), summary: z.string(), scene_count: z.number().int().min(1).max(8) })),
    }),
  ),
  threads: z.array(Thread.omit({ setup_scene: true, payoff_scene: true, beats: true }).extend({ setup_chapter: Id.nullable(), payoff_chapter: Id.nullable() })),
  characters: z.array(CharacterDraft),
});
export type StructureAlternative = z.infer<typeof StructureAlternative>;

export const StructureInput = z.object({
  intent: Intent,
  plot_points: z.array(PlotPoint),
  cast: z.array(CastMember),
  target_words: z.number(),
  avoid: z.array(z.string()).default([]),
});
export type StructureInput = z.infer<typeof StructureInput>;

export const StructureOutput = z.object({
  alternatives: z.array(StructureAlternative).min(1).max(3),
  needs_decision: NeedsDecision,
});
export type StructureOutput = z.infer<typeof StructureOutput>;

// ------------------------------------------------------------------ planner: scene cards

export const CardsInput = z.object({
  intent: Intent,
  chapter: z.object({ id: Id, title: z.string(), summary: z.string(), scene_count: z.number() }),
  first_scene_number: z.number().int(),
  plot_points: z.array(PlotPoint),
  threads: z.array(Thread),
  characters: z.array(z.object({ id: Id, name: z.string(), role: z.string(), knows: z.array(Id) })),
  locations: z.array(z.object({ id: Id, name: z.string() })),
  facts: z.array(z.object({ id: Id, statement: z.string() })),
  /** Open and planned obligations: setups waiting for a payoff. */
  obligations: z.array(Obligation).default([]),
  previous_cards: z.array(SceneCard),
  words_per_scene: z.number(),
});
export type CardsInput = z.infer<typeof CardsInput>;

export const CardDraft = SceneCard.omit({ status: true, lock: true });
export type CardDraft = z.infer<typeof CardDraft>;

export const CardsOutput = z.object({
  alternatives: z
    .array(
      z.object({
        label: z.string(),
        kind: z.enum(['obvious', 'unexpected']),
        rationale: z.string(),
        cards: z.array(CardDraft).min(1),
        new_facts: z.array(z.object({ id: Id, statement: z.string() })).default([]),
        new_locations: z.array(z.object({ id: Id, name: z.string(), description: z.string().default('') })).default([]),
        /** Setups this chapter plants; reference them from cards' sets_up / pays_off. */
        new_obligations: z
          .array(z.object({ id: Id, kind: Obligation.shape.kind, description: z.string(), payoff_hint: z.string().default('') }))
          .default([]),
      }),
    )
    .min(1)
    .max(2),
  needs_decision: NeedsDecision,
});
export type CardsOutput = z.infer<typeof CardsOutput>;

// ------------------------------------------------------------------ writer

export const WriterInput = z.object({
  intent: Intent,
  book: z.object({ title: z.string(), pov_mode: z.string(), tense: z.string() }),
  card: SceneCard,
  previous_prose: z.string().nullable(),
  /** The book before this scene, compressed (chapter summaries, earlier outcomes). */
  story_so_far: z.string().default(''),
  recent_cards: z.array(SceneCard),
  states: z.array(z.object({ character: Id, name: z.string(), snapshot: StateSnapshot.nullable() })),
  voices: z.array(z.object({ character: Id, name: z.string(), voice: CharacterVoice })),
  threads: z.array(Thread),
  facts: z.array(z.object({ id: Id, statement: z.string() })),
  style_samples: z.string(),
  banned_patterns: z.array(z.string()),
  similar_scenes: z.array(z.object({ id: Id, excerpt: z.string() })),
  target_words: z.number(),
  obligations: z
    .object({
      plant: z.array(Obligation).default([]),
      pay: z.array(Obligation).default([]),
      keep_open: z.array(Obligation).default([]),
    })
    .default({ plant: [], pay: [], keep_open: [] }),
  /** The style sheet rendered as rules. */
  style_rules: z.array(z.string()).default([]),
});
export type WriterInput = z.infer<typeof WriterInput>;

export const WriterOutput = z.object({ prose: z.string().min(1), needs_decision: NeedsDecision });
export type WriterOutput = z.infer<typeof WriterOutput>;

// ------------------------------------------------------------------ voice checker

export const VoiceInput = z.object({
  scene: Id,
  lines: z.array(z.object({ character: Id, line: z.string() })),
  voices: z.array(z.object({ character: Id, name: z.string(), voice: CharacterVoice })),
});
export type VoiceInput = z.infer<typeof VoiceInput>;

export const VoiceFlag = z.object({ character: Id, line: z.string(), reason: z.string(), suggestion: z.string().nullable().default(null) });
export type VoiceFlag = z.infer<typeof VoiceFlag>;
export const VoiceOutput = z.object({ flags: z.array(VoiceFlag).default([]) });
export type VoiceOutput = z.infer<typeof VoiceOutput>;

// ------------------------------------------------------------------ reviser

export const ReviseLinesInput = z.object({
  prose: z.string(),
  flags: z.array(z.object({ text: z.string(), reason: z.string(), suggestion: z.string().nullable() })),
});
export type ReviseLinesInput = z.infer<typeof ReviseLinesInput>;

export const ProseOutput = z.object({ prose: z.string().min(1), summary: z.string().default(''), needs_decision: NeedsDecision });
export type ProseOutput = z.infer<typeof ProseOutput>;

export const ReviseCardInput = z.object({
  intent: Intent,
  change: z.string(),
  reasons: z.array(z.string()),
  card: SceneCard,
  facts: z.array(z.object({ id: Id, statement: z.string() })),
  characters: z.array(z.object({ id: Id, name: z.string() })),
  states_before: z.array(z.object({ character: Id, knows: z.array(Id) })),
});
export type ReviseCardInput = z.infer<typeof ReviseCardInput>;

export const ReviseCardOutput = z.object({
  action: z.enum(['no_change', 'revise']),
  justification: z.string(),
  card: CardDraft.optional(),
  needs_decision: NeedsDecision,
});
export type ReviseCardOutput = z.infer<typeof ReviseCardOutput>;

export const ReviseProseInput = z.object({
  intent: Intent,
  change: z.string(),
  old_card: SceneCard,
  new_card: SceneCard,
  old_prose: z.string(),
  voices: z.array(z.object({ character: Id, name: z.string(), voice: CharacterVoice })),
});
export type ReviseProseInput = z.infer<typeof ReviseProseInput>;

// ------------------------------------------------------------------ humaniser

export const HumaniseInput = z.object({
  prose: z.string(),
  skill: z.string(),
  banned_hits: z.array(z.object({ text: z.string(), rule: z.string() })).default([]),
  /** Style violations found by code, each with the exact offending text. */
  violations: z.array(z.object({ rule: z.string(), text: z.string(), message: z.string() })).default([]),
  style_rules: z.array(z.string()).default([]),
  style_samples: z.string().default(''),
});
export type HumaniseInput = z.infer<typeof HumaniseInput>;

/** LAMP's seven categories of AI-writing habit, plus explicit style-sheet violations. */
export const EditCategory = z.enum([
  'cliche',
  'unnecessary-exposition',
  'purple-prose',
  'poor-sentence-structure',
  'lack-of-specificity',
  'awkward-word-choice',
  'tense-inconsistency',
  'style-rule',
]);

export const SpanEdit = z.object({
  /** Exact text from the prose to replace (must occur once). */
  find: z.string().min(1),
  replace: z.string(),
  category: EditCategory,
  reason: z.string().default(''),
});
export type SpanEdit = z.infer<typeof SpanEdit>;

export const LineEditOutput = z.object({ edits: z.array(SpanEdit).max(40).default([]) });
export type LineEditOutput = z.infer<typeof LineEditOutput>;

// ------------------------------------------------------------------ extractor

export const ExtractInput = z.object({
  card: SceneCard,
  prose: z.string(),
  characters: z.array(z.object({ id: Id, name: z.string(), aliases: z.array(z.string()) })),
  facts: z.array(z.object({ id: Id, statement: z.string() })),
  locations: z.array(z.object({ id: Id, name: z.string() })),
  states_before: z.array(z.object({ character: Id, snapshot: StateSnapshot.nullable() })),
  obligations: z.array(Obligation).default([]),
});
export type ExtractInput = z.infer<typeof ExtractInput>;

export const ExtractOutput = z.object({
  facts: z.array(Fact),
  states: z.array(
    z.object({
      character: Id,
      learns: z.array(Id).default([]),
      forgets: z.array(Id).default([]),
      location: Id.nullable().default(null),
      wants: z.string().nullable().default(null),
      feels: z.record(Id, z.string()).default({}),
      alive: z.boolean().default(true),
    }),
  ),
  timeline: z.array(z.object({ when: z.string(), description: z.string() })).default([]),
  new_facts: z.array(z.object({ id: Id, statement: z.string() })).default([]),
  contradictions: z.array(z.object({ field: z.string(), card_says: z.string(), prose_says: z.string() })).default([]),
  obligations: z.array(z.object({ id: Id, action: z.enum(['planted', 'paid', 'referenced']) })).default([]),
});
export type ExtractOutput = z.infer<typeof ExtractOutput>;

// ------------------------------------------------------------------ reader

export const ReaderLogEntry = z.object({
  scene: Id,
  believes: z.string(),
  expects: z.string(),
  confusions: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
  resolved_confusions: z.array(z.string()).default([]),
  engagement: z.number().int().min(1).max(5),
  predictions: z.array(z.string()).default([]),
  /** When asked: looking back, did this scene's reveal feel fair (1-5)? */
  fairness: z.number().int().min(1).max(5).nullable().default(null),
});
export type ReaderLogEntry = z.infer<typeof ReaderLogEntry>;

export const ReaderInput = z.object({
  scene: Id,
  scene_number: z.number().int(),
  prose: z.string(),
  /** The latest entries of the reader's log, in full. */
  log: z.array(ReaderLogEntry),
  /** What the reader still carries from older scenes, once the log is longer than the window. */
  earlier: z
    .object({ scenes_read: z.number().int(), predictions: z.array(z.string()), open_confusions: z.array(z.object({ id: z.string(), text: z.string() })) })
    .nullable()
    .default(null),
  /** Set when this scene reveals something: ask whether it was fair in hindsight. */
  fairness_question: z.string().nullable().default(null),
  /** 'prose' for the manuscript; 'outline' when reading scene synopses before anything is written. */
  mode: z.enum(['prose', 'outline']).default('prose'),
});
export type ReaderInput = z.infer<typeof ReaderInput>;

export const ReaderOutput = ReaderLogEntry.omit({ scene: true });
export type ReaderOutput = z.infer<typeof ReaderOutput>;

// ------------------------------------------------------------------ continuity (model-assisted)

export const ContinuityInput = z.object({
  a: z.object({ id: Id, card: SceneCard, prose: z.string() }),
  b: z.object({ id: Id, card: SceneCard, prose: z.string() }),
  states: z.array(z.object({ character: Id, name: z.string(), after_a: StateSnapshot.nullable() })),
});
export type ContinuityInput = z.infer<typeof ContinuityInput>;

export const ContinuityOutput = z.object({
  contradictions: z.array(z.object({ scene: Id, description: z.string(), severity: z.enum(['low', 'medium', 'high']) })).default([]),
});
export type ContinuityOutput = z.infer<typeof ContinuityOutput>;

// ------------------------------------------------------------------ judge (pairwise)

export const JudgeInput = z.object({
  /** What the two texts are trying to be. */
  task: z.string(),
  criteria: z.array(z.string()),
  a: z.string(),
  b: z.string(),
  /** Reference passages the winner should sound like (the author's own). */
  reference: z.string().default(''),
});
export type JudgeInput = z.infer<typeof JudgeInput>;

export const JudgeOutput = z.object({ winner: z.enum(['a', 'b', 'tie']), reason: z.string() });
export type JudgeOutput = z.infer<typeof JudgeOutput>;

// ------------------------------------------------------------------ critic (narrative shape)

export const ShapeFinding = z.object({
  kind: z.enum([
    'theme-stated',
    'single-track',
    'flat-escalation',
    'tidy-resolution',
    'no-moral-ambiguity',
    'archetype',
    'rushed',
    'sagging-middle',
    'passive-protagonist',
    'coincidence',
    'unpaid-setup',
    'other',
  ]),
  where: z.string(),
  evidence: z.string(),
  suggestion: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
});
export type ShapeFinding = z.infer<typeof ShapeFinding>;

export const CritiqueInput = z.object({
  intent: Intent,
  level: z.enum(['structure', 'chapter', 'book']),
  /** The plan being judged, as readable text (synopsis, chapters, beats). */
  plan: z.string(),
  characters: z.array(z.object({ id: Id, name: z.string(), want: z.string(), need: z.string(), arc: z.string() })).default([]),
});
export type CritiqueInput = z.infer<typeof CritiqueInput>;

export const CritiqueOutput = z.object({ findings: z.array(ShapeFinding).default([]), strengths: z.array(z.string()).default([]) });
export type CritiqueOutput = z.infer<typeof CritiqueOutput>;

// ------------------------------------------------------------------ sameness sampling

export const SampleTurnsInput = z.object({
  intent: Intent,
  /** The story so far, as card synopses. */
  context: z.string(),
  /** What the scene or chapter needs to do, without its chosen outcome. */
  setup: z.string(),
  k: z.number().int().min(3).max(10).default(6),
});
export type SampleTurnsInput = z.infer<typeof SampleTurnsInput>;

export const SampleTurnsOutput = z.object({ turns: z.array(z.object({ text: z.string(), probability: z.number().min(0).max(1) })).min(1) });
export type SampleTurnsOutput = z.infer<typeof SampleTurnsOutput>;

// ------------------------------------------------------------------ muse (ideation)

export const IdeaKind = z.enum(['logline', 'what-if', 'character', 'setting', 'twist', 'theme', 'image']);
export const IdeaCandidate = z.object({
  kind: IdeaKind,
  text: z.string(),
  /** The model's own estimate of how typical this idea is (verbalized sampling). */
  probability: z.number().min(0).max(1),
  persona: z.string().default(''),
});
export type IdeaCandidate = z.infer<typeof IdeaCandidate>;

export const DivergeInput = z.object({
  seed: z.string(),
  genre: z.string().default(''),
  persona: z.string(),
  kinds: z.array(IdeaKind),
  kept: z.array(z.string()).default([]),
  discarded: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  k: z.number().int().min(3).max(12).default(8),
});
export type DivergeInput = z.infer<typeof DivergeInput>;

export const DivergeOutput = z.object({
  /** The genre's stock moves for this seed, listed first so the ideas can branch away from them. */
  cliches: z.array(z.string()).default([]),
  candidates: z.array(IdeaCandidate).min(1),
});
export type DivergeOutput = z.infer<typeof DivergeOutput>;

export const ExpandInput = z.object({
  step: z.enum(['logline', 'paragraph', 'synopsis', 'cast']),
  seed: z.string(),
  kept: z.array(z.string()).default([]),
  logline: z.string().default(''),
  paragraph: z.string().default(''),
  synopsis: z.string().default(''),
  avoid: z.array(z.string()).default([]),
});
export type ExpandInput = z.infer<typeof ExpandInput>;

export const ExpandOutput = z.object({
  options: z.array(z.string()).default([]),
  cast: z
    .array(
      z.object({
        id: Id,
        name: z.string(),
        role: z.string(),
        want: z.string(),
        need: z.string(),
        wound: z.string(),
        lie: z.string(),
        arc: z.string(),
      }),
    )
    .default([]),
});
export type ExpandOutput = z.infer<typeof ExpandOutput>;

export const TalkInput = z.object({
  /** The board as it stands; the conversation's memory is what has been written here. */
  board: IdeaBoard.omit({ talk: true, logline_options: true, paragraph_options: true, synopsis_options: true, done: true }),
  history: z.array(z.object({ role: z.enum(['author', 'partner']), text: z.string(), undone: z.boolean().default(false) })).default([]),
  message: z.string().min(1),
  /** The part of the board the author is pointing at ("logline", "cast:mara", "idea:<id>"). */
  focus: z.string().nullable().default(null),
});
export type TalkInput = z.infer<typeof TalkInput>;

const Keep = z.string().nullable().default(null);

export const TalkOutput = z.object({
  /** What the partner says back: short, specific, usually ending in one question. */
  reply: z.string().min(1),
  /** Board fields to replace. null leaves a field exactly as it is. */
  set: z
    .object({ seed: Keep, genre: Keep, logline: Keep, paragraph: Keep, synopsis: Keep, tone: Keep, ending: Keep })
    .default({ seed: null, genre: null, logline: null, paragraph: null, synopsis: null, tone: null, ending: null }),
  /** Whole lists to replace; null leaves the list alone. */
  themes: z.array(z.string()).nullable().default(null),
  never: z.array(z.string()).nullable().default(null),
  open: z.array(z.string()).nullable().default(null),
  /** New ideas: the author's own (from what they said) or the partner's (to be sorted). */
  ideas: z
    .array(z.object({ kind: IdeaItem.shape.kind, text: z.string().min(1), from: z.enum(['author', 'partner']), probability: z.number().min(0).max(1).default(0.5) }))
    .default([]),
  /** Ids of ideas on the board the author has embraced or rejected in conversation. */
  keep: z.array(z.string()).default([]),
  bin: z.array(z.string()).default([]),
  /** People to add, or to update by id. Empty fields leave what is there. */
  cast: z.array(CastSketch.partial({ name: true, role: true, want: true, need: true, wound: true, lie: true, arc: true })).default([]),
  uncast: z.array(Id).default([]),
  /** Clichés the conversation has named, to steer away from. */
  avoid: z.array(z.string()).default([]),
});
export type TalkOutput = z.infer<typeof TalkOutput>;

// ------------------------------------------------------------------ scribe (dictation clean-up)

export const ScribeInput = z.object({
  /** What the recogniser heard. */
  raw: z.string().min(1),
  /** The text just before the cursor, so the dictation joins it (capitals, spacing). */
  before: z.string().default(''),
  after: z.string().default(''),
  /** How the names in this book are spelled. */
  dictionary: z.array(z.string()).default([]),
  level: z.enum(['light', 'polished']).default('light'),
  /** House style: spelling variant and quote marks. */
  style: z.object({ spelling: z.string().default('any'), quotes: z.string().default('any') }).default({ spelling: 'any', quotes: 'any' }),
});
export type ScribeInput = z.infer<typeof ScribeInput>;

export const ScribeOutput = z.object({ text: z.string() });
export type ScribeOutput = z.infer<typeof ScribeOutput>;

// ------------------------------------------------------------------ ghostwriter (life stories)

const PersonRef = z.object({ id: Id, name: z.string(), relationship: z.string().default('') });
const StoryBrief = z.object({
  id: Id,
  title: z.string(),
  when: z.string().default(''),
  chapter: Id.nullable().default(null),
  /** 0..1, how far it has been drawn out. */
  depth: z.number(),
  next: z.string().nullable().default(null),
  status: Story.shape.status,
  sensitive: z.boolean().default(false),
});
export type StoryBrief = z.infer<typeof StoryBrief>;

export const GhostPlanInput = z.object({
  minutes: z.number(),
  /** Who is answering: empty for the narrator. */
  speaker: z.string().default(''),
  narrator: z.string(),
  born: z.string().default(''),
  about: z.string().default(''),
  push: z.enum(['gentle', 'thorough']).default('thorough'),
  chapters: z.array(z.object({ id: Id, title: z.string(), stage: z.string(), stories: z.array(Id) })).default([]),
  stories: z.array(StoryBrief).default([]),
  people: z.array(PersonRef).default([]),
  /** Stretches of the life with nothing in them yet ("1984 to 1993"). */
  gaps: z.array(z.string()).default([]),
  questions: z.array(z.object({ id: Id, text: z.string(), why: z.string(), about: z.string(), priority: z.number() })).default([]),
  promises: z.array(z.string()).default([]),
  off_limits: z.array(z.string()).default([]),
  recent: z.array(z.object({ title: z.string(), summary: z.string() })).default([]),
});
export type GhostPlanInput = z.infer<typeof GhostPlanInput>;

export const GhostPlanOutput = z.object({
  title: z.string(),
  agenda: z.array(z.object({ topic: z.string(), why: z.string(), question: z.string(), story: Id.nullable().default(null), question_id: Id.nullable().default(null) })).min(1).max(5),
  /** The first thing the ghostwriter says: a short warm opening and one question. */
  opening: z.string().min(1),
  technique: z.string().default(''),
});
export type GhostPlanOutput = z.infer<typeof GhostPlanOutput>;

/** What the author pressed instead of (or as well as) answering. */
export const AuthorSignal = z.enum(['dont-remember', 'move-on', 'off-record', 'hard']);
export type AuthorSignal = z.infer<typeof AuthorSignal>;

export const GhostTurnInput = z.object({
  speaker: z.string().default(''),
  narrator: z.string(),
  born: z.string().default(''),
  push: z.enum(['gentle', 'thorough']).default('thorough'),
  agenda: z.array(z.object({ topic: z.string(), question: z.string(), done: z.boolean() })),
  /** The story being drawn out, in full; null when the conversation is not on one yet. */
  story: Story.nullable().default(null),
  /** The ladder rung to climb next, worked out in code. */
  next_rung: z.string().nullable().default(null),
  stories: z.array(StoryBrief).default([]),
  people: z.array(PersonRef).default([]),
  history: z.array(z.object({ role: z.enum(['ghostwriter', 'author']), text: z.string() })).default([]),
  answer: z.string(),
  signal: AuthorSignal.nullable().default(null),
  /** Follow-up triggers found in code ("vague answer: ask for one particular time"). */
  probes: z.array(z.string()).default([]),
  off_limits: z.array(z.string()).default([]),
  /** Feedback when the last proposed question was refused (a leading question, an off-limits topic). */
  retry: z.string().nullable().default(null),
});
export type GhostTurnInput = z.infer<typeof GhostTurnInput>;

export const GhostTurnOutput = z.object({
  /** The next thing to say: at most a short acknowledgement, then one open question (or a check-in). */
  reply: z.string().min(1),
  technique: z.string().default(''),
  why: z.string().default(''),
  /** Which story this exchange is about: an existing id, or a new one with a title. Null: none. */
  story: z
    .object({
      id: Id,
      title: z.string().default(''),
      summary: z.string().nullable().default(null),
      when: z.string().nullable().default(null),
      precision: DatePrecision.nullable().default(null),
      place: z.string().nullable().default(null),
      key: KeyMoment.nullable().default(null),
    })
    .nullable()
    .default(null),
  /** Rungs the answer climbed. */
  ladder: Ladder.partial().default({}),
  details: z.array(z.object({ text: z.string().min(1), certainty: Certainty.default('sure') })).default([]),
  quotes: z.array(z.object({ text: z.string().min(1), who: z.string().default('') })).default([]),
  then: z.string().nullable().default(null),
  now: z.string().nullable().default(null),
  people: z.array(z.object({ id: Id, name: z.string().min(1), relationship: z.string().default('') })).default([]),
  events: z.array(z.object({ when: z.string().min(1), description: z.string().min(1), precision: DatePrecision.nullable().default(null), key: KeyMoment.nullable().default(null) })).default([]),
  /** For later: gaps, other stories mentioned in passing, people to ask. */
  questions: z.array(z.object({ text: z.string().min(1), why: z.string().default(''), about: z.string().default('book'), ask: z.string().default(''), priority: z.number().int().min(1).max(3).default(2) })).default([]),
  promises: z.array(z.string()).default([]),
  /** How the author talks, if this answer showed something new. */
  voice: z.array(z.string()).default([]),
  /** Agenda items now covered (indexes). */
  agenda_done: z.array(z.number().int().nonnegative()).default([]),
});
export type GhostTurnOutput = z.infer<typeof GhostTurnOutput>;

export const GhostWrapInput = z.object({
  narrator: z.string(),
  agenda: z.array(z.object({ topic: z.string(), done: z.boolean() })),
  history: z.array(z.object({ role: z.enum(['ghostwriter', 'author']), text: z.string() })),
  stories: z.array(StoryBrief).default([]),
});
export type GhostWrapInput = z.infer<typeof GhostWrapInput>;

export const GhostWrapOutput = z.object({
  title: z.string(),
  summary: z.string(),
  questions: z.array(z.object({ text: z.string().min(1), why: z.string().default(''), about: z.string().default('book'), ask: z.string().default(''), priority: z.number().int().min(1).max(3).default(2) })).default([]),
  promises: z.array(z.string()).default([]),
  voice: z.array(z.string()).default([]),
});
export type GhostWrapOutput = z.infer<typeof GhostWrapOutput>;

export const GhostShapeInput = z.object({
  narrator: z.string(),
  born: z.string().default(''),
  about: z.string().default(''),
  shape: z.string().nullable().default(null),
  target_words: z.number(),
  stories: z.array(z.object({ id: Id, title: z.string(), summary: z.string(), when: z.string(), key: z.string().nullable(), depth: z.number(), sensitive: z.boolean() })),
  /** Chapters the author already has; keep their ids. */
  chapters: z.array(z.object({ id: Id, title: z.string(), stories: z.array(Id) })).default([]),
});
export type GhostShapeInput = z.infer<typeof GhostShapeInput>;

export const GhostShapeOutput = z.object({
  rationale: z.string(),
  chapters: z.array(z.object({ id: Id, title: z.string().min(1), summary: z.string().default(''), stories: z.array(Id).default([]) })).min(1).max(40),
  /** Stories the shape leaves out: kept, not cut (a family edition may want them). */
  left_out: z.array(z.object({ id: Id, why: z.string() })).default([]),
});
export type GhostShapeOutput = z.infer<typeof GhostShapeOutput>;

export const NoteDraft = z.object({
  kind: z.enum(['gap', 'versions', 'thin', 'voice']),
  /** Exact text in the scene's prose the note is about ("[TK: the street]"). Empty: the whole scene. */
  quote: z.string().default(''),
  text: z.string().min(1),
  options: z.array(z.string()).default([]),
});
export type NoteDraft = z.infer<typeof NoteDraft>;

export const GhostDraftInput = z.object({
  narrator: z.string(),
  born: z.string().default(''),
  pen: z.string(),
  chapter: z.object({ id: Id, title: z.string(), summary: z.string(), number: z.number().int() }),
  /** Everything the chapter may draw on: the stories, as filed from the interviews. */
  stories: z.array(Story),
  people: z.array(z.object({ id: Id, name: z.string(), relationship: z.string(), naming: z.string() })),
  /** How the author talks: the notebook, and passages of their own spoken words. */
  voice_notes: z.array(z.string()).default([]),
  voice_samples: z.string().default(''),
  /** The chapter that set the voice, when this is not it. */
  voice_chapter: z.string().default(''),
  previous_ending: z.string().default(''),
  style_rules: z.array(z.string()).default([]),
  words: z.number(),
  hard_rules: z.array(z.string()).default([]),
});
export type GhostDraftInput = z.infer<typeof GhostDraftInput>;

export const GhostDraftOutput = z.object({
  scenes: z
    .array(
      z.object({
        title: z.string().min(1),
        stories: z.array(Id).default([]),
        when: z.string().default(''),
        place: z.string().default(''),
        people: z.array(Id).default([]),
        then: z.string().default(''),
        now: z.string().default(''),
        prose: z.string().min(1),
        notes: z.array(NoteDraft).default([]),
      }),
    )
    .min(1)
    .max(8),
  needs_decision: NeedsDecision,
});
export type GhostDraftOutput = z.infer<typeof GhostDraftOutput>;

export const GhostReviseInput = z.object({
  narrator: z.string(),
  chapter: z.object({ id: Id, title: z.string(), round: z.number().int() }),
  scenes: z.array(
    z.object({
      id: Id,
      title: z.string(),
      prose: z.string(),
      /** Notes with the author's answers, and ones still open. */
      notes: z.array(z.object({ id: z.string(), kind: z.string(), quote: z.string(), text: z.string(), answer: z.string(), status: z.string() })),
    }),
  ),
  /** What the author said about the draft, in their words. Empty: revise with the answers to the notes. */
  feedback: z.string().default(''),
  stories: z.array(Story),
  voice_notes: z.array(z.string()).default([]),
  /** Words that were said, kept word for word: never change these. */
  verbatim: z.array(z.string()).default([]),
  /** Arguments the author has already settled ("keep the last line"): do not reopen them. */
  decisions: z.array(z.string()).default([]),
  style_rules: z.array(z.string()).default([]),
  hard_rules: z.array(z.string()).default([]),
});
export type GhostReviseInput = z.infer<typeof GhostReviseInput>;

export const GhostReviseOutput = z.object({
  /** What the ghostwriter understood, as a numbered plan the author can check. */
  plan: z
    .array(
      z.object({
        text: z.string().min(1),
        kind: z.enum(['edit', 'rule', 'question', 'pushback']).default('edit'),
        /** kind rule: a standing preference for the whole book. */
        never: z.array(z.string()).default([]),
        prefer: z.array(z.object({ avoid: z.string(), use: z.string() })).default([]),
        guidance: z.array(z.string()).default([]),
        /** kind question: something to ask in the next session. */
        question: z.string().default(''),
      }),
    )
    .min(1),
  /** Span edits: exact text from one scene's prose, and what replaces it. */
  edits: z.array(z.object({ scene: Id, find: z.string().min(1), replace: z.string(), reason: z.string().default(''), plan: z.array(z.number().int().nonnegative()).default([]) })).max(80).default([]),
  /** Notes the answers resolved. */
  resolved: z.array(z.string()).default([]),
  /** New notes where the revision still needs the author. */
  notes: z.array(NoteDraft.extend({ scene: Id })).default([]),
});
export type GhostReviseOutput = z.infer<typeof GhostReviseOutput>;

// ------------------------------------------------------------------ simulated interviewee (evals)

export const LifeFact = z.object({
  id: Id,
  /** In the person's own words. */
  text: z.string(),
  /** What it is about, for the interviewer's first broad questions ("work", "childhood"). */
  topic: z.string(),
  /** How deep it sits: the gist comes out first; the rest only to a good follow-up. */
  tier: z.enum(['gist', 'instance', 'people', 'senses', 'words', 'feeling', 'meaning']),
  /** Words that show the fact was drawn out (any half of them in what was filed). */
  keywords: z.array(z.string()).min(1),
  when: z.string().default(''),
  /** Said in passing: a good interviewer follows it up. */
  surprising: z.boolean().default(false),
});
export type LifeFact = z.infer<typeof LifeFact>;

export const IntervieweeInput = z.object({
  narrator: z.string(),
  born: z.string().default(''),
  /** The hidden life. The person reveals facts only when asked about them. */
  facts: z.array(LifeFact),
  /** Facts already told. */
  told: z.array(Id).default([]),
  history: z.array(z.object({ role: z.enum(['ghostwriter', 'author']), text: z.string() })).default([]),
  question: z.string(),
});
export type IntervieweeInput = z.infer<typeof IntervieweeInput>;

export const IntervieweeOutput = z.object({ answer: z.string().min(1), told: z.array(Id).default([]) });
export type IntervieweeOutput = z.infer<typeof IntervieweeOutput>;

// ------------------------------------------------------------------ the suite the core calls

export interface CallInfo {
  agent: string;
  scene?: string;
}

/**
 * Everything the core needs from agents. The agents package implements this over a
 * model adapter; tests implement it with recorded or scripted responses.
 */
export interface AgentSuite {
  interview(input: InterviewInput): Promise<InterviewOutput>;
  plotPoints(input: PlotPointsInput): Promise<PlotPointsOutput>;
  structures(input: StructureInput): Promise<StructureOutput>;
  cards(input: CardsInput): Promise<CardsOutput>;
  write(input: WriterInput): Promise<WriterOutput>;
  voice(input: VoiceInput): Promise<VoiceOutput>;
  reviseLines(input: ReviseLinesInput): Promise<ProseOutput>;
  /** Span-level line edit (LAMP categories + style violations). Never rewrites wholesale. */
  humanise(input: HumaniseInput): Promise<LineEditOutput>;
  extract(input: ExtractInput): Promise<ExtractOutput>;
  reviseCard(input: ReviseCardInput): Promise<ReviseCardOutput>;
  reviseProse(input: ReviseProseInput): Promise<ProseOutput>;
  read(input: ReaderInput): Promise<ReaderOutput>;
  continuity(input: ContinuityInput): Promise<ContinuityOutput>;
  judge(input: JudgeInput): Promise<JudgeOutput>;
  critique(input: CritiqueInput): Promise<CritiqueOutput>;
  sampleTurns(input: SampleTurnsInput): Promise<SampleTurnsOutput>;
  diverge(input: DivergeInput): Promise<DivergeOutput>;
  expand(input: ExpandInput): Promise<ExpandOutput>;
  /** One turn of the thinking-partner conversation: a reply, and the edits it makes to the board. */
  talk(input: TalkInput): Promise<TalkOutput>;
  /** Tidy dictated speech into text: fillers and false starts out, nothing added. */
  scribe(input: ScribeInput): Promise<ScribeOutput>;
  /** Life stories: plan an interview session from the gaps in the book. */
  ghostPlan(input: GhostPlanInput): Promise<GhostPlanOutput>;
  /** Life stories: one exchange of an interview: what to file, and the next question. */
  ghostTurn(input: GhostTurnInput): Promise<GhostTurnOutput>;
  /** Life stories: close a session: a summary, and what to ask next time. */
  ghostWrap(input: GhostWrapInput): Promise<GhostWrapOutput>;
  /** Life stories: propose chapters for a shape, from the stories gathered. */
  ghostShape(input: GhostShapeInput): Promise<GhostShapeOutput>;
  /** Life stories: draft a chapter from its stories only, with margin notes where it is thin. */
  ghostDraft(input: GhostDraftInput): Promise<GhostDraftOutput>;
  /** Life stories: a revision round: the author's feedback and answers, as a plan and span edits. */
  ghostRevise(input: GhostReviseInput): Promise<GhostReviseOutput>;
  /** Evals: a simulated person answering the ghostwriter from a hidden life. */
  interviewee(input: IntervieweeInput): Promise<IntervieweeOutput>;
}

export const Contracts = {
  interviewer: { input: InterviewInput, output: InterviewOutput },
  planner: {
    plotPoints: { input: PlotPointsInput, output: PlotPointsOutput },
    structures: { input: StructureInput, output: StructureOutput },
    cards: { input: CardsInput, output: CardsOutput },
  },
  writer: { input: WriterInput, output: WriterOutput },
  voice: { input: VoiceInput, output: VoiceOutput },
  reviser: {
    lines: { input: ReviseLinesInput, output: ProseOutput },
    card: { input: ReviseCardInput, output: ReviseCardOutput },
    prose: { input: ReviseProseInput, output: ProseOutput },
  },
  humaniser: { input: HumaniseInput, output: LineEditOutput },
  judge: { input: JudgeInput, output: JudgeOutput },
  critic: { input: CritiqueInput, output: CritiqueOutput },
  sampler: { input: SampleTurnsInput, output: SampleTurnsOutput },
  muse: { diverge: { input: DivergeInput, output: DivergeOutput }, expand: { input: ExpandInput, output: ExpandOutput }, talk: { input: TalkInput, output: TalkOutput } },
  extractor: { input: ExtractInput, output: ExtractOutput },
  reader: { input: ReaderInput, output: ReaderOutput },
  continuity: { input: ContinuityInput, output: ContinuityOutput },
  scribe: { input: ScribeInput, output: ScribeOutput },
  interviewee: { input: IntervieweeInput, output: IntervieweeOutput },
  ghostwriter: {
    plan: { input: GhostPlanInput, output: GhostPlanOutput },
    turn: { input: GhostTurnInput, output: GhostTurnOutput },
    wrap: { input: GhostWrapInput, output: GhostWrapOutput },
    shape: { input: GhostShapeInput, output: GhostShapeOutput },
    draft: { input: GhostDraftInput, output: GhostDraftOutput },
    revise: { input: GhostReviseInput, output: GhostReviseOutput },
  },
};

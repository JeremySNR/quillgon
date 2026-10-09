import { z } from 'zod';
import {
  Act,
  CharacterBio,
  CharacterVoice,
  Fact,
  Id,
  Intent,
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
  recent_cards: z.array(SceneCard),
  states: z.array(z.object({ character: Id, name: z.string(), snapshot: StateSnapshot.nullable() })),
  voices: z.array(z.object({ character: Id, name: z.string(), voice: CharacterVoice })),
  threads: z.array(Thread),
  facts: z.array(z.object({ id: Id, statement: z.string() })),
  style_samples: z.string(),
  banned_patterns: z.array(z.string()),
  similar_scenes: z.array(z.object({ id: Id, excerpt: z.string() })),
  target_words: z.number(),
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
});
export type HumaniseInput = z.infer<typeof HumaniseInput>;

// ------------------------------------------------------------------ extractor

export const ExtractInput = z.object({
  card: SceneCard,
  prose: z.string(),
  characters: z.array(z.object({ id: Id, name: z.string(), aliases: z.array(z.string()) })),
  facts: z.array(z.object({ id: Id, statement: z.string() })),
  locations: z.array(z.object({ id: Id, name: z.string() })),
  states_before: z.array(z.object({ character: Id, snapshot: StateSnapshot.nullable() })),
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
});
export type ReaderLogEntry = z.infer<typeof ReaderLogEntry>;

export const ReaderInput = z.object({
  scene: Id,
  scene_number: z.number().int(),
  prose: z.string(),
  log: z.array(ReaderLogEntry),
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
  humanise(input: HumaniseInput): Promise<ProseOutput>;
  extract(input: ExtractInput): Promise<ExtractOutput>;
  reviseCard(input: ReviseCardInput): Promise<ReviseCardOutput>;
  reviseProse(input: ReviseProseInput): Promise<ProseOutput>;
  read(input: ReaderInput): Promise<ReaderOutput>;
  continuity(input: ContinuityInput): Promise<ContinuityOutput>;
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
  humaniser: { input: HumaniseInput, output: ProseOutput },
  extractor: { input: ExtractInput, output: ExtractOutput },
  reader: { input: ReaderInput, output: ReaderOutput },
  continuity: { input: ContinuityInput, output: ContinuityOutput },
};

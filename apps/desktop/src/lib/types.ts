import type {
  Book,
  Chapter,
  Notebook,
  ResearchLibrary,
  ResearchRun,
  Evidence,
  CompTitle,
  ResearchGap,
  ResearchSource,
  Question,
  Story,
  Session,
  MarginNote,
  Change,
  CharacterBio,
  CharacterVoice,
  ContinuityIssue,
  Contradiction,
  Fact,
  Impact,
  ImpactResult,
  Intent,
  PlotPoint,
  ProseMeta,
  ReaderReport,
  RippleData,
  RippleItem,
  SceneCard,
  StateSnapshot,
  Structure,
  StructureOutput,
  CardsOutput,
  SyncReport,
  SyncState,
  Thread,
  Timeline,
  Estimate,
  CostSummary,
  ExtractionResult,
  InterviewState,
  VoiceReport,
  Obligation,
  ObligationIssue,
  IdeaBoard,
  IdeaItem,
  StyleSheet,
  StyleViolation,
  StyleReport,
  Fingerprint,
  RuleSuggestion,
  Critique,
  CritiqueOutput,
  ShapeFinding,
  Predictability,
  TwistCheck,
} from '@quillgon/core';

export type {
  Book,
  Change,
  CharacterBio,
  CharacterVoice,
  ContinuityIssue,
  Contradiction,
  Fact,
  Impact,
  ImpactResult,
  Intent,
  PlotPoint,
  ProseMeta,
  ReaderReport,
  RippleData,
  RippleItem,
  SceneCard,
  StateSnapshot,
  Structure,
  StructureOutput,
  CardsOutput,
  SyncReport,
  SyncState,
  Thread,
  Timeline,
  Estimate,
  CostSummary,
  ExtractionResult,
  InterviewState,
  VoiceReport,
  Obligation,
  ObligationIssue,
  IdeaBoard,
  IdeaItem,
  StyleSheet,
  StyleViolation,
  StyleReport,
  Fingerprint,
  RuleSuggestion,
  Critique,
  CritiqueOutput,
  ShapeFinding,
  Predictability,
  TwistCheck,
  Notebook,
  Question,
  Story,
  Session,
  MarginNote,
  Chapter,
};

export interface SceneSummary {
  id: string;
  card: SceneCard;
  act: string;
  chapter: string;
  index: number;
  words: number;
  excerpt: string;
  sync: SyncState;
  contradictions: Contradiction[];
  issues: ContinuityIssue[];
  engagement: number | null;
  style: { enforced: number; guided: number; checked_at: string } | null;
  /** Open margin notes from the ghostwriter (life stories). */
  notes: number;
}

export interface CharacterEntry {
  id: string;
  bio: CharacterBio;
  voice: CharacterVoice;
  state: Record<string, StateSnapshot>;
}

/** Which speech recogniser dictation would use (packages/server/src/dictation.ts). */
export interface DictationStatus {
  ready: boolean;
  provider: 'openai' | 'local' | 'offline' | null;
  model: string;
  local: boolean;
  reason?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  started: string;
  ended: string | null;
  minutes: number;
  speaker: string;
  turns: number;
  summary: string;
}

/** Life stories only (null for a novel). */
export interface LifeSnapshot {
  stories: Story[];
  sessions: SessionSummary[];
  questions: Question[];
  notebook: Notebook;
}

export interface Snapshot {
  dir: string;
  life: LifeSnapshot | null;
  /** Counts for the sidebar; the Research view loads the library itself. */
  research: { comps: number; evidence: number; open_gaps: number };
  mode: 'offline' | 'live';
  dictation: DictationStatus;
  book: Book;
  intent: Intent;
  structure: Structure;
  scenes: SceneSummary[];
  unplaced: string[];
  plotPoints: PlotPoint[];
  threads: Thread[];
  obligations: Obligation[];
  obligationIssues: ObligationIssue[];
  idea: IdeaBoard;
  characters: CharacterEntry[];
  timeline: Timeline;
  locations: { id: string; name: string; description: string; near: string[] }[];
  facts: { id: string; statement: string }[];
  style: { samples: string; banned: string; sheet: StyleSheet };
  critique: { ran_at: string; findings: number } | null;
  issues: { severity: 'error' | 'warning'; file: string; path: string; message: string }[];
  continuity: { mechanical: ContinuityIssue[]; model: ContinuityIssue[]; ran_at: string | null };
  voice: { ran_at: string; warnings: number } | null;
  reader: { id: string; ran_at: string; mean: number; predictions: number; confusions: number; boredom: { from: string; to: string; scenes: string[] }[] } | null;
  ripple: { id: string; description: string; state: string; round: number; cap: number; counts: Record<string, number> } | null;
  proposals: string[];
  branches: { current: string; all: string[] };
  costs: CostSummary;
  estimate: Estimate;
  totals: { words: number; scenes: number; byStatus: Record<string, number>; bySync: Record<string, number> };
}

export interface SceneDetail {
  id: string;
  card: SceneCard;
  prose: { meta: ProseMeta; body: string } | null;
  facts: { facts: Fact[]; contradictions: Contradiction[] } | null;
  sync: SyncReport;
  prev: string | null;
  next: string | null;
  states: { character: string; before: StateSnapshot | null; after: StateSnapshot | null }[];
  /** The ghostwriter's margin notes (life stories). */
  notes: MarginNote[];
}

export interface Job {
  id: string;
  name: string;
  state: 'running' | 'done' | 'error' | 'gone';
  stage: string;
  detail: string;
  result?: unknown;
  error?: string;
}

export interface Commit {
  hash: string;
  date: string;
  message: string;
  body: string;
}

/** GET /api/research (packages/server/src/index.ts). */
export interface ResearchView {
  library: ResearchLibrary;
  runs: Pick<ResearchRun, 'id' | 'brief' | 'depth' | 'started' | 'ended' | 'status' | 'searches' | 'cost_usd' | 'found'>[];
  can: { ok: boolean; reason: string };
  estimate: Record<'quick' | 'deep', { searches: number; calls: number; comps: number; cost_usd: number; subscription: boolean; model: string }>;
}
export type { Evidence, CompTitle, ResearchGap, ResearchSource, ResearchRun };

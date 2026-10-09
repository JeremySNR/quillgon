import type {
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
}

export interface CharacterEntry {
  id: string;
  bio: CharacterBio;
  voice: CharacterVoice;
  state: Record<string, StateSnapshot>;
}

export interface Snapshot {
  dir: string;
  mode: 'offline' | 'live';
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

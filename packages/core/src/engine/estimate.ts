import { DEFAULT_AGENT_TIERS, DEFAULT_MODELS, type AgentName, type ModelTier } from '../schemas/index.js';
import type { Project } from '../project.js';
import { sceneOrder } from '../project.js';
import type { GraphStore } from '../store.js';

const TOKENS_PER_WORD = 1.35;

export interface EstimateLine {
  stage: string;
  agent: AgentName;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface Estimate {
  lines: EstimateLine[];
  total_usd: number;
  scenes_to_write: number;
  words_to_write: number;
}

/**
 * Price a full first draft from the structure, before writing starts. Rough by design:
 * per-scene context size and output length from the target word count, priced per agent tier.
 */
export function estimate(p: Project): Estimate {
  const tierOf = (a: AgentName): ModelTier => p.book.agents[a] ?? DEFAULT_AGENT_TIERS[a];
  const cfg = (a: AgentName) => ({ ...DEFAULT_MODELS[tierOf(a)], ...(p.book.models[tierOf(a)] ?? {}) });
  const line = (stage: string, agent: AgentName, calls: number, inTok: number, outTok: number): EstimateLine => {
    const c = cfg(agent);
    const cost = c.provider === 'codex' ? 0 : (calls * (inTok * (c.price_in ?? 0) + outTok * (c.price_out ?? 0))) / 1e6;
    return { stage, agent, model: c.model || (c.provider === 'codex' ? 'Codex account default' : 'Unspecified model'), calls, input_tokens: calls * inTok, output_tokens: calls * outTok, cost_usd: Math.round(cost * 100) / 100 };
  };
  const order = sceneOrder(p);
  const chapters = p.structure.acts.flatMap((a) => a.chapters);
  const planned = chapters.reduce((n, c) => n + (c.scenes.length || c.planned_scenes || 0), 0) || Math.max(1, Math.round(p.book.target_words / 1500));
  const wordsPerScene = p.book.target_words / planned;
  const sceneOut = Math.round(wordsPerScene * TOKENS_PER_WORD);
  const unwritten = order.filter((s) => !p.scenes.get(s)!.prose).length + chapters.filter((c) => !c.scenes.length).reduce((n, c) => n + (c.planned_scenes || 2), 0);
  const lines: EstimateLine[] = [];
  const chaptersWithoutCards = chapters.filter((c) => !c.scenes.length).length;
  if (!chapters.length) {
    lines.push(line('plot points', 'planner', 1, 4000, 3000));
    lines.push(line('structure (3 alternatives)', 'planner', 1, 8000, 16000));
  }
  if (chaptersWithoutCards || !chapters.length) {
    const n = chaptersWithoutCards || Math.max(1, Math.round(planned / 3));
    lines.push(line('scene cards (2 alternatives per chapter)', 'planner', n, 12000, 6000));
  }
  if (unwritten) {
    const ctx = 6000 + sceneOut * 2 + 3000; // card, states, voices + previous scene + similar excerpts
    lines.push(line('prose', 'writer', unwritten, ctx, sceneOut));
    lines.push(line('voice check', 'voice', unwritten, 2500, 600));
    lines.push(line('humaniser', 'humaniser', unwritten, sceneOut + 2000, sceneOut));
    lines.push(line('extraction', 'extractor', unwritten, sceneOut + 3500, 1500));
  }
  lines.push(line('reader run', 'reader', unwritten || order.length, sceneOut + 2500, 500));
  const total = lines.reduce((n, l) => n + l.cost_usd, 0);
  return { lines, total_usd: Math.round(total * 100) / 100, scenes_to_write: unwritten, words_to_write: Math.round(unwritten * wordsPerScene) };
}

export interface CostSummary {
  total_usd: number;
  calls: number;
  by_agent: Record<string, { calls: number; cost_usd: number; input_tokens: number; output_tokens: number }>;
}

export function costSummary(store: GraphStore): CostSummary {
  const text = store.readReport('costs.jsonl') ?? '';
  const out: CostSummary = { total_usd: 0, calls: 0, by_agent: {} };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { agent: string; cost_usd: number; input_tokens: number; output_tokens: number };
    out.total_usd += r.cost_usd;
    out.calls++;
    const a = (out.by_agent[r.agent] ??= { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 });
    a.calls++;
    a.cost_usd += r.cost_usd;
    a.input_tokens += r.input_tokens;
    a.output_tokens += r.output_tokens;
  }
  out.total_usd = Math.round(out.total_usd * 10000) / 10000;
  return out;
}

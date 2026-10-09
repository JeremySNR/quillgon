import type { AgentSuite, JudgeInput } from '../agents/contracts.js';

export type Verdict = 'a' | 'b' | 'tie';

/**
 * Pairwise judging, run in both orders. A text wins only if it wins both ways; a split
 * verdict is a tie. This removes position bias, the largest known failure of LLM judges.
 */
export async function judgeBothWays(agents: AgentSuite, input: JudgeInput): Promise<{ winner: Verdict; reasons: string[] }> {
  const [first, second] = await Promise.all([agents.judge(input), agents.judge({ ...input, a: input.b, b: input.a })]);
  const flipped: Verdict = second.winner === 'a' ? 'b' : second.winner === 'b' ? 'a' : 'tie';
  const winner: Verdict = first.winner === flipped ? first.winner : 'tie';
  return { winner, reasons: [first.reason, second.reason] };
}

/**
 * Tournament over candidates: every pair judged both ways, scored win = 1, tie = 0.5.
 * Returns indices best-first. n(n-1) judge calls, so keep n small (≤ 4).
 */
export async function tournament(agents: AgentSuite, base: Omit<JudgeInput, 'a' | 'b'>, candidates: string[]): Promise<{ order: number[]; scores: number[] }> {
  const scores = candidates.map(() => 0);
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const r = await judgeBothWays(agents, { ...base, a: candidates[i], b: candidates[j] });
      if (r.winner === 'a') scores[i] += 1;
      else if (r.winner === 'b') scores[j] += 1;
      else (scores[i] += 0.5), (scores[j] += 0.5);
    }
  const order = candidates.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  return { order, scores };
}

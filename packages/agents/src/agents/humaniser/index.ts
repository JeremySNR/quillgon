import { HumaniseInput, ProseOutput } from '@novel/core';
import { defineAgent, json } from '../define.js';

export const humaniser = defineAgent({
  name: 'humaniser',
  task: 'humanise',
  input: HumaniseInput,
  output: ProseOutput,
  maxTokens: 32000,
  render: (i) =>
    [
      i.skill ? `## The author's humaniser instructions (these win)\n${i.skill}` : '',
      i.banned_hits.length ? json('Banned-pattern hits to remove', i.banned_hits) : '',
      `## Prose\n${i.prose}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
});

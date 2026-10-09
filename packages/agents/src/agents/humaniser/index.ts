import { HumaniseInput, LineEditOutput } from '@quillgon/core';
import { defineAgent, json } from '../define.js';

export const humaniser = defineAgent({
  name: 'humaniser',
  task: 'line-edit',
  input: HumaniseInput,
  output: LineEditOutput,
  maxTokens: 16000,
  render: (i) =>
    [
      i.skill ? `## The author's humaniser instructions (these win)\n${i.skill}` : '',
      i.style_rules.length ? `## Style sheet\n${i.style_rules.map((r) => `- ${r}`).join('\n')}` : '',
      i.violations.length ? json('Style violations found by code (fix these first)', i.violations) : '',
      i.banned_hits.length ? json('Banned-pattern hits', i.banned_hits) : '',
      i.style_samples ? `## Reference: the author's own writing\n${i.style_samples}` : '',
      `## Prose\n${i.prose}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
});

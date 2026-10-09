import { JudgeInput, JudgeOutput } from '@quillgon/core';
import { defineAgent } from '../define.js';

export const judge = defineAgent({
  name: 'judge',
  task: 'pairwise',
  input: JudgeInput,
  output: JudgeOutput,
  maxTokens: 4000,
  render: (i) =>
    [
      `# ${i.task}`,
      `## Criteria\n${i.criteria.map((c) => `- ${c}`).join('\n')}`,
      i.reference ? `## Reference passages (the author's own writing)\n${i.reference}` : '',
      `## A\n${i.a}`,
      `## B\n${i.b}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
});

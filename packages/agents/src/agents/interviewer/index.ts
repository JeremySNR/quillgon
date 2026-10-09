import { InterviewInput, InterviewOutput } from '@quillgon/core';
import { defineAgent } from '../define.js';

export const interviewer = defineAgent({
  name: 'interviewer',
  task: 'interview',
  input: InterviewInput,
  output: InterviewOutput,
  render: (i) =>
    [
      `## Premise\n${i.premise}`,
      i.answers.length ? `## Answers so far\n${i.answers.map((a) => `**${a.question}**\n${a.answer}`).join('\n\n')}` : '## Answers so far\n(none yet)',
      i.answers.length ? 'You have one round of answers. Write the intent now (done: true).' : 'Ask your questions, or write the intent if the premise already answers them.',
    ].join('\n\n'),
});

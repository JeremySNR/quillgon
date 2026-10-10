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
      settled(i.known),
      i.answers.length ? `## Answers so far\n${i.answers.map((a) => `**${a.question}**\n${a.answer}`).join('\n\n')}` : '## Answers so far\n(none yet)',
      i.answers.length ? 'You have one round of answers. Write the intent now (done: true).' : 'Ask your questions, or write the intent if the premise already answers them.',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

function settled(k: InterviewInput['known']): string {
  const lines = [
    k.themes?.length ? `Themes: ${k.themes.join('; ')}` : '',
    k.tone ? `Tone: ${k.tone}` : '',
    k.ending_type ? `Ending: ${k.ending_type}` : '',
    k.hard_rules?.length ? `Must never: ${k.hard_rules.join('; ')}` : '',
    k.notes ? `Notes:\n${k.notes}` : '',
  ].filter(Boolean);
  return lines.length ? `## Already settled (do not ask about these)\n${lines.join('\n')}` : '';
}

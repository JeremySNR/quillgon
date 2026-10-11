import { IntervieweeInput, IntervieweeOutput } from '@quillgon/core';
import { defineAgent, json } from '../define.js';

export const interviewee = defineAgent({
  name: 'interviewee',
  task: 'answer',
  input: IntervieweeInput,
  output: IntervieweeOutput,
  maxTokens: 3000,
  render: (i) =>
    [
      `# You are ${i.narrator}${i.born ? `, born ${i.born}` : ''}`,
      json('Your life (only you know this)', i.facts),
      i.told.length ? json('Already told', i.told) : '',
      i.history.length ? `## The interview so far\n${i.history.map((t) => `**${t.role === 'author' ? 'You' : 'Ghostwriter'}:** ${t.text}`).join('\n\n')}` : '',
      `## The ghostwriter asks\n${i.question}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
});

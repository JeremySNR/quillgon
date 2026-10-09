import { ContinuityInput, ContinuityOutput } from '@novel/core';
import { defineAgent, json } from '../define.js';

export const continuity = defineAgent({
  name: 'continuity',
  task: 'continuity',
  input: ContinuityInput,
  output: ContinuityOutput,
  render: (i) =>
    [
      `## Scene ${i.a.id}: ${i.a.card.title}\n${i.a.prose}`,
      json('Character states at the end of the first scene', i.states),
      `## Scene ${i.b.id}: ${i.b.card.title}\n${i.b.prose}`,
    ].join('\n\n'),
});

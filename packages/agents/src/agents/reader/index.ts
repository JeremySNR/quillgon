import { ReaderInput, ReaderOutput } from '@novel/core';
import { defineAgent } from '../define.js';

export const reader = defineAgent({
  name: 'reader',
  task: 'read',
  input: ReaderInput,
  output: ReaderOutput,
  render: (i) =>
    [
      i.log.length
        ? `## Your reading log so far\n${i.log
            .map(
              (e, n) =>
                `Scene ${n + 1}: believed: ${e.believes} Expected: ${e.expects} Engagement ${e.engagement}/5.${e.confusions.length ? ` Confused by: ${e.confusions.map((c) => `[${c.id}] ${c.text}`).join(' ')}` : ''}${e.predictions.length ? ` Predicted: ${e.predictions.join(' | ')}` : ''}`,
            )
            .join('\n')}`
        : '## Your reading log so far\n(This is the first scene.)',
      `## Scene ${i.scene_number}\n${i.prose}`,
    ].join('\n\n'),
});

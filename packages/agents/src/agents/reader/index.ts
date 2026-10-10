import { ReaderInput, ReaderOutput } from '@quillgon/core';
import { defineAgent } from '../define.js';

export const reader = defineAgent({
  name: 'reader',
  task: 'read',
  input: ReaderInput,
  output: ReaderOutput,
  render: (i) => {
    // With a long book only the latest entries are shown; number them by their real scene.
    const first = i.scene_number - i.log.length;
    const e = i.earlier;
    return [
      e
        ? `## What you remember from the first ${e.scenes_read} scenes\n${[
            e.predictions.length ? `Predictions you made: ${e.predictions.join(' | ')}` : 'No predictions yet.',
            e.open_confusions.length ? `Still unclear: ${e.open_confusions.map((c) => `[${c.id}] ${c.text}`).join(' ')}` : '',
          ]
            .filter(Boolean)
            .join('\n')}`
        : '',
      i.log.length
        ? `## Your reading log${e ? ', latest scenes' : ' so far'}\n${i.log
            .map(
              (e, n) =>
                `Scene ${first + n}: believed: ${e.believes} Expected: ${e.expects} Engagement ${e.engagement}/5.${e.confusions.length ? ` Confused by: ${e.confusions.map((c) => `[${c.id}] ${c.text}`).join(' ')}` : ''}${e.predictions.length ? ` Predicted: ${e.predictions.join(' | ')}` : ''}`,
            )
            .join('\n')}`
        : '## Your reading log so far\n(This is the first scene.)',
      `## Scene ${i.scene_number}${i.mode === 'outline' ? ' (summary)' : ''}\n${i.prose}`,
      i.fairness_question ? `## One question\n${i.fairness_question}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  },
});

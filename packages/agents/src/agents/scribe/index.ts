import { ScribeInput, ScribeOutput } from '@quillgon/core';
import { defineAgent, json } from '../define.js';

export const scribe = defineAgent({
  name: 'scribe',
  task: 'clean',
  input: ScribeInput,
  output: ScribeOutput,
  maxTokens: 4000,
  render: (i) =>
    [
      `# Clean up dictation (${i.level})`,
      i.before ? `## Text before the cursor\n${i.before.slice(-600)}` : '## Text before the cursor\n(the start of the text)',
      i.after ? `## Text after the cursor\n${i.after.slice(0, 200)}` : '',
      i.dictionary.length ? json('Dictionary (spell these exactly)', i.dictionary.slice(0, 150)) : '',
      `House style: spelling ${i.style.spelling}, quotes ${i.style.quotes}.`,
      `## What the author said\n${i.raw}`,
      'Return `text`: the dictation as it should be inserted at the cursor, starting with a space if one is needed to join the text before it.',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

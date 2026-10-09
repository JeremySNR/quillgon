import { DivergeInput, DivergeOutput, ExpandInput, ExpandOutput } from '@novel/core';
import { defineAgent, json } from '../define.js';

export const museDiverge = defineAgent({
  name: 'muse',
  task: 'diverge',
  input: DivergeInput,
  output: DivergeOutput,
  render: (i) =>
    [
      `# Diverge — think as ${i.persona}`,
      `## Seed\n${i.seed}`,
      i.genre ? `Genre: ${i.genre}` : '',
      `Kinds wanted: ${i.kinds.join(', ')}. Give ${i.k} candidates.`,
      i.kept.length ? json('Kept so far (build on these)', i.kept) : '',
      i.discarded.length ? json('Discarded (never repeat or rephrase)', i.discarded) : '',
      i.avoid.length ? json('Clichés to avoid', i.avoid) : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

export const museExpand = defineAgent({
  name: 'muse',
  task: 'expand',
  input: ExpandInput,
  output: ExpandOutput,
  maxTokens: 16000,
  render: (i) =>
    [
      `# Expand — step: ${i.step}`,
      `## Seed\n${i.seed}`,
      i.kept.length ? json('Kept ideas', i.kept) : '',
      i.logline ? `## Chosen logline\n${i.logline}` : '',
      i.paragraph ? `## Chosen paragraph\n${i.paragraph}` : '',
      i.synopsis ? `## Synopsis\n${i.synopsis}` : '',
      i.avoid.length ? json('Avoid', i.avoid) : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

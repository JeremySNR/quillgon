import { ExtractInput, ExtractOutput } from '@novel/core';
import { defineAgent, json } from '../define.js';

export const extractor = defineAgent({
  name: 'extractor',
  task: 'extract',
  input: ExtractInput,
  output: ExtractOutput,
  render: (i) =>
    [
      `# Extract scene ${i.card.id}`,
      json('Characters', i.characters),
      json('Fact glossary', i.facts),
      json('Locations', i.locations),
      json('State of each character as the scene opens', i.states_before),
      json('Scene card (report any disagreement with the prose)', i.card),
      `## Prose\n${i.prose}`,
    ].join('\n\n'),
});

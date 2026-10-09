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
      i.obligations.length ? json('Obligations (setups and payoffs) in play', i.obligations.map((o) => ({ id: o.id, kind: o.kind, description: o.description }))) : '',
      `## Prose\n${i.prose}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
});

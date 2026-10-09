import { ProseOutput, ReviseCardInput, ReviseCardOutput, ReviseLinesInput, ReviseProseInput } from '@quillgon/core';
import { defineAgent, json } from '../define.js';

export const reviseLines = defineAgent({
  name: 'reviser',
  task: 'revise-lines',
  input: ReviseLinesInput,
  output: ProseOutput,
  render: (i) => [`# Job: revise flagged lines only`, json('Flags', i.flags), `## Prose\n${i.prose}`].join('\n\n'),
});

export const reviseCard = defineAgent({
  name: 'reviser',
  task: 'revise-card',
  input: ReviseCardInput,
  output: ReviseCardOutput,
  render: (i) =>
    [
      '# Job: revise a scene card after an upstream change',
      `## The change\n${i.change}`,
      `## Why this scene was flagged\n${i.reasons.map((r) => `- ${r}`).join('\n')}`,
      json('Current card', i.card),
      json('What each character present knows as the scene opens', i.states_before),
      json('Fact glossary', i.facts),
      json('Characters', i.characters),
    ].join('\n\n'),
});

export const reviseProse = defineAgent({
  name: 'reviser',
  task: 'revise-prose',
  input: ReviseProseInput,
  output: ProseOutput,
  maxTokens: 32000,
  render: (i) =>
    [
      '# Job: revise prose to a new card, minimum change',
      `## The upstream change\n${i.change}`,
      json('Old card', i.old_card),
      json('New card', i.new_card),
      `## Voices\n${i.voices.map((v) => `- ${v.name}: ${v.voice.speech_patterns.join('; ')}`).join('\n')}`,
      `## Old prose\n${i.old_prose}`,
    ].join('\n\n'),
});

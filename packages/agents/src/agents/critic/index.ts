import { CritiqueInput, CritiqueOutput, SampleTurnsInput, SampleTurnsOutput } from '@quillgon/core';
import { defineAgent, json } from '../define.js';

export const critic = defineAgent({
  name: 'critic',
  task: 'critique',
  input: CritiqueInput,
  output: CritiqueOutput,
  render: (i) => [`# Critique the ${i.level} plan`, i.characters.length ? json('Characters', i.characters) : '', `## Plan\n${i.plan}`].filter(Boolean).join('\n\n'),
});

export const sampler = defineAgent({
  name: 'critic',
  task: 'sample-turns',
  input: SampleTurnsInput,
  output: SampleTurnsOutput,
  render: (i) => [`# Sample ${i.k} turns`, `## The story so far\n${i.context || '(this is the opening)'}`, `## The scene\n${i.setup}`].join('\n\n'),
});

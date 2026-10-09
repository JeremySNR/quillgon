import { VoiceInput, VoiceOutput } from '@novel/core';
import { defineAgent, json } from '../define.js';

export const voice = defineAgent({
  name: 'voice',
  task: 'voice',
  input: VoiceInput,
  output: VoiceOutput,
  render: (i) => [`# Scene ${i.scene}`, json('Voice sheets', i.voices), json('Lines by speaker', i.lines)].join('\n\n'),
});

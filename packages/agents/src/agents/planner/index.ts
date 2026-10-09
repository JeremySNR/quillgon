import { CardsInput, CardsOutput, PlotPointsInput, PlotPointsOutput, StructureInput, StructureOutput } from '@novel/core';
import { defineAgent, json } from '../define.js';

export const plannerPlotPoints = defineAgent({
  name: 'planner',
  task: 'plot-points',
  input: PlotPointsInput,
  output: PlotPointsOutput,
  render: (i) =>
    [
      '# Task: plot points',
      `Target length: about ${i.target_words.toLocaleString('en')} words.`,
      json('Pinned plot points (fixed; keep ids, build around them)', i.pinned),
      json('Cast so far', i.cast),
      'Propose the turning points that connect these into a whole story.',
    ].join('\n\n'),
});

export const plannerStructures = defineAgent({
  name: 'planner',
  task: 'structures',
  input: StructureInput,
  output: StructureOutput,
  maxTokens: 64000,
  render: (i) =>
    [
      '# Task: act and chapter structure — three alternatives (obvious, unexpected, wildcard)',
      `Target length: about ${i.target_words.toLocaleString('en')} words.`,
      json('Plot points', i.plot_points),
      json('Cast', i.cast),
      i.avoid.length ? `## Already offered (do not repeat these shapes)\n${i.avoid.map((a) => `- ${a}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

export const plannerCards = defineAgent({
  name: 'planner',
  task: 'cards',
  input: CardsInput,
  output: CardsOutput,
  maxTokens: 48000,
  render: (i) =>
    [
      `# Task: scene cards for chapter ${i.chapter.id} — two alternatives (obvious, unexpected)`,
      `## Chapter\n**${i.chapter.title}** (${i.chapter.scene_count} scenes, about ${i.words_per_scene} words each)\n\n${i.chapter.summary}`,
      `First scene id: s${String(i.first_scene_number).padStart(3, '0')}`,
      json('Plot points', i.plot_points),
      json('Threads', i.threads),
      json('Characters (with what they know at the start of this chapter)', i.characters),
      json('Known locations', i.locations),
      json('Known facts', i.facts),
      json('The last scene cards before this chapter', i.previous_cards),
    ].join('\n\n'),
});

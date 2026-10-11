import { GhostDraftInput, GhostDraftOutput, GhostReviseInput, GhostReviseOutput, GhostPlanInput, GhostPlanOutput, GhostShapeInput, GhostShapeOutput, GhostTurnInput, GhostTurnOutput, GhostWrapInput, GhostWrapOutput, LADDER } from '@quillgon/core';
import { defineAgent, json } from '../define.js';

const said = (h: { role: string; text: string }[]) => h.map((t) => `**${t.role === 'author' ? 'Author' : 'You'}:** ${t.text}`).join('\n\n');

export const ghostPlan = defineAgent({
  name: 'ghostwriter',
  task: 'plan',
  input: GhostPlanInput,
  output: GhostPlanOutput,
  maxTokens: 6000,
  render: (i) =>
    [
      `# Plan a session (about ${i.minutes} minutes)`,
      `Narrator: ${i.narrator}${i.born ? `, born ${i.born}` : ''}.${i.speaker ? ` This session you are talking to ${i.speaker}, about the narrator's life.` : ''}`,
      i.about ? `What the book is about: ${i.about}` : 'What the book is about: not settled yet.',
      `How hard to push: ${i.push}.`,
      i.chapters.length ? json('Chapters (stage, stories)', i.chapters) : '## Chapters\n(none yet: the shape of the life is not known)',
      i.stories.length ? json('Stories so far (depth 0..1, next rung to climb)', i.stories) : '## Stories so far\n(none yet)',
      i.people.length ? json('People', i.people) : '',
      i.gaps.length ? json('Stretches of the life with nothing in them yet', i.gaps) : '',
      i.questions.length ? json('Question queue (priority 1 = most important)', i.questions) : '',
      i.promises.length ? json('You promised to come back to', i.promises) : '',
      i.recent.length ? json('Recent sessions', i.recent) : '## Recent sessions\n(this is the first session)',
      i.off_limits.length ? json('Off limits: never plan or ask about these', i.off_limits) : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

export const ghostTurn = defineAgent({
  name: 'ghostwriter',
  task: 'turn',
  input: GhostTurnInput,
  output: GhostTurnOutput,
  maxTokens: 8000,
  render: (i) =>
    [
      '# One exchange',
      `Narrator: ${i.narrator}${i.born ? `, born ${i.born}` : ''}.${i.speaker ? ` You are talking to ${i.speaker}, about the narrator's life; file what they say as their version.` : ''} Push: ${i.push}.`,
      json('Agenda', i.agenda.map((a, n) => ({ n, topic: a.topic, question: a.question, done: a.done }))),
      i.story ? json('The story you are drawing out', i.story) : '## The story you are drawing out\n(none yet)',
      i.next_rung ? `Next rung to climb: ${i.next_rung} (rungs in order: ${LADDER.join(', ')}).` : '',
      i.stories.length ? json('Other stories (reuse an id when it is the same episode)', i.stories) : '',
      i.people.length ? json('People (reuse ids)', i.people) : '',
      i.history.length ? `## The session so far\n${said(i.history)}` : '',
      i.signal ? `## The author pressed: ${{ 'dont-remember': "That's all I remember", 'move-on': 'Move on', 'off-record': 'Off the record (file nothing)', hard: 'This is hard to talk about' }[i.signal]}` : '',
      `## The author says\n${i.answer || '(nothing)'}`,
      i.probes.length ? json('Worth following up (found in what they said)', i.probes) : '',
      i.off_limits.length ? json('Off limits: never ask about these', i.off_limits) : '',
      i.retry ? `## Your last question was refused\n${i.retry}\nAsk a different, open question.` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

export const ghostWrap = defineAgent({
  name: 'ghostwriter',
  task: 'wrap',
  input: GhostWrapInput,
  output: GhostWrapOutput,
  maxTokens: 6000,
  render: (i) =>
    [
      '# Close the session',
      `Narrator: ${i.narrator}.`,
      json('Agenda', i.agenda),
      i.stories.length ? json('Stories (depth 0..1)', i.stories) : '',
      `## The session\n${said(i.history)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
});

export const ghostShape = defineAgent({
  name: 'ghostwriter',
  task: 'shape',
  input: GhostShapeInput,
  output: GhostShapeOutput,
  maxTokens: 10000,
  render: (i) =>
    [
      '# Shape the book',
      `Narrator: ${i.narrator}${i.born ? `, born ${i.born}` : ''}. About ${i.target_words.toLocaleString('en')} words.`,
      i.about ? `What the book is about: ${i.about}` : 'What the book is about: not settled; shape it around the life itself.',
      `Shape: ${i.shape ?? 'chronological (the author has not chosen)'}`,
      json('Stories (depth 0..1: how far each has been drawn out)', i.stories),
      i.chapters.length ? json('Chapters the author already has (keep these ids)', i.chapters) : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

export const ghostDraft = defineAgent({
  name: 'ghostwriter',
  task: 'draft',
  input: GhostDraftInput,
  output: GhostDraftOutput,
  maxTokens: 32000,
  render: (i) =>
    [
      `# Draft chapter ${i.chapter.number}: ${i.chapter.title}`,
      `Narrator: ${i.narrator}${i.born ? `, born ${i.born}` : ''}. About ${i.words.toLocaleString('en')} words.`,
      i.chapter.summary ? `What this chapter does: ${i.chapter.summary}` : '',
      json('The stories (the only material you may use)', i.stories),
      json('People', i.people),
      i.voice_notes.length ? json('How the author talks', i.voice_notes) : '',
      i.voice_samples ? `## The author's own words, as spoken in interviews\n${i.voice_samples}` : '',
      i.voice_chapter ? `## The chapter that set the voice (match it)\n${i.voice_chapter}` : '',
      i.previous_ending ? `## How the previous chapter ended\n${i.previous_ending}` : '',
      i.style_rules.length ? json('House style', i.style_rules) : '',
      i.hard_rules.length ? json('Never', i.hard_rules) : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

export const ghostRevise = defineAgent({
  name: 'ghostwriter',
  task: 'revise',
  input: GhostReviseInput,
  output: GhostReviseOutput,
  maxTokens: 24000,
  render: (i) =>
    [
      `# Revise chapter: ${i.chapter.title} (round ${i.chapter.round + 1})`,
      `Narrator: ${i.narrator}.`,
      i.feedback ? `## What the author said about the draft\n${i.feedback}` : '## What the author said about the draft\n(nothing beyond the answers to your notes)',
      ...i.scenes.map((sc) => [`## Scene ${sc.id}: ${sc.title}`, sc.prose, sc.notes.length ? json(`Notes on ${sc.id}`, sc.notes) : ''].filter(Boolean).join('\n\n')),
      json('The stories', i.stories),
      i.verbatim.length ? json('Keep these word for word', i.verbatim) : '',
      i.voice_notes.length ? json('How the author talks', i.voice_notes) : '',
      i.decisions.length ? json('Already settled (do not reopen)', i.decisions) : '',
      i.style_rules.length ? json('House style', i.style_rules) : '',
      i.hard_rules.length ? json('Never', i.hard_rules) : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

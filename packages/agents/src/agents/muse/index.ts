import { DivergeInput, DivergeOutput, ExpandInput, ExpandOutput, TalkInput, TalkOutput } from '@quillgon/core';
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

const FOCUS: Record<string, string> = {
  seed: 'the seed',
  genre: 'the genre',
  logline: 'the one-sentence version',
  paragraph: 'the one-paragraph version',
  synopsis: 'the one-page synopsis',
  tone: 'the tone',
  ending: 'the ending',
  themes: 'the themes',
  never: 'what the book must never do',
  open: 'the open questions',
};

export const museTalk = defineAgent({
  name: 'muse',
  task: 'talk',
  input: TalkInput,
  output: TalkOutput,
  maxTokens: 12000,
  render: (i) => {
    const b = i.board;
    const line = (label: string, v: string) => `${label}: ${v || '(not yet)'}`;
    const list = (label: string, v: string[]) => `${label}: ${v.length ? v.map((x) => `\n- ${x}`).join('') : '(none yet)'}`;
    const ideas = b.pile
      .filter((x) => x.status !== 'discarded')
      .map((x) => `- ${x.id} [${x.mine ? 'yours' : x.status === 'kept' ? 'kept' : 'to sort'}] (${x.kind}) ${x.text}`);
    const binned = b.pile.filter((x) => x.status === 'discarded').map((x) => `- ${x.text}`);
    let focus = '';
    if (i.focus) {
      const [kind, id] = i.focus.split(/:(.*)/s);
      if (kind === 'cast') focus = `the character ${b.cast.find((c) => c.id === id)?.name ?? id} (id ${id})`;
      else if (kind === 'idea') focus = `the idea ${id}: “${b.pile.find((x) => x.id === id)?.text ?? ''}”`;
      else focus = FOCUS[i.focus] ?? i.focus;
    }
    return [
      '# Talk it through',
      '## The board',
      [line('Seed', b.seed), line('Genre', b.genre), line('One sentence', b.logline), line('One paragraph', b.paragraph), line('One page', b.synopsis), line('Tone', b.tone), line('Ending', b.ending), list('Themes', b.themes), list('Never', b.never), list('Still open', b.open)].join('\n'),
      ideas.length ? `## Ideas on the board (id [status] (kind) text)\n${ideas.join('\n')}` : '## Ideas on the board\n(none yet)',
      binned.length ? `## Binned (never suggest again, or anything like them)\n${binned.join('\n')}` : '',
      b.cast.length ? json('Cast', b.cast) : '## Cast\n(nobody yet)',
      b.cliches.length ? json('Clichés to steer away from', b.cliches) : '',
      i.history.length
        ? `## Conversation so far\n${i.history.map((t) => `**${t.role === 'author' ? 'Author' : 'You'}:** ${t.text}${t.undone ? '\n(The author undid the board changes from this reply.)' : ''}`).join('\n\n')}`
        : '## Conversation so far\n(this is the first message)',
      `## The author says${focus ? ` (about ${focus})` : ''}\n${i.message}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  },
});

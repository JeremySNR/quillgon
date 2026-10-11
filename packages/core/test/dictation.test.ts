import { describe, expect, it } from 'vitest';
import { checkCleanup, cleanDictation, dictionaryFor, joinToCursor, loadProject, recognitionPrompt, wavSeconds } from '../src/index.js';
import { FIXTURE, silentWav } from './helpers.js';

describe('dictation clean-up', () => {
  it('drops fillers, stutters and self-corrections, and never adds words', () => {
    expect(cleanDictation('um so I I went to the uh cannery on Tuesday, no wait, Wednesday')).toBe('So I went to the cannery on Wednesday');
    expect(cleanDictation('it was raining. scratch that it was dry')).toBe('It was dry');
    expect(cleanDictation('er the felling table')).toBe('The felling table');
  });

  it('keeps everything at the verbatim level except spacing', () => {
    expect(cleanDictation('um  so   I went', { level: 'verbatim' })).toBe('Um so I went');
  });

  it('joins the text before the cursor', () => {
    expect(joinToCursor('The bus came.', 'She waited and')).toBe(' the bus came.');
    expect(joinToCursor('the bus came.', 'She waited.')).toBe(' The bus came.');
    expect(joinToCursor('Mara waited.', 'and then', ['Mara Penrose'])).toBe(' Mara waited.');
    expect(joinToCursor('I waited.', 'and then')).toBe(' I waited.');
    expect(joinToCursor('hello', '')).toBe('Hello');
  });

  it('refuses a tidy-up that adds a name or rewrites what was said', () => {
    expect(checkCleanup('um we went to see Jean at the mill', 'We went to see Jean at the mill.').ok).toBe(true);
    const named = checkCleanup('we went to see her at the mill', 'We went to see Margaret at the mill.');
    expect(named.ok).toBe(false);
    expect(named.flags[0]).toContain('Margaret');
    expect(checkCleanup('we went to see shivon', 'We went to see Siobhan.', { names: ['Siobhan Kelly'] }).ok).toBe(true);
    const rewritten = checkCleanup('the cannery was loud and the women sang while they worked the fish', 'A cacophony of industrious maritime labour echoed beneath vaulted brickwork.');
    expect(rewritten.ok).toBe(false);
  });

  it('builds the dictionary from the book, with the scene in focus first', () => {
    const { project } = loadProject(FIXTURE);
    const words = dictionaryFor(project, { scene: 's04' });
    expect(words).toContain('Mara Penrose');
    expect(words.indexOf('Eliza Trevaskis')).toBeLessThan(words.indexOf('Tom Kessell'));
    expect(recognitionPrompt(words)).toMatch(/^Names: /);
    expect(recognitionPrompt(words, 30).length).toBeLessThan(45);
  });

  it('reads a WAV duration and rejects other data', () => {
    expect(wavSeconds(silentWav(1.5))).toBeCloseTo(1.5, 2);
    expect(wavSeconds(new TextEncoder().encode('not audio at all, just some text here to pass length'))).toBeNull();
  });
});

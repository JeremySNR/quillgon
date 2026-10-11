import { describe, expect, it } from 'vitest';
import { allowedFromSamples, findTells, tellProfile, tellScore, triadRate } from '../src/tells.js';

const rules = (text: string, opts = {}) => findTells(text, opts).map((t) => t.rule);

describe('AI writing habits, found by code', () => {
  it('staged contrasts, in their common shapes', () => {
    expect(rules('It wasn’t the noise. It was the silence that got to her.')).toContain('not-x-but-y');
    expect(rules("It's not a job. It's a calling.")).toContain('not-x-but-y');
    expect(rules('This is not just a kitchen, but a place of memory.')).toContain('not-x-but-y');
    expect(rules('What she felt wasn’t anger, but grief.')).toContain('not-x-but-y');
    expect(rules('No shouting. No tears. Just the door closing.')).toContain('no-x-no-y');
  });

  it('ordinary English is left alone', () => {
    expect(rules('He wasn’t hungry. She was tired, so they went home.')).toEqual([]);
    expect(rules('It wasn’t easy, but we managed it in the end.')).toEqual([]);
    expect(rules('I did not go to work that day. I went to the sea instead.')).toEqual([]);
    expect(rules('She said she was tired. He said he would drive.')).toEqual([]);
  });

  it('inflation, leftovers and dialogue tells', () => {
    expect(rules('The bakery closed in 1971, highlighting the decline of the high street.')).toContain('ing-rider');
    expect(rules('The mill serves as a reminder of harder times.')).toEqual(expect.arrayContaining(['serves-as']));
    expect(rules('Her garden was a testament to her patience.')).toContain('testament');
    expect(rules('It is important to note that rates vary.')).toContain('important-to-note');
    expect(rules('We talked for hours.\n\nUltimately, it was the people who mattered.')).toContain('coda');
    expect(rules('“Go,” she said softly.')).toContain('adverb-tag');
    expect(rules('Her voice barely above a whisper, she asked again.')).toContain('voice-laced');
  });

  it('stock phrases are strong; single over-used words are not', () => {
    const t = findTells('A shiver ran down her spine. She took a deep breath.');
    expect(t.filter((x) => x.family === 'cliche' && x.strength === 'strong').length).toBe(2);
    expect(findTells('The tapestry hung in the hall.').filter((x) => x.family === 'vocabulary')).toEqual([]);
    const cluster = findTells('Her vibrant, intricate garden was a realm of its own, and its enduring beauty was palpable.');
    expect(cluster.filter((x) => x.family === 'vocabulary').length).toBeGreaterThanOrEqual(3);
    expect(cluster.every((x) => x.family !== 'vocabulary' || x.strength === 'weak')).toBe(true);
  });

  it('stock names in fiction only', () => {
    expect(rules('Elara looked up.')).toContain('stock-name');
    expect(rules('Elara looked up.', { kind: 'true' })).not.toContain('stock-name');
  });

  it('the author’s own habits are their voice, not tells', () => {
    const samples = 'It wasn’t the money. It was the principle. My mother said that every Sunday, and she whispered it, palpable and intricate as lace, vibrant as a realm.';
    const allowed = allowedFromSamples(samples);
    expect(allowed.has('not-x-but-y')).toBe(true);
    expect(rules('It wasn’t the rain. It was the cold.', { samples })).toEqual([]);
    expect(rules('“Stay,” she said softly.', { allow: ['adverb-tag'] })).toEqual([]);
  });

  it('three of the same opener in a row', () => {
    expect(rules('Then we left. Then it rained. Then the car broke down.')).toContain('same-opener');
    expect(rules('I went in. I sat down. I ordered tea.')).not.toContain('same-opener');
  });

  it('a sloppy passage scores far higher than a plain one', () => {
    const slop = 'It wasn’t the storm. It was the silence that followed, highlighting everything they had lost. A shiver ran down her spine. Her voice barely above a whisper, she spoke of their enduring legacy, a testament to resilience. Ultimately, it was a journey, not just a destination, but a tapestry of moments.';
    const plain = 'The storm took the roof off the shed and the hens with it. Dad found two of them in the Hendersons’ garden on Sunday, sitting in a wheelbarrow as if nothing had happened. We ate the rest. Mum said she had never liked them anyway, which was not true.';
    expect(tellScore(slop)).toBeGreaterThan(30);
    expect(tellScore(plain)).toBe(0);
    const p = tellProfile(slop);
    expect(p.by_family.staging).toBeGreaterThan(0);
    expect(p.top[0].count).toBeGreaterThan(0);
    expect(triadRate('We packed bread, cheese, and apples.')).toBeGreaterThan(0);
  });
});

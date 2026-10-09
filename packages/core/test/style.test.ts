import { describe, expect, it } from 'vitest';
import { applyFixes, checkStyle, diffEdit, fingerprint, StyleSheet, suggestRules, suggestSheet, type EditRecord } from '../src/index.js';

const sheet = (s: Partial<StyleSheet> = {}) => StyleSheet.parse(s);

describe('style sheet: every word checked', () => {
  it('enforced rules are found by code, with exact spans', () => {
    const text = `She realized the color was wrong — all of it; nothing matched!\n\n"Get out!" he hissed.`;
    const r = checkStyle(text, sheet({ spelling: 'uk', em_dashes: 'ban', semicolons: 'dialogue-only', exclamations: 'dialogue-only', dialogue_tags: 'said-only' }));
    const rules = r.violations.filter((v) => v.kind === 'enforced').map((v) => v.rule);
    expect(rules).toEqual(expect.arrayContaining(['spelling', 'em-dash', 'semicolon', 'exclamation', 'dialogue-tag']));
    // The exclamation inside dialogue is allowed; only the narration one is flagged.
    expect(r.violations.filter((v) => v.rule === 'exclamation')).toHaveLength(1);
    for (const v of r.violations.filter((x) => x.end > x.start)) expect(text.slice(v.start, v.end)).toBe(v.text);
  });

  it('deterministic fixes repair spelling, preferred words and tags without a model', () => {
    const text = `She realized the gaze was gray.\n\n"Go," he hissed.`;
    const s = sheet({ spelling: 'uk', prefer: [{ avoid: 'gaze', use: 'look' }], dialogue_tags: 'said-only' });
    const fixed = applyFixes(text, checkStyle(text, s).violations);
    expect(fixed.text).toBe(`She realised the look was grey.\n\n"Go," he said.`);
    expect(checkStyle(fixed.text, s).enforced).toBe(0);
  });

  it('never-list words and over-long sentences are enforced; adverbs are guided', () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ') + '.';
    const text = `It was a tapestry of sound. ${long} She walked slowly, quietly, carefully, sadly away.`;
    const r = checkStyle(text, sheet({ never: ['tapestry'], sentence_words: { mean_min: 1, mean_max: 99, max: 20 }, adverbs_per_1000_max: 5 }));
    expect(r.violations.find((v) => v.rule === 'never')).toMatchObject({ kind: 'enforced', text: 'tapestry' });
    expect(r.violations.find((v) => v.rule === 'sentence-length')).toMatchObject({ kind: 'enforced' });
    expect(r.violations.filter((v) => v.rule === 'adverb').every((v) => v.kind === 'guided')).toBe(true);
  });

  it('a fingerprint of the author’s samples sets the dials', () => {
    const samples = `The tide went out. Mara watched it go. 'You'll catch cold,' Jory said.\n\nShe did not answer. The colour had gone from the sky and the harbour lay grey and flat.`;
    const fp = fingerprint(samples);
    expect(fp.quotes).toBe('single');
    expect(fp.em_dashes_per_1000).toBe(0);
    const s = suggestSheet(fp);
    expect(s.quotes).toBe('single');
    expect(s.em_dashes).toBe('ban');
    expect(s.sentence_words.mean_max).toBeGreaterThan(fp.sentence_mean);
  });
});

describe('style sheet: learning from the author’s edits', () => {
  it('a repeated one-word swap becomes a proposed rule', () => {
    const e1 = diffEdit('s01', 'Her gaze fell on the boat.', 'Her look fell on the boat.')!;
    const e2 = diffEdit('s02', 'His gaze was cold.', 'His look was cold.')!;
    expect(e1.substitutions).toEqual([['gaze', 'look']]);
    const s = suggestRules([e1, e2], sheet());
    expect(s[0]).toMatchObject({ id: 'prefer:gaze:look', patch: { prefer: [{ avoid: 'gaze', use: 'look' }] } });
    // Dismissed suggestions stay dismissed; rules already in the sheet are not suggested.
    expect(suggestRules([e1, e2], sheet(), ['prefer:gaze:look'])).toEqual([]);
    expect(suggestRules([e1, e2], sheet({ prefer: [{ avoid: 'gaze', use: 'look' }] }))).toEqual([]);
  });

  it('cutting adverbs and dashes again and again tightens those dials', () => {
    const edits: EditRecord[] = Array.from({ length: 3 }, (_, i) =>
      diffEdit(`s0${i}`, 'He walked slowly and quietly — then sadly — home.', 'He walked home.')!,
    );
    const ids = suggestRules(edits, sheet()).map((s) => s.id);
    expect(ids).toContain('em-dashes:ban');
    expect(ids.some((id) => id.startsWith('adverbs:'))).toBe(true);
  });
});

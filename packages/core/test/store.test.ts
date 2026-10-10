import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphStore, loadProject, ProjectIndex, sceneOrder, stateAt, cardHash } from '../src/index.js';
import { copyFixture, edit, FIXTURE } from './helpers.js';

describe('phase 1: schemas and store', () => {
  it('the fixture novella validates with no issues', () => {
    const { project, issues } = loadProject(FIXTURE);
    expect(issues).toEqual([]);
    expect(project.scenes.size).toBe(12);
    expect(project.characters.size).toBe(4);
    expect(project.threads.size).toBe(3);
    expect(project.plotPoints.size).toBe(2);
    expect(sceneOrder(project)).toEqual(['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12']);
  });

  it('every fixture scene is in sync', () => {
    const store = GraphStore.open(FIXTURE, { memoryIndex: true });
    expect([...store.sync().values()].map((s) => s.state)).toEqual(Array(12).fill('in_sync'));
    store.close();
  });

  const corruptions: [string, string, (t: string) => string, { file: string; path: string; message: RegExp }][] = [
    ['unknown pov character', 'scenes/s03/card.yaml', (t) => t.replace('pov: mara', 'pov: nobody'), { file: 'scenes/s03/card.yaml', path: 'pov', message: /character "nobody" does not exist/ }],
    ['beats is not a list', 'scenes/s05/card.yaml', (t) => t.replace(/beats:\n(  - .*\n)+/, 'beats: just one beat\n'), { file: 'scenes/s05/card.yaml', path: 'beats', message: /expected array/ }],
    ['bad status value', 'scenes/s02/card.yaml', (t) => t.replace('status: approved', 'status: finished'), { file: 'scenes/s02/card.yaml', path: 'status', message: /Invalid option/ }],
    ['broken YAML', 'threads/ledger.yaml', (t) => t.replace('kind: mystery', 'kind: [mystery'), { file: 'threads/ledger.yaml', path: '', message: /invalid YAML/ }],
    ['id is not a slug', 'plot-points/pp-drowning.yaml', (t) => t.replace('id: pp-drowning', 'id: PP Drowning'), { file: 'plot-points/pp-drowning.yaml', path: 'id', message: /lowercase slugs/ }],
    ['structure points at a missing scene', 'structure.yaml', (t) => t.replace('- s07', '- s99'), { file: 'structure.yaml', path: 'acts.1.chapters.1.scenes.0', message: /scene "s99" does not exist/ }],
    ['state for an unknown scene', 'characters/tom/state.yaml', (t) => t.replace('s06:', 's66:'), { file: 'characters/tom/state.yaml', path: 's66', message: /scene "s66" does not exist/ }],
    ['state field wrong type', 'characters/eliza/state.yaml', (t) => t.replace(/alive: true/, 'alive: "yes"'), { file: 'characters/eliza/state.yaml', path: 's04.alive', message: /expected boolean/ }],
    ['thread payoff at a missing scene', 'threads/mara-jory.yaml', (t) => t.replace('payoff_scene: s12', 'payoff_scene: s13'), { file: 'threads/mara-jory.yaml', path: 'payoff_scene', message: /scene "s13" does not exist/ }],
    ['target_words negative', 'book.yaml', (t) => t.replace('target_words: 12000', 'target_words: -5'), { file: 'book.yaml', path: 'target_words', message: /expected number to be >0/ }],
    ['prose frontmatter wrong type', 'scenes/s08/prose.md', (t) => t.replace(/word_count: \d+/, 'word_count: lots'), { file: 'scenes/s08/prose.md', path: 'word_count', message: /expected number/ }],
    ['mention of unknown character', 'scenes/s09/card.yaml', (t) => t.replace('character: tom\n    fact: jory-boat-lost', 'character: walter\n    fact: jory-boat-lost'), { file: 'scenes/s09/card.yaml', path: 'mentions.1.character', message: /character "walter" does not exist/ }],
  ];

  for (const [label, file, mutate, expected] of corruptions) {
    it(`corruption is reported precisely: ${label}`, () => {
      const dir = copyFixture();
      edit(dir, file, mutate);
      const { issues } = loadProject(dir);
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContainEqual(expect.objectContaining({ file: expected.file, path: expected.path, message: expect.stringMatching(expected.message) }));
    });
  }

  it('the index rebuilds from files and matches the snapshot', () => {
    const dir = copyFixture();
    const store = GraphStore.open(dir);
    const first = store.index!.snapshot();
    store.close();
    expect(fs.existsSync(path.join(dir, '.engine/index.sqlite'))).toBe(true);
    fs.rmSync(path.join(dir, '.engine'), { recursive: true });
    const again = GraphStore.open(dir);
    const second = again.index!.snapshot();
    again.close();
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });

  it('answers "what does Mara know in scene 7" as a lookup', () => {
    const { project } = loadProject(FIXTURE);
    const at = stateAt(project, 'mara', 's07');
    expect(at?.scene).toBe('s06');
    expect(at?.snapshot.knows).toContain('walter-letter');
    expect(at?.snapshot.knows).not.toContain('jory-boat-lost');
  });

  it('writes are validated, persisted, indexed and committed', async () => {
    const dir = copyFixture();
    const store = GraphStore.open(dir, { memoryIndex: true });
    await store.repo.init();
    await store.checkpoint('Initial');
    const card = { ...store.scene('s03').card, location: 'harbour' };
    store.saveCard(card);
    expect(store.sceneSync('s03').state).toBe('card_ahead');
    expect(store.index!.refsFrom('scene:s03')).toContainEqual({ from: 'scene:s03', to: 'location:harbour', field: 'location' });
    expect(() => store.saveCard({ ...card, pov: 'Not A Slug' })).toThrow(/pov/);
    const hash = await store.commit('Move s03 to the harbour wall');
    expect(hash).toBeTruthy();
    const reloaded = loadProject(dir).project;
    expect(reloaded.scenes.get('s03')!.card.location).toBe('harbour');
    expect(cardHash(reloaded.scenes.get('s03')!.card)).toBe(cardHash(card));
    const log = await store.repo.log();
    expect(log[0].message).toBe('Move s03 to the harbour wall');
    store.close();
  });

  it('a prose edit by the author makes the scene prose_ahead; both moving is a conflict', () => {
    const dir = copyFixture();
    const store = GraphStore.open(dir, { memoryIndex: true });
    store.saveProse('s04', store.scene('s04').prose!.body + '\n\nShe left by the back stair.', 'author');
    expect(store.sceneSync('s04').state).toBe('prose_ahead');
    store.saveCard({ ...store.scene('s04').card, outcome: 'Mara leaves shaken.' });
    expect(store.sceneSync('s04').state).toBe('conflict');
    store.markInSync('s04');
    expect(store.sceneSync('s04').state).toBe('in_sync');
    store.close();
  });

  it('locking or approving does not make prose stale', () => {
    const dir = copyFixture();
    const store = GraphStore.open(dir, { memoryIndex: true });
    store.setSceneStatus('s02', { status: 'locked', lock: 'both' });
    expect(store.sceneSync('s02').state).toBe('in_sync');
    store.close();
  });

  it('ProjectIndex can be used in memory', () => {
    const idx = new ProjectIndex(':memory:');
    idx.rebuild(loadProject(FIXTURE).project);
    expect(idx.similar('blue-black ink uncrossed sevens', { limit: 1 })[0].scene).toBe('s05');
    idx.close();
  });
});

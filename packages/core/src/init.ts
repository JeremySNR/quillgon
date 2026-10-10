import fs from 'node:fs';
import path from 'node:path';
import { GraphStore } from './store.js';
import { DEFAULT_MODELS, CODEX_MODELS } from './schemas/index.js';

export const DEFAULT_BANNED = `# Banned patterns

Words and constructions the writer must never use. One per list item.
Plain phrases match whole words, case-insensitive. Use /regex/ for patterns.
Add "(max N per scene)" to allow a few.

- delve
- tapestry
- palpable
- testament to
- "couldn't help but"
- "let out a breath"
- "shivers down"
- "a sense of"
- negation-pivot: /\\bnot (?:just|only|merely) [\\w\\s]+?, but\\b/i
- em-dash: /—/ (max 3 per scene)
`;

export const DEFAULT_SAMPLES = `# Voice samples

Paste a few paragraphs written the way you want the book to sound. The writer matches
their rhythm, diction and how they handle feeling. Your own writing works best.
`;

/** Create a new manuscript repo: book.yaml, intent.md, style files, git. */
export async function initProject(dir: string, opts: { title: string; genre?: string; target_words?: number; offline?: boolean; codex?: boolean }) {
  const root = path.resolve(dir);
  if (fs.existsSync(path.join(root, 'book.yaml'))) throw new Error(`${root} already has a book.yaml`);
  fs.mkdirSync(root, { recursive: true });
  for (const d of ['plot-points', 'threads', 'obligations', 'characters', 'scenes', 'style', 'reports']) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'book.yaml'), `title: ${JSON.stringify(opts.title)}\n`);
  const store = GraphStore.open(root);
  const offline = { provider: 'offline' as const, model: 'offline', price_in: 0, price_out: 0 };
  store.saveBook({
    title: opts.title,
    genre: opts.genre ?? '',
    target_words: opts.target_words ?? 12000,
    // Start at the idea stage; an author who already has a premise can skip straight to intent.
    stage: 'idea',
    models: opts.offline ? { frontier: offline, mid: offline, small: offline, reader: offline } : opts.codex ? CODEX_MODELS : DEFAULT_MODELS,
  });
  store.saveIntent({});
  store.saveStructure({ acts: [] });
  store.saveTimeline({ events: [] });
  store.saveStyle({ samples: DEFAULT_SAMPLES, banned: DEFAULT_BANNED });
  store.saveStyleSheet({});
  for (const d of ['plot-points', 'threads', 'obligations', 'characters', 'scenes', 'reports']) {
    const keep = path.join(root, d, '.gitkeep');
    if (!fs.readdirSync(path.join(root, d)).length) fs.writeFileSync(keep, '');
  }
  await store.repo.init();
  await store.commit(`New book: ${opts.title}`);
  return store;
}

import fs from 'node:fs';
import path from 'node:path';
import { GraphStore } from './store.js';
import { DEFAULT_MODELS, CODEX_MODELS, DEFAULT_LIFE, type BookKind, type LifeSettings } from './schemas/index.js';
import { openingQuestions } from './life.js';
import { slugify } from './util.js';

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

export interface InitOptions {
  title: string;
  genre?: string;
  target_words?: number;
  offline?: boolean;
  codex?: boolean;
  /** A novel (the default), or a life story or memoir gathered from the author's memories. */
  kind?: BookKind;
  /** Life stories: whose life, by name ("Margaret Ellis"); empty for the author's own. */
  subject_name?: string;
  life?: Partial<Pick<LifeSettings, 'subject' | 'born' | 'audience' | 'pen'>>;
}

/** Create a new manuscript repo: book.yaml, intent.md, style files, git. */
export async function initProject(dir: string, opts: InitOptions) {
  const root = path.resolve(dir);
  if (fs.existsSync(path.join(root, 'book.yaml'))) throw new Error(`${root} already has a book.yaml`);
  fs.mkdirSync(root, { recursive: true });
  const kind = opts.kind ?? 'novel';
  const life = kind !== 'novel';
  const dirs = ['plot-points', 'threads', 'obligations', 'characters', 'scenes', 'style', 'reports', ...(life ? ['stories', 'sessions', 'ghostwriter'] : [])];
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'book.yaml'), `title: ${JSON.stringify(opts.title)}\n`);
  const store = GraphStore.open(root);
  const offline = { provider: 'offline' as const, model: 'offline', price_in: 0, price_out: 0 };
  const subject = opts.life?.subject ?? (opts.subject_name?.trim() ? 'other' : 'self');
  const narratorName = opts.subject_name?.trim() || 'Me';
  const narrator = life ? (subject === 'self' && !opts.subject_name?.trim() ? 'me' : slugify(narratorName)) : null;
  store.saveBook({
    title: opts.title,
    kind,
    genre: opts.genre ?? (kind === 'memoir' ? 'memoir' : life ? 'life story' : ''),
    target_words: opts.target_words ?? (life ? 40000 : 12000),
    // A novel starts at the idea stage (an author with a premise can skip to intent). A life
    // story has no premise to find: it starts with the interview.
    stage: life ? 'intent' : 'idea',
    ...(life ? { pov_mode: 'first' as const, tense: 'past' as const } : {}),
    models: opts.offline ? { frontier: offline, mid: offline, small: offline, reader: offline } : opts.codex ? CODEX_MODELS : DEFAULT_MODELS,
    ...(life ? { life: { ...DEFAULT_LIFE, ...opts.life, subject, narrator } } : {}),
  });
  store.saveIntent({});
  if (life && narrator) {
    store.saveCharacter({ bio: { id: narrator, name: narratorName, role: 'narrator', relationship: subject === 'self' ? 'the author' : 'the subject of the book', living: true, naming: 'real', consent: subject === 'self' ? 'not-needed' : 'not-asked', born: opts.life?.born ?? '' } });
    store.saveQuestions({ questions: openingQuestions() });
    store.saveNotebook({});
  }
  // A life story's chapters live in one act: the shape comes later, from what the interviews find.
  store.saveStructure({ acts: life ? [{ id: 'life', title: '', chapters: [] }] : [] });
  store.saveTimeline({ events: [] });
  store.saveStyle({ samples: DEFAULT_SAMPLES, banned: DEFAULT_BANNED });
  store.saveStyleSheet({});
  for (const d of dirs.filter((x) => x !== 'style')) {
    const keep = path.join(root, d, '.gitkeep');
    if (!fs.readdirSync(path.join(root, d)).length) fs.writeFileSync(keep, '');
  }
  await store.repo.init();
  store.repo.ensureIgnored(store.ignoredExtra());
  await store.checkpoint(`New book: ${opts.title}`);
  return store;
}

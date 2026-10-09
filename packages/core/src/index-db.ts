import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Project } from './project.js';
import { sceneOrder, scenePlaces, paths } from './project.js';
import { collectFacts, collectRefs, key, type FactRow, type Ref } from './refs.js';
import { cosine, LocalEmbedder, sceneText, type Embedder } from './embed.js';
import { cardHash, proseHash } from './sync.js';

/**
 * Derived index in .engine/index.sqlite. Nothing here is authoritative:
 * delete the file and it rebuilds from the manuscript files.
 */
export class ProjectIndex {
  readonly db: Database.Database;
  private embedder: LocalEmbedder;

  constructor(file: string | ':memory:', embedder?: LocalEmbedder) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.embedder = embedder ?? new LocalEmbedder();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (key TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL, file TEXT, title TEXT, hash TEXT);
      CREATE TABLE IF NOT EXISTS refs (from_key TEXT NOT NULL, to_key TEXT NOT NULL, field TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS refs_to ON refs(to_key);
      CREATE INDEX IF NOT EXISTS refs_from ON refs(from_key);
      CREATE TABLE IF NOT EXISTS facts (subject TEXT, predicate TEXT, object TEXT, scene_id TEXT, confidence REAL, source TEXT);
      CREATE INDEX IF NOT EXISTS facts_obj ON facts(object);
      CREATE INDEX IF NOT EXISTS facts_subj ON facts(subject);
      CREATE TABLE IF NOT EXISTS scene_order (scene_id TEXT PRIMARY KEY, position INTEGER, act_id TEXT, chapter_id TEXT);
      CREATE TABLE IF NOT EXISTS embeddings (scene_id TEXT PRIMARY KEY, model TEXT, text_hash TEXT, vector TEXT);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    `);
  }

  static forProject(dir: string): ProjectIndex {
    return new ProjectIndex(path.join(dir, paths.engine, 'index.sqlite'));
  }

  close() {
    this.db.close();
  }

  /** Full rebuild from the in-memory project. */
  rebuild(p: Project) {
    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM entities; DELETE FROM refs; DELETE FROM facts; DELETE FROM scene_order;');
      this.writeEntities(p);
      this.writeRefs(collectRefs(p));
      this.writeFacts(collectFacts(p));
      this.writeOrder(p);
      this.writeEmbeddings(p);
      this.db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('built_at', new Date().toISOString());
    });
    tx();
  }

  /**
   * Incremental update after a write. Refs, facts and order are cheap to recompute
   * wholesale; embeddings only for scenes whose text changed.
   */
  update(p: Project) {
    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM entities; DELETE FROM refs; DELETE FROM facts; DELETE FROM scene_order;');
      this.writeEntities(p);
      this.writeRefs(collectRefs(p));
      this.writeFacts(collectFacts(p));
      this.writeOrder(p);
      this.writeEmbeddings(p);
    });
    tx();
  }

  private writeEntities(p: Project) {
    const ins = this.db.prepare('INSERT OR REPLACE INTO entities (key, kind, id, file, title, hash) VALUES (?, ?, ?, ?, ?, ?)');
    for (const s of p.scenes.values())
      ins.run(key('scene', s.id), 'scene', s.id, paths.card(s.id), s.card.title, `${cardHash(s.card)}:${s.prose ? proseHash(s.prose.body) : ''}`);
    for (const c of p.characters.values()) ins.run(key('character', c.id), 'character', c.id, paths.bio(c.id), c.bio.name, null);
    for (const t of p.threads.values()) ins.run(key('thread', t.id), 'thread', t.id, paths.thread(t.id), t.title, null);
    for (const pp of p.plotPoints.values()) ins.run(key('plot', pp.id), 'plot', pp.id, paths.plotPoint(pp.id), pp.title || pp.description, null);
    for (const l of p.locations.locations) ins.run(key('location', l.id), 'location', l.id, paths.locations, l.name, null);
    for (const f of p.factGlossary.facts) ins.run(key('fact', f.id), 'fact', f.id, paths.factGlossary, f.statement, null);
  }

  private writeRefs(refs: Ref[]) {
    const ins = this.db.prepare('INSERT INTO refs (from_key, to_key, field) VALUES (?, ?, ?)');
    for (const r of refs) ins.run(r.from, r.to, r.field);
  }

  private writeFacts(rows: FactRow[]) {
    const ins = this.db.prepare('INSERT INTO facts (subject, predicate, object, scene_id, confidence, source) VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of rows) ins.run(f.subject, f.predicate, f.object, f.scene, f.confidence, f.source);
  }

  private writeOrder(p: Project) {
    const ins = this.db.prepare('INSERT INTO scene_order (scene_id, position, act_id, chapter_id) VALUES (?, ?, ?, ?)');
    for (const [id, place] of scenePlaces(p)) ins.run(id, place.index, place.act, place.chapter);
  }

  private writeEmbeddings(p: Project) {
    const get = this.db.prepare('SELECT text_hash FROM embeddings WHERE scene_id = ? AND model = ?');
    const ins = this.db.prepare('INSERT OR REPLACE INTO embeddings (scene_id, model, text_hash, vector) VALUES (?, ?, ?, ?)');
    const live = new Set<string>();
    for (const s of p.scenes.values()) {
      live.add(s.id);
      const text = sceneText(s, p);
      const h = proseHash(text);
      const row = get.get(s.id, this.embedder.name) as { text_hash: string } | undefined;
      if (row?.text_hash === h) continue;
      const vec = this.embedder.embedOne(text);
      ins.run(s.id, this.embedder.name, h, JSON.stringify(vec.map((x) => Math.round(x * 1e5) / 1e5)));
    }
    const all = this.db.prepare('SELECT scene_id FROM embeddings').all() as { scene_id: string }[];
    const del = this.db.prepare('DELETE FROM embeddings WHERE scene_id = ?');
    for (const r of all) if (!live.has(r.scene_id)) del.run(r.scene_id);
  }

  // ------------------------------------------------------------- queries

  refsTo(toKey: string): Ref[] {
    return (this.db.prepare('SELECT from_key AS "from", to_key AS "to", field FROM refs WHERE to_key = ?').all(toKey) as Ref[]);
  }

  refsFrom(fromKey: string): Ref[] {
    return (this.db.prepare('SELECT from_key AS "from", to_key AS "to", field FROM refs WHERE from_key = ?').all(fromKey) as Ref[]);
  }

  facts(where: Partial<Pick<FactRow, 'subject' | 'predicate' | 'object' | 'scene'>> = {}): FactRow[] {
    const clauses: string[] = [];
    const args: string[] = [];
    if (where.subject) (clauses.push('subject = ?'), args.push(where.subject));
    if (where.predicate) (clauses.push('predicate = ?'), args.push(where.predicate));
    if (where.object) (clauses.push('object = ?'), args.push(where.object));
    if (where.scene) (clauses.push('scene_id = ?'), args.push(where.scene));
    const sql = `SELECT subject, predicate, object, scene_id AS scene, confidence, source FROM facts ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}`;
    return this.db.prepare(sql).all(...args) as FactRow[];
  }

  position(sceneId: string): number {
    const r = this.db.prepare('SELECT position FROM scene_order WHERE scene_id = ?').get(sceneId) as { position: number } | undefined;
    return r?.position ?? -1;
  }

  vector(sceneId: string): number[] | null {
    const r = this.db.prepare('SELECT vector FROM embeddings WHERE scene_id = ?').get(sceneId) as { vector: string } | undefined;
    return r ? JSON.parse(r.vector) : null;
  }

  /** Scenes ranked by similarity to a free-text query. */
  similar(text: string, opts: { limit?: number; exclude?: string[] } = {}): { scene: string; score: number }[] {
    const q = this.embedder.embedOne(text);
    return this.similarToVector(q, opts);
  }

  similarToVector(q: number[], opts: { limit?: number; exclude?: string[] } = {}) {
    const rows = this.db.prepare('SELECT scene_id, vector FROM embeddings').all() as { scene_id: string; vector: string }[];
    const ex = new Set(opts.exclude ?? []);
    return rows
      .filter((r) => !ex.has(r.scene_id))
      .map((r) => ({ scene: r.scene_id, score: cosine(q, JSON.parse(r.vector)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit ?? 1000);
  }

  /** Deterministic dump used by the "index rebuilds and matches snapshot" test. */
  snapshot() {
    return {
      entities: this.db.prepare('SELECT key, kind, id, file, title FROM entities ORDER BY key').all(),
      refs: this.db.prepare('SELECT from_key, to_key, field FROM refs ORDER BY from_key, to_key, field').all(),
      facts: this.db
        .prepare('SELECT subject, predicate, object, scene_id, confidence, source FROM facts ORDER BY scene_id, subject, predicate, object, source')
        .all(),
      order: this.db.prepare('SELECT scene_id, position, act_id, chapter_id FROM scene_order ORDER BY position').all(),
      embedded: (this.db.prepare('SELECT COUNT(*) AS n FROM embeddings').get() as { n: number }).n,
    };
  }
}

export function storyOrder(p: Project) {
  return sceneOrder(p);
}

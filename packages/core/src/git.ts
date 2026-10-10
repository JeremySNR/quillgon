import fs from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

/**
 * Refs arrive from the UI (branch names, hashes from history, compare targets). Anything
 * git could read as an option, or that is not a plausible ref, is refused before it reaches
 * the command line.
 */
export function assertRef(ref: unknown, what = 'ref'): string {
  const ok =
    typeof ref === 'string' &&
    ref.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._/~^-]*$/.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.') &&
    !ref.endsWith('.lock');
  if (!ok) throw new InvalidRefError(`invalid ${what}: ${JSON.stringify(ref)}`);
  return ref;
}

/** A branch name: a ref without revision suffixes. */
export function assertBranch(name: unknown): string {
  const ref = assertRef(name, 'branch name');
  if (/[~^]/.test(ref)) throw new InvalidRefError(`invalid branch name: ${JSON.stringify(name)}`);
  return ref;
}

export class InvalidRefError extends Error {}

export interface Commit {
  hash: string;
  date: string;
  message: string;
  body: string;
  files?: string[];
}

/**
 * Every accepted change is a commit; every "what if" is a branch.
 * No custom branching logic: git does it.
 */
export class Repo {
  readonly git: SimpleGit;
  constructor(readonly dir: string) {
    this.git = simpleGit({ baseDir: dir });
  }

  isRepo(): boolean {
    return fs.existsSync(path.join(this.dir, '.git'));
  }

  async init() {
    if (this.isRepo()) return this.ensureIgnored();
    await this.git.init(['-b', 'main']);
    this.ensureIgnored();
    await this.ensureIdentity();
  }

  /** The index, proposals and exports never belong in history, even in a pre-existing repo. */
  ensureIgnored() {
    const ignore = path.join(this.dir, '.gitignore');
    const text = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
    const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const missing = ['.engine/', 'export/'].filter((e) => !lines.has(e) && !lines.has(e.slice(0, -1)) && !lines.has('/' + e));
    if (missing.length) fs.writeFileSync(ignore, text + (text && !text.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
  }

  private async ensureIdentity() {
    const name = await this.git.getConfig('user.name');
    if (!name.value) await this.git.addConfig('user.name', 'Quillgon');
    const email = await this.git.getConfig('user.email');
    if (!email.value) await this.git.addConfig('user.email', 'engine@localhost');
  }

  /**
   * Commit. With no options, a checkpoint: everything in the working tree. With `files`,
   * only those paths (deletions included), whatever else is modified. With `exclude`,
   * everything except those paths. Returns the hash, or null if there was nothing to commit.
   */
  async commit(message: string, opts: string[] | { files?: string[]; exclude?: string[] } = {}): Promise<string | null> {
    if (!this.isRepo()) return null;
    const { files, exclude } = Array.isArray(opts) ? { files: opts, exclude: undefined } : opts;
    await this.ensureIdentity();
    const hasHead = await this.git.raw(['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
    // Start from a clean index, so nothing staged earlier rides along.
    if (hasHead) await this.git.raw(['reset', '-q']);
    if (files) {
      if (!files.length) return null;
      const literal = files.map((f) => `:(literal)${f}`);
      // A path that was written and removed again before any commit is unknown to git.
      const tracked = new Set((await this.git.raw(['ls-files', '-z', '--', ...literal])).split('\0').filter(Boolean));
      const known = files.filter((f) => fs.existsSync(path.join(this.dir, f)) || [...tracked].some((t) => t === f || t.startsWith(f + '/')));
      if (!known.length) return null;
      await this.git.raw(['add', '-A', '--', ...known.map((f) => `:(literal)${f}`)]);
    } else if (exclude?.length) {
      await this.git.raw(['add', '-A', '--', '.', ...exclude.map((f) => `:(exclude,literal)${f}`)]);
    } else {
      await this.git.add(['-A']);
    }
    const staged = (await this.git.raw(['diff', '--cached', '--name-only'])).trim();
    if (!staged) return null;
    const r = await this.git.commit(message);
    return r.commit || null;
  }

  /** Commits that touched a path, newest first. */
  async history(rel: string, limit = 50): Promise<string[]> {
    if (!this.isRepo()) return [];
    try {
      const out = await this.git.raw(['log', `--max-count=${limit}`, '--format=%H', '--', `:(literal)${rel}`]);
      return out.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async log(limit = 50): Promise<Commit[]> {
    if (!this.isRepo()) return [];
    try {
      const r = await this.git.log({ maxCount: limit });
      return r.all.map((c) => ({ hash: c.hash, date: c.date, message: c.message, body: c.body }));
    } catch {
      return [];
    }
  }

  async show(hash: string): Promise<{ files: string[]; patch: string }> {
    assertRef(hash, 'commit');
    const files = (await this.git.raw(['show', '--name-only', '--format=', hash])).split('\n').filter(Boolean);
    const patch = await this.git.raw(['show', '--format=', hash]);
    return { files, patch };
  }

  async currentBranch(): Promise<string> {
    if (!this.isRepo()) return 'main';
    try {
      return (await this.git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    } catch {
      return 'main';
    }
  }

  async branches(): Promise<{ current: string; all: string[] }> {
    if (!this.isRepo()) return { current: 'main', all: ['main'] };
    const r = await this.git.branchLocal();
    return { current: r.current, all: r.all };
  }

  /** Start a "what if": commit pending work, then branch from here. */
  async createBranch(name: string) {
    assertBranch(name);
    await this.commit(`Checkpoint before what-if "${name}"`);
    await this.git.checkoutLocalBranch(name);
  }

  async switchBranch(name: string) {
    assertBranch(name);
    await this.commit(`Checkpoint before switching to "${name}"`);
    await this.git.checkout(name);
  }

  async deleteBranch(name: string) {
    assertBranch(name);
    await this.git.deleteLocalBranch(name, true);
  }

  async merge(from: string): Promise<{ ok: boolean; conflicts: string[] }> {
    assertBranch(from);
    try {
      await this.git.merge([from, '--no-ff', '-m', `Merge what-if "${from}"`]);
      return { ok: true, conflicts: [] };
    } catch (e) {
      const status = await this.git.status();
      await this.git.merge(['--abort']).catch(() => undefined);
      return { ok: false, conflicts: status.conflicted.length ? status.conflicted : [(e as Error).message] };
    }
  }

  async revert(hash: string) {
    assertRef(hash, 'commit');
    await this.git.revert(hash, ['--no-edit']);
  }

  /** Read a file as it is on another branch (for scene-by-scene comparison). */
  async readAt(ref: string, rel: string): Promise<string | null> {
    assertRef(ref);
    try {
      return await this.git.show([`${ref}:${rel}`]);
    } catch {
      return null;
    }
  }

  async changedBetween(a: string, b: string): Promise<string[]> {
    assertRef(a);
    assertRef(b);
    const out = await this.git.raw(['diff', '--name-only', `${a}...${b}`]);
    return out.split('\n').filter(Boolean);
  }
}

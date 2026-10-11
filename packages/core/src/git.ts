import fs from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

/**
 * Refs arrive from the UI (branch names, hashes from history, compare targets). The rules
 * are git's own (git check-ref-format), plus the one that matters for safety: nothing that
 * starts with "-", which git would read as an option. Revisions may end in ~n or ^n.
 */
export function assertRef(ref: unknown, what = 'ref'): string {
  if (!validRef(ref, true)) throw new InvalidRefError(`invalid ${what}: ${JSON.stringify(ref)}`);
  return ref as string;
}

/** A branch name: a ref without revision suffixes. */
export function assertBranch(name: unknown): string {
  if (!validRef(name, false)) throw new InvalidRefError(`invalid branch name: ${JSON.stringify(name)}`);
  return name as string;
}

function validRef(ref: unknown, revision: boolean): boolean {
  if (typeof ref !== 'string' || !ref || ref.length > 200 || ref === '@') return false;
  // Strip a trailing revision suffix (HEAD~2, abc123^, main^2) before checking the name.
  const name = revision ? ref.replace(/([~^]\d*)+$/, '') : ref;
  if (!name || name.startsWith('-')) return false;
  // Control characters, space and ~ ^ : ? * [ \ are never allowed in a ref name.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  return name.split('/').every((part) => part && !part.startsWith('.'));
}

export class InvalidRefError extends Error {}

/** The working tree had uncommitted changes, so a revert was not attempted. */
export class DirtyTreeError extends Error {}

/** A revert that would overwrite later work. Nothing was changed. */
export class RevertConflictError extends Error {
  constructor(readonly files: string[]) {
    super(`these files changed again since, so the revert was not applied (nothing was changed): ${files.join(', ')}`);
  }
}

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

  /**
   * The index, proposals and exports never belong in history, even in a pre-existing repo.
   * `extra` adds more (a life story's recordings, audio/).
   */
  ensureIgnored(extra: string[] = []) {
    const ignore = path.join(this.dir, '.gitignore');
    const text = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
    const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const missing = ['.engine/', 'export/', ...extra].filter((e) => !lines.has(e) && !lines.has(e.slice(0, -1)) && !lines.has('/' + e));
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
    const hasHead = !!(await this.head());
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

  async head(): Promise<string | null> {
    return this.git.raw(['rev-parse', '--verify', '-q', 'HEAD']).then((h) => h.trim() || null, () => null);
  }

  /** Revert one commit. All or nothing: on a conflict the tree is put back and this throws. */
  async revert(hash: string): Promise<string | null> {
    assertRef(hash, 'commit');
    const subject = (await this.git.raw(['log', '-1', '--format=%s', hash])).trim();
    return this.revertAll([hash], `Revert "${subject}"`);
  }

  /**
   * Revert several commits (newest first) as one new commit. All or nothing: if any of
   * them conflicts with later work, the tree is restored and RevertConflictError names
   * the files. The working tree must be clean (checkpoint first).
   */
  async revertAll(hashes: string[], message: string): Promise<string | null> {
    for (const h of hashes) assertRef(h, 'commit');
    if (!hashes.length) return null;
    const head = await this.head();
    if (!head) throw new Error('nothing to revert: the book has no commits');
    if ((await this.git.raw(['status', '--porcelain', '--untracked-files=no'])).trim()) {
      throw new DirtyTreeError('commit or checkpoint pending changes before reverting');
    }
    // A merge commit (a merged what-if) is reverted relative to the branch it was merged into.
    for (const h of hashes) {
      // Not -q: simple-git only rejects when git writes to stderr.
      const known = await this.git.raw(['rev-parse', '--verify', `${h}^{commit}`]).then((out) => !!out.trim(), () => false);
      if (!known) throw new Error(`the revert was not applied (nothing was changed): no commit ${h}`);
    }
    const merge = hashes.length === 1 && (await this.git.raw(['rev-list', '--parents', '-n', '1', hashes[0]])).trim().split(/\s+/).length > 2;
    try {
      await this.git.raw(['revert', '--no-commit', ...(merge ? ['-m', '1'] : []), ...hashes]);
    } catch (e) {
      const conflicted = (await this.git.status()).conflicted;
      await this.git.raw(['revert', '--abort']).catch(() => this.git.raw(['reset', '-q', '--hard', head]));
      // Belt and braces: whatever abort did, HEAD and the tree are as they were.
      if ((await this.head()) !== head) await this.git.raw(['reset', '-q', '--hard', head]);
      if (conflicted.length) throw new RevertConflictError(conflicted);
      throw new Error(`the revert was not applied (nothing was changed): ${(e as Error).message}`);
    }
    if (!(await this.git.raw(['diff', '--cached', '--name-only'])).trim()) {
      await this.git.raw(['revert', '--quit']).catch(() => undefined);
      return null;
    }
    const r = await this.git.commit(message);
    await this.git.raw(['revert', '--quit']).catch(() => undefined);
    return r.commit || null;
  }

  /**
   * Put files back as they were at a commit (e.g. a deleted scene, from before its
   * deletion). Files that did not exist then are removed.
   */
  async restore(ref: string, rels: string[]) {
    assertRef(ref);
    if (!rels.length) return;
    const existed = new Set((await this.git.raw(['ls-tree', '-r', '--name-only', ref, '--', ...rels.map((r) => `:(literal)${r}`)])).split('\n').filter(Boolean));
    const back = rels.filter((r) => existed.has(r));
    if (back.length) await this.git.raw(['checkout', ref, '--', ...back.map((r) => `:(literal)${r}`)]);
    for (const r of rels.filter((x) => !existed.has(x))) fs.rmSync(path.join(this.dir, r), { force: true });
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

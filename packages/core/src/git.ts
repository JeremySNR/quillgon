import fs from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

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
    if (this.isRepo()) return;
    await this.git.init(['-b', 'main']);
    const ignore = path.join(this.dir, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '.engine/\nexport/\n');
    await this.ensureIdentity();
  }

  private async ensureIdentity() {
    const name = await this.git.getConfig('user.name');
    if (!name.value) await this.git.addConfig('user.name', 'Quillgon');
    const email = await this.git.getConfig('user.email');
    if (!email.value) await this.git.addConfig('user.email', 'engine@localhost');
  }

  /** Stage everything (or just `files`) and commit. Returns the hash, or null if nothing changed. */
  async commit(message: string, files?: string[]): Promise<string | null> {
    if (!this.isRepo()) return null;
    await this.ensureIdentity();
    if (files?.length) await this.git.add(files);
    else await this.git.add(['-A']);
    const status = await this.git.status();
    if (status.staged.length === 0 && status.created.length === 0 && status.deleted.length === 0 && status.renamed.length === 0) {
      if (status.files.length === 0) return null;
    }
    const r = await this.git.commit(message);
    return r.commit || null;
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
    await this.commit(`Checkpoint before what-if "${name}"`);
    await this.git.checkoutLocalBranch(name);
  }

  async switchBranch(name: string) {
    await this.commit(`Checkpoint before switching to "${name}"`);
    await this.git.checkout(name);
  }

  async deleteBranch(name: string) {
    await this.git.deleteLocalBranch(name, true);
  }

  async merge(from: string): Promise<{ ok: boolean; conflicts: string[] }> {
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
    await this.git.revert(hash, ['--no-edit']);
  }

  /** Read a file as it is on another branch (for scene-by-scene comparison). */
  async readAt(ref: string, rel: string): Promise<string | null> {
    try {
      return await this.git.show([`${ref}:${rel}`]);
    } catch {
      return null;
    }
  }

  async changedBetween(a: string, b: string): Promise<string[]> {
    const out = await this.git.raw(['diff', '--name-only', `${a}...${b}`]);
    return out.split('\n').filter(Boolean);
  }
}

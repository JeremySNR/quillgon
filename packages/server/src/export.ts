import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { GraphStore } from '@novel/core';

/** The manuscript as one Markdown document: acts and chapters as headings, scenes separated. */
export function manuscriptMarkdown(store: GraphStore): string {
  const p = store.project;
  const out: string[] = [`% ${p.book.title}`, ''];
  for (const act of p.structure.acts) {
    if (p.structure.acts.length > 1) out.push(`# ${act.title || act.id}`, '');
    for (const ch of act.chapters) {
      out.push(`## ${ch.title || ch.id}`, '');
      const bodies = ch.scenes.map((s) => p.scenes.get(s)?.prose?.body).filter((b): b is string => !!b);
      out.push(bodies.join('\n\n* * *\n\n'), '');
    }
  }
  return out.join('\n');
}

/** Export to Markdown, or to docx/epub through Pandoc when it is installed. */
export function exportManuscript(store: GraphStore, format: 'md' | 'docx' | 'epub') {
  const md = manuscriptMarkdown(store);
  const name = store.book.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'manuscript';
  const outDir = path.join(store.dir, 'export');
  fs.mkdirSync(outDir, { recursive: true });
  const mdFile = path.join(outDir, `${name}.md`);
  fs.writeFileSync(mdFile, md);
  if (format === 'md') return { file: mdFile, words: md.split(/\s+/).length };
  const target = path.join(outDir, `${name}.${format}`);
  try {
    execFileSync('pandoc', [mdFile, '-o', target, '--metadata', `title=${store.book.title}`], { stdio: 'pipe', cwd: os.tmpdir() });
  } catch (e) {
    throw new Error(`Pandoc is needed for ${format} export and was not found or failed: ${(e as Error).message.split('\n')[0]}`);
  }
  return { file: target };
}

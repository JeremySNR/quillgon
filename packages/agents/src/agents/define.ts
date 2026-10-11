import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodType } from 'zod';
import type { AgentName, Book, Intent } from '@quillgon/core';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface AgentDef<I, O> {
  name: AgentName;
  /** Distinguishes jobs within one agent (planner.structures, reviser.card…). */
  task: string;
  input: ZodType<I>;
  output: ZodType<O>;
  render(input: I): string;
  maxTokens?: number;
}

export function defineAgent<I, O>(def: AgentDef<I, O>): AgentDef<I, O> {
  return def;
}

/** Built-in prompt for an agent; a project may override it with prompts/<agent>.md. */
export function builtinPrompt(name: AgentName | 'shared' | 'shared-life' | 'shared-guide'): string {
  const file = name === 'shared' || name === 'shared-life' || name === 'shared-guide' ? path.join(here, `${name}.md`) : path.join(here, name, 'prompt.md');
  return fs.readFileSync(file, 'utf8');
}

export function loadPrompt(name: AgentName, projectDir?: string): string {
  if (projectDir) {
    const override = path.join(projectDir, 'prompts', `${name}.md`);
    if (fs.existsSync(override)) return fs.readFileSync(override, 'utf8');
  }
  return builtinPrompt(name);
}

/** The intent and its hard rules always go in the system prompt. */
export function intentBlock(intent: Intent, book?: Pick<Book, 'kind' | 'life' | 'title'> & Partial<Pick<Book, 'guide'>>): string {
  const lines = ['# This book'];
  const life = book && book.kind !== 'novel';
  const g = book?.kind === 'guide' ? book.guide : undefined;
  if (g) {
    lines.push(`A guide${book!.title ? `, "${book!.title}"` : ''}: ${g.preset === 'general' ? 'non-fiction' : g.preset === 'finance' ? 'personal finance' : g.preset === 'coaching' ? 'coaching' : 'self-help'} that teaches what the author knows.`);
    if (g.reader) lines.push(`For: ${g.reader}`);
    if (g.promise) lines.push(`The promise: ${g.promise}`);
    if (g.method) lines.push(`The author's method: ${g.method}`);
    if (g.jurisdiction || g.as_of) lines.push(`Figures and rules must hold${g.jurisdiction ? ` in ${g.jurisdiction}` : ''}${g.as_of ? ` as of ${g.as_of}` : ''}.`);
    if (intent.premise) lines.push(`What it is really about: ${intent.premise}`);
  } else if (life) {
    lines.push(`A ${book.kind === 'memoir' ? 'memoir' : 'life story'}${book.title ? `, "${book.title}"` : ''}, written for ${book.life.audience === 'family' ? 'family and friends' : 'publication'}.`);
    if (intent.premise) lines.push(`What it is really about: ${intent.premise}`);
  } else if (intent.premise) lines.push(`Premise: ${intent.premise}`);
  if (intent.themes.length) lines.push(`Themes: ${intent.themes.join('; ')}`);
  if (intent.tone) lines.push(`Tone: ${intent.tone}`);
  if (intent.ending_type) lines.push(`Ending: ${intent.ending_type}`);
  if (intent.hard_rules.length) {
    lines.push('', life ? '## Hard rules and topics off limits (never break these)' : '## Hard rules (never break these)');
    for (const r of intent.hard_rules) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

export const json = (label: string, v: unknown) => `## ${label}\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``;

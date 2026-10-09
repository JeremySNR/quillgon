import { createHash } from 'node:crypto';
import YAML from 'yaml';

/** Deterministic JSON: object keys sorted recursively. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function sha(text: string, len = 16): string {
  return createHash('sha256').update(text).digest('hex').slice(0, len);
}

export function hashValue(value: unknown): string {
  return sha(canonical(value));
}

export function wordCount(text: string): number {
  const m = text.replace(/[#*_>`-]/g, ' ').match(/[\p{L}\p{N}'’]+/gu);
  return m ? m.length : 0;
}

export function toYaml(value: unknown): string {
  return YAML.stringify(value, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
}

export function fromYaml(text: string): unknown {
  return YAML.parse(text);
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a Markdown file into YAML frontmatter and body. */
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = text.match(FM);
  if (!m) return { data: {}, body: text };
  const data = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
  return { data, body: text.slice(m[0].length) };
}

export function withFrontmatter(data: Record<string, unknown>, body: string): string {
  const fm = toYaml(data).trimEnd();
  return `---\n${fm}\n---\n\n${body.trim()}\n`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

export function timestamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
}

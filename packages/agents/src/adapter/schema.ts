import { strictify } from './anthropic.js';

/** Arbitrary-key records cannot be closed without losing their keys. Keep Zod validation. */
export function nativeSchema(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  function hasRecord(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasRecord);
    const node = value as Record<string, unknown>;
    if (node.type === 'object' && !node.properties) return true;
    return Object.values(node).some(hasRecord);
  }
  return hasRecord(schema) ? undefined : strictify(schema) as Record<string, unknown>;
}

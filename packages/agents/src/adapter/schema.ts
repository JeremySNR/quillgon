/**
 * Native structured output takes a JSON Schema subset. Two dialects:
 *  - 'optional' (Anthropic): every object closed with additionalProperties: false;
 *    optional properties stay optional.
 *  - 'nullable' (OpenAI strict mode, Codex): every property must be listed as required,
 *    so an optional property becomes required-but-nullable. Without this, strict mode makes
 *    the model invent a value for every optional field. stripInventedNulls removes the
 *    nulls again before Zod validation, so Zod defaults apply.
 * Constraints Zod still enforces locally (lengths, ranges, patterns) are dropped.
 */
export type SchemaDialect = 'optional' | 'nullable';

const DROP = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'pattern', 'format', 'maxItems', 'default', '$schema', 'propertyNames']);

export function strictify(schema: unknown, dialect: SchemaDialect = 'optional'): unknown {
  if (Array.isArray(schema)) return schema.map((s) => strictify(s, dialect));
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
    out[k] = strictify(v, dialect);
  }
  if (out.type === 'object' && out.properties) {
    out.additionalProperties = false;
    const props = out.properties as Record<string, unknown>;
    const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
    if (dialect === 'nullable') {
      for (const key of Object.keys(props)) if (!required.has(key) && !acceptsNull(props[key])) props[key] = { anyOf: [props[key], { type: 'null' }] };
      out.required = Object.keys(props);
    } else if (required.size) {
      out.required = [...required];
    } else {
      delete out.required;
    }
  }
  return out;
}

/** Arbitrary-key records cannot be closed without losing their keys. Keep Zod validation. */
export function nativeSchema(schema: Record<string, unknown>, dialect: SchemaDialect = 'nullable'): Record<string, unknown> | undefined {
  function hasRecord(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasRecord);
    const node = value as Record<string, unknown>;
    if (node.type === 'object' && !node.properties) return true;
    return Object.values(node).some(hasRecord);
  }
  return hasRecord(schema) ? undefined : (strictify(schema, dialect) as Record<string, unknown>);
}

function acceptsNull(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const n = s as Record<string, unknown>;
  if (n.type === 'null' || (Array.isArray(n.type) && n.type.includes('null')) || n.const === null) return true;
  if (Array.isArray(n.enum) && n.enum.includes(null)) return true;
  return [n.anyOf, n.oneOf].some((xs) => Array.isArray(xs) && xs.some(acceptsNull));
}

/**
 * Drop `null` from properties the original schema marks optional and not nullable: those
 * nulls only mean "absent" (see the 'nullable' dialect). Everything else is left alone.
 */
export function stripInventedNulls(value: unknown, schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || value === null || typeof value !== 'object') return value;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(value)) return s.items ? value.map((v) => stripInventedNulls(v, s.items)) : value;
  const branches = [s.anyOf, s.oneOf].find(Array.isArray) as unknown[] | undefined;
  if (!s.properties && branches) {
    const obj = branches.find((b) => !!b && typeof b === 'object' && (b as Record<string, unknown>).properties);
    return obj ? stripInventedNulls(value, obj) : value;
  }
  const props = s.properties as Record<string, unknown> | undefined;
  if (!props) return value;
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null && !required.has(k) && props[k] && !acceptsNull(props[k])) continue;
    out[k] = stripInventedNulls(v, props[k]);
  }
  return out;
}

import { z, type ZodType } from 'zod';
import { DEFAULT_MODELS, type Book, type ModelConfig, type ModelTier } from '@novel/core';
import type { Backend, Message, UsageRecord } from './types.js';
import { SchemaFailure } from './types.js';

export interface CompleteOptions<T> {
  agent: string;
  tier: ModelTier;
  system: string;
  messages: Message[];
  schema: ZodType<T>;
  schemaName: string;
  maxTokens?: number;
  scene?: string;
}

/** Pull the first JSON value out of model text (tolerates code fences and preamble). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    if (start < 0) throw new Error('no JSON found in model output');
    const open = body[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    for (let i = start; i < body.length; i++) {
      const ch = body[i];
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
    throw new Error('unterminated JSON in model output');
  }
}

export function formatZodError(e: z.ZodError): string {
  return e.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

/**
 * The one adapter the agents use: complete(messages, schema, options) -> parsed object.
 * Validates with Zod; on failure re-prompts with the validation error (max 2 retries).
 * Logs model, tokens and cost for every call.
 */
export class ModelAdapter {
  constructor(
    private backends: Record<string, Backend>,
    private book: () => Book,
    private onUsage: (u: UsageRecord) => void = () => undefined,
  ) {}

  configFor(tier: ModelTier): ModelConfig {
    return { ...DEFAULT_MODELS[tier], ...(this.book().models[tier] ?? {}) } as ModelConfig;
  }

  async complete<T>(opts: CompleteOptions<T>): Promise<T> {
    const config = this.configFor(opts.tier);
    const backend = this.backends[config.provider];
    if (!backend) throw new Error(`no backend for provider "${config.provider}"`);
    const jsonSchema = z.toJSONSchema(opts.schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    const system = `${opts.system}\n\n## Output\nRespond with a single JSON object and nothing else. It must validate against this JSON Schema:\n\n${JSON.stringify(jsonSchema)}`;
    const messages = [...opts.messages];
    let lastError = '';
    let lastText = '';
    let inTok = 0;
    let outTok = 0;
    let cacheW = 0;
    let cacheR = 0;
    let model = config.model;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await backend.call({ config, system, messages, jsonSchema, schemaName: opts.schemaName, maxTokens: opts.maxTokens ?? 32000 });
      inTok += res.inputTokens;
      outTok += res.outputTokens;
      cacheW += res.cacheWriteTokens ?? 0;
      cacheR += res.cacheReadTokens ?? 0;
      model = res.model;
      lastText = res.text;
      let parsed: unknown;
      try {
        parsed = extractJson(res.text);
      } catch (e) {
        lastError = (e as Error).message;
        messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: `That was not valid JSON (${lastError}). Reply again with only the JSON object.` });
        continue;
      }
      const r = opts.schema.safeParse(parsed);
      if (r.success) {
        this.log(opts, config, model, inTok, outTok, attempt, true, cacheW, cacheR);
        return r.data;
      }
      lastError = formatZodError(r.error);
      messages.push(
        { role: 'assistant', content: res.text },
        { role: 'user', content: `Your JSON did not validate:\n${lastError}\n\nReply again with the corrected JSON object only. Change nothing else.` },
      );
    }
    this.log(opts, config, model, inTok, outTok, 3, false, cacheW, cacheR);
    throw new SchemaFailure(opts.agent, 3, lastError, lastText);
  }

  private log(opts: CompleteOptions<unknown>, config: ModelConfig, model: string, inTok: number, outTok: number, attempts: number, ok: boolean, cacheW = 0, cacheR = 0) {
    const pin = config.price_in ?? 0;
    const cost = (inTok * pin + cacheW * pin * 1.25 + cacheR * pin * 0.1 + outTok * (config.price_out ?? 0)) / 1e6;
    this.onUsage({
      ts: new Date().toISOString(),
      agent: opts.agent,
      scene: opts.scene,
      tier: opts.tier,
      provider: config.provider,
      model,
      input_tokens: inTok,
      output_tokens: outTok,
      ...(cacheW || cacheR ? { cache_write_tokens: cacheW, cache_read_tokens: cacheR } : {}),
      cost_usd: Math.round(cost * 1e6) / 1e6,
      attempts,
      ok,
    });
  }
}

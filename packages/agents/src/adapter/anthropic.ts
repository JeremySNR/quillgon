import Anthropic from '@anthropic-ai/sdk';
import type { Backend, RawRequest, RawResponse } from './types.js';
import { RefusalError } from './types.js';

/**
 * Claude via the official SDK. Streams (long prose outputs), uses adaptive thinking with
 * the configured effort, asks for native JSON-schema output, and falls back to
 * prompt-only JSON if a schema uses features the API does not accept.
 */
export class AnthropicBackend implements Backend {
  readonly provider = 'anthropic';
  private clients = new Map<string, Anthropic>();
  /** Schemas the API rejected for native structured output; use prompt-only JSON for these. */
  private noNative = new Set<string>();

  private client(req: RawRequest): Anthropic {
    const k = `${req.config.base_url ?? ''}|${req.config.api_key_env ?? ''}`;
    let c = this.clients.get(k);
    if (!c) {
      const apiKey = req.config.api_key_env ? process.env[req.config.api_key_env] : undefined;
      c = new Anthropic({ ...(apiKey ? { apiKey } : {}), ...(req.config.base_url ? { baseURL: req.config.base_url } : {}) });
      this.clients.set(k, c);
    }
    return c;
  }

  async call(req: RawRequest): Promise<RawResponse> {
    const native = !this.noNative.has(req.schemaName);
    try {
      return await this.send(req, native);
    } catch (e) {
      if (native && e instanceof Anthropic.BadRequestError && /schema|output_config|format/i.test(e.message)) {
        this.noNative.add(req.schemaName);
        return this.send(req, false);
      }
      throw e;
    }
  }

  private async send(req: RawRequest, native: boolean): Promise<RawResponse> {
    const client = this.client(req);
    const outputConfig: Record<string, unknown> = {};
    if (req.config.effort) outputConfig.effort = req.config.effort;
    if (native) outputConfig.format = { type: 'json_schema', schema: strictify(req.jsonSchema) };
    const fallbackCapable = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(req.config.model);
    const params = {
      model: req.config.model,
      max_tokens: req.maxTokens,
      // The system prompt (shared rules + intent + agent prompt + output schema) is stable
      // across calls: cache it, so repeated calls read it at a fraction of the price.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: req.messages,
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      ...(fallbackCapable ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    const stream = fallbackCapable
      ? client.beta.messages.stream(params as unknown as Parameters<typeof client.beta.messages.stream>[0])
      : client.messages.stream(params as unknown as Parameters<typeof client.messages.stream>[0]);
    const msg = (await stream.finalMessage()) as Anthropic.Message & { stop_details?: { category?: string; explanation?: string } };
    if (msg.stop_reason === 'refusal') {
      throw new RefusalError(msg.stop_details?.category ?? null, msg.stop_details?.explanation ?? 'the model declined this request');
    }
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const u = msg.usage as Anthropic.Usage & { cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
    return {
      text,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      model: msg.model,
    };
  }
}

const DROP = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'format', 'maxItems', 'default', '$schema', 'propertyNames']);

/** Native structured outputs accept a JSON Schema subset; drop constraints Zod still enforces locally. */
export function strictify(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictify);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
    out[k] = strictify(v);
  }
  if (out.type === 'object' && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

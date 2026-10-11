import { z, type ZodType } from 'zod';
import { DEFAULT_MODELS, type Book, type ModelConfig, type ModelTier } from '@quillgon/core';
import type { Backend, Message, RawRequest, RawResponse, UsageRecord, WebSource } from './types.js';
import { BackendError, RefusalError, SchemaFailure } from './types.js';
import { stripInventedNulls } from './schema.js';

export interface CompleteOptions<T> {
  agent: string;
  tier: ModelTier;
  system: string;
  messages: Message[];
  schema: ZodType<T>;
  schemaName: string;
  maxTokens?: number;
  scene?: string;
  /** Research: let the model search the web, up to this many times. */
  web?: { maxSearches: number };
}

/** A research call's answer, with the pages its searches actually returned (null: the provider does not say). */
export interface WebResult<T> {
  data: T;
  sources: WebSource[] | null;
  searches: number;
}

/** USD per search when the book does not set price_search (the providers' list price, about a cent). */
const SEARCH_PRICE: Record<string, number> = { openai: 0.01, anthropic: 0.01 };

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

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/**
 * Worth retrying? Rate limits, overload, server errors and dropped connections are; a
 * refusal, a bad request, a missing key or an exhausted quota are not.
 */
export function isTransient(e: unknown): boolean {
  if (e instanceof RefusalError || e instanceof SchemaFailure) return false;
  if (e instanceof BackendError) return e.transient;
  const err = e as { status?: number; code?: string; name?: string; cause?: { code?: string } };
  if (typeof err?.status === 'number') return TRANSIENT_STATUS.has(err.status) || err.status >= 500;
  if (err?.name === 'APIConnectionError' || err?.name === 'APIConnectionTimeoutError') return true;
  const code = err?.code ?? err?.cause?.code;
  return !!code && TRANSIENT_CODES.has(code);
}

function retryAfterMs(e: unknown): number | undefined {
  if (e instanceof BackendError) return e.retryAfterMs;
  const h = (e as { headers?: unknown })?.headers;
  const raw = h && typeof (h as Headers).get === 'function' ? (h as Headers).get('retry-after') : (h as Record<string, string> | undefined)?.['retry-after'];
  const secs = raw ? Number(raw) : NaN;
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}

export interface AdapterOptions {
  /** Extra attempts after a transient failure (the provider SDKs already retry twice). */
  networkRetries?: number;
  /** First backoff delay; doubles each time, with jitter, capped at a minute. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The one adapter the agents use: complete(messages, schema, options) -> parsed object.
 * Validates with Zod; on failure re-prompts with the validation error (max 2 retries).
 * Retries transient backend failures with backoff. Logs model, tokens and cost for every
 * call, failed ones included, so the cost report counts what was actually spent.
 */
export class ModelAdapter {
  private retries: number;
  private backoff: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(
    private backends: Record<string, Backend>,
    private book: () => Book,
    private onUsage: (u: UsageRecord) => void = () => undefined,
    opts: AdapterOptions = {},
  ) {
    this.retries = opts.networkRetries ?? 2;
    this.backoff = opts.backoffMs ?? 2000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async call(backend: Backend, req: RawRequest): Promise<RawResponse> {
    for (let n = 0; ; n++) {
      try {
        return await backend.call(req);
      } catch (e) {
        if (n >= this.retries || !isTransient(e)) throw e;
        const base = Math.min(60_000, this.backoff * 4 ** n);
        await this.sleep(Math.min(120_000, retryAfterMs(e) ?? base * (0.75 + Math.random() * 0.5)));
      }
    }
  }

  configFor(tier: ModelTier): ModelConfig {
    return { ...DEFAULT_MODELS[tier], ...(this.book().models[tier] ?? {}) } as ModelConfig;
  }

  async complete<T>(opts: CompleteOptions<T>): Promise<T> {
    return (await this.completeWeb(opts)).data;
  }

  /** As complete(), and also report what web searches ran and which pages they returned. */
  async completeWeb<T>(opts: CompleteOptions<T>): Promise<WebResult<T>> {
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
    let attempt = 0;
    let searches = 0;
    let sources: Map<string, WebSource> | null = opts.web ? new Map() : null;
    try {
      for (attempt = 1; attempt <= 3; attempt++) {
        const res = await this.call(backend, { config, system, messages, jsonSchema, schemaName: opts.schemaName, maxTokens: opts.maxTokens ?? 32000, ...(opts.web ? { web: opts.web } : {}) });
        searches += res.searches ?? 0;
        if (res.sources === null) sources = null;
        else if (sources) for (const x of res.sources ?? []) sources.set(x.url, x);
        inTok += res.inputTokens;
        outTok += res.outputTokens;
        cacheW += res.cacheWriteTokens ?? 0;
        cacheR += res.cacheReadTokens ?? 0;
        model = res.model;
        lastText = res.text;
        let parsed: unknown;
        try {
          parsed = stripInventedNulls(extractJson(res.text), jsonSchema);
        } catch (e) {
          lastError = (e as Error).message;
          messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: `That was not valid JSON (${lastError}). Reply again with only the JSON object.` });
          continue;
        }
        const r = opts.schema.safeParse(parsed);
        if (r.success) {
          this.log(opts, config, model, inTok, outTok, attempt, true, cacheW, cacheR, undefined, searches);
          return { data: r.data, sources: sources ? [...sources.values()] : null, searches };
        }
        lastError = formatZodError(r.error);
        messages.push(
          { role: 'assistant', content: res.text },
          { role: 'user', content: `Your JSON did not validate:\n${lastError}\n\nReply again with the corrected JSON object only. Change nothing else.` },
        );
      }
    } catch (e) {
      // A backend failure part-way (after earlier attempts were billed) is still logged.
      this.log(opts, config, model, inTok, outTok, Math.max(attempt, 1), false, cacheW, cacheR, (e as Error).message, searches);
      throw e;
    }
    this.log(opts, config, model, inTok, outTok, 3, false, cacheW, cacheR, lastError, searches);
    throw new SchemaFailure(opts.agent, 3, lastError, lastText);
  }

  private log(opts: CompleteOptions<unknown>, config: ModelConfig, model: string, inTok: number, outTok: number, attempts: number, ok: boolean, cacheW = 0, cacheR = 0, error?: string, searches = 0) {
    const pin = config.price_in ?? 0;
    // Cache prices differ by model (reads are 0.025x to 0.1x input): configurable per tier,
    // with the common 1.25x write / 0.1x read as the fallback.
    const pcw = config.price_cache_write ?? pin * 1.25;
    const pcr = config.price_cache_read ?? pin * 0.1;
    // Subscription use has no per-token API charge; quota use is still logged.
    const perSearch = config.price_search ?? SEARCH_PRICE[config.provider] ?? 0;
    const cost = config.provider === 'codex' ? 0 : (inTok * pin + cacheW * pcw + cacheR * pcr + outTok * (config.price_out ?? 0)) / 1e6 + searches * perSearch;
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
      ...(searches ? { searches } : {}),
      attempts,
      ok,
      ...(error ? { error: error.slice(0, 500) } : {}),
    });
  }
}

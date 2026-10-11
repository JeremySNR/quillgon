import type { ModelConfig, ModelTier } from '@quillgon/core';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface RawRequest {
  config: ModelConfig;
  system: string;
  messages: Message[];
  /** JSON Schema of the expected output. Backends may enforce it natively. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  /** Let the model search the web (research only), up to this many searches. */
  web?: { maxSearches: number };
}

/** A page a web search actually returned. */
export interface WebSource {
  url: string;
  title: string;
}

export interface RawResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache tokens (priced differently: writes ~1.25×, reads ~0.1× input). */
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  model: string;
  /** With `web`: the pages the searches returned (null when the provider does not say), and how many searches ran. */
  sources?: WebSource[] | null;
  searches?: number;
}

/** One provider. Turns a request into raw text. */
export interface Backend {
  readonly provider: string;
  call(req: RawRequest): Promise<RawResponse>;
}

export interface UsageRecord {
  ts: string;
  agent: string;
  scene?: string;
  tier: ModelTier;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd: number;
  /** Web searches the call ran (research). */
  searches?: number;
  attempts: number;
  ok: boolean;
  /** Why the call failed, when ok is false. */
  error?: string;
}

export class RefusalError extends Error {
  constructor(public category: string | null, message: string) {
    super(message);
    this.name = 'RefusalError';
  }
}

export class SchemaFailure extends Error {
  constructor(public agent: string, public attempts: number, public lastError: string, public lastText: string) {
    super(`${agent}: output failed validation after ${attempts} attempts: ${lastError}`);
    this.name = 'SchemaFailure';
  }
}

/**
 * A backend failure. `transient` failures (rate limits, overload, a dropped stream) are
 * worth retrying; the adapter does so with backoff. `retryAfterMs` honours the provider.
 */
export class BackendError extends Error {
  constructor(message: string, public transient: boolean, public retryAfterMs?: number, public status?: number) {
    super(message);
    this.name = 'BackendError';
  }
}

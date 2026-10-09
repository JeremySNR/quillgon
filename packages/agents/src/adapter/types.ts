import type { ModelConfig, ModelTier } from '@novel/core';

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
}

export interface RawResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
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
  cost_usd: number;
  attempts: number;
  ok: boolean;
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

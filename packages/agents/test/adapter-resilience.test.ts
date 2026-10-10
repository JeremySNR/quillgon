import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Book } from '@quillgon/core';
import { BackendError, codexEnv, isTransient, ModelAdapter, OpenAICompatibleBackend, RefusalError, strictify, stripInventedNulls, type Backend, type RawResponse, type UsageRecord } from '../src/index.js';

const book = Book.parse({ title: 'T' });
const Out = z.object({ answer: z.string() });
const ok = (text = '{"answer":"yes"}'): RawResponse => ({ text, inputTokens: 1000, outputTokens: 200, model: 'm' });

/** A backend that plays a script: a response, or an error to throw. */
function scripted(steps: (RawResponse | Error)[]): Backend & { calls: number } {
  const b = {
    provider: 'openai',
    calls: 0,
    async call() {
      b.calls++;
      const s = steps.shift();
      if (!s) throw new Error('script exhausted');
      if (s instanceof Error) throw s;
      return s;
    },
  };
  return b;
}

function adapter(b: Backend, usage: UsageRecord[] = [], sleeps: number[] = [], b2: Book = book) {
  return new ModelAdapter({ openai: b, 'openai-compatible': b }, () => b2, (u) => usage.push(u), { sleep: async (ms) => void sleeps.push(ms), backoffMs: 1000 });
}
const ask = { agent: 'writer', tier: 'frontier' as const, system: 'S', messages: [], schema: Out, schemaName: 'writer' };

describe('model adapter resilience', () => {
  it('retries a transient failure with backoff, then succeeds', async () => {
    const usage: UsageRecord[] = [];
    const sleeps: number[] = [];
    const b = scripted([new BackendError('overloaded', true), ok()]);
    expect(await adapter(b, usage, sleeps).complete(ask)).toEqual({ answer: 'yes' });
    expect(b.calls).toBe(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(750);
    expect(usage).toEqual([expect.objectContaining({ ok: true, attempts: 1 })]);
  });

  it("honours the provider's retry-after", async () => {
    const sleeps: number[] = [];
    const rateLimited = Object.assign(new Error('429'), { status: 429, headers: new Headers({ 'retry-after': '7' }) });
    await adapter(scripted([rateLimited, ok()]), [], sleeps).complete(ask);
    expect(sleeps).toEqual([7000]);
  });

  it('gives up after the retry budget and logs the failure', async () => {
    const usage: UsageRecord[] = [];
    const b = scripted([new BackendError('503', true), new BackendError('503', true), new BackendError('503', true)]);
    await expect(adapter(b, usage).complete(ask)).rejects.toThrow('503');
    expect(b.calls).toBe(3);
    expect(usage).toEqual([expect.objectContaining({ ok: false, error: '503' })]);
  });

  it('logs the tokens already spent when a later attempt fails', async () => {
    const usage: UsageRecord[] = [];
    // Attempt 1 is billed but invalid; attempt 2 hits a hard error.
    const b = scripted([ok('not json'), Object.assign(new Error('Bad request'), { status: 400 })]);
    await expect(adapter(b, usage).complete(ask)).rejects.toThrow('Bad request');
    expect(b.calls).toBe(2);
    expect(usage).toEqual([expect.objectContaining({ ok: false, attempts: 2, input_tokens: 1000, output_tokens: 200, error: 'Bad request' })]);
    expect(usage[0].cost_usd).toBeGreaterThan(0);
  });

  it('never retries a refusal', async () => {
    const sleeps: number[] = [];
    const b = scripted([new RefusalError('cyber', 'declined'), ok()]);
    await expect(adapter(b, [], sleeps).complete(ask)).rejects.toBeInstanceOf(RefusalError);
    expect(b.calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('classifies errors', () => {
    expect(isTransient(Object.assign(new Error(), { status: 529 }))).toBe(true);
    expect(isTransient(Object.assign(new Error(), { status: 401 }))).toBe(false);
    expect(isTransient(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe(true);
    expect(isTransient(new Error('Set OPENAI_API_KEY'))).toBe(false);
  });

  it('prices cache tokens per tier when configured', async () => {
    const usage: UsageRecord[] = [];
    const priced = Book.parse({ title: 'T', models: { frontier: { provider: 'openai', model: 'm', price_in: 10, price_out: 50, price_cache_read: 0.25, price_cache_write: 12.5 } } });
    const b = scripted([{ ...ok(), inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }]);
    await adapter(b, usage, [], priced).complete(ask);
    expect(usage[0].cost_usd).toBeCloseTo(12.75);
  });
});

describe('structured output schemas', () => {
  const S = z.object({ a: z.string(), b: z.string().optional(), c: z.string().nullable(), d: z.number().default(3) });
  const json = z.toJSONSchema(S, { io: 'input' }) as Record<string, any>;

  it('OpenAI strict mode: every field required, optional ones nullable', () => {
    const s = strictify(json, 'nullable') as any;
    expect(s.required).toEqual(['a', 'b', 'c', 'd']);
    expect(s.properties.b).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(s.properties.d.anyOf).toContainEqual({ type: 'null' });
    expect(s.properties.c).toEqual(json.properties.c); // already nullable
    expect(s.additionalProperties).toBe(false);
  });

  it('Anthropic: optional fields stay optional', () => {
    const s = strictify(json, 'optional') as any;
    expect(s.required).toEqual(['a', 'c']);
    expect(s.properties.b).toEqual({ type: 'string' });
    expect(s.additionalProperties).toBe(false);
  });

  it('nulls that only mean "absent" are dropped before validation, so defaults apply', () => {
    const parsed = stripInventedNulls({ a: 'x', b: null, c: null, d: null }, json);
    expect(parsed).toEqual({ a: 'x', c: null });
    expect(S.parse(parsed)).toEqual({ a: 'x', c: null, d: 3 });
  });

  it('end to end through the adapter', async () => {
    const b = scripted([ok('{"a":"x","b":null,"c":null,"d":null}')]);
    const r = await adapter(b).complete({ ...ask, schema: S, schemaName: 's' });
    expect(r).toEqual({ a: 'x', c: null, d: 3 });
  });
});

describe('backends', () => {
  it('the Codex child sees only what it needs from the environment', () => {
    const env = codexEnv({ PATH: '/bin', HOME: '/h', HTTPS_PROXY: 'http://p', LC_ALL: 'C', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'x', CODEX_API_KEY: 'x', AWS_SECRET_ACCESS_KEY: 'x', GITHUB_TOKEN: 'x' });
    expect(Object.keys(env).sort()).toEqual(['HOME', 'HTTPS_PROXY', 'LC_ALL', 'PATH']);
  });

  it('the compatible backend marks overload as transient and passes retry-after on', async () => {
    const srv = http.createServer((_req, res) => res.writeHead(503, { 'retry-after': '2' }).end('busy'));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      const err = await new OpenAICompatibleBackend()
        .call({ config: { provider: 'openai-compatible', model: 'local', base_url: `http://127.0.0.1:${port}/v1` }, system: 'S', messages: [], jsonSchema: {}, schemaName: 's', maxTokens: 10 })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BackendError);
      expect(err).toMatchObject({ transient: true, retryAfterMs: 2000, status: 503 });
    } finally {
      srv.close();
    }
  });

  it('the compatible backend treats a refused connection as transient', async () => {
    const err = await new OpenAICompatibleBackend()
      .call({ config: { provider: 'openai-compatible', model: 'local', base_url: 'http://127.0.0.1:1/v1' }, system: 'S', messages: [], jsonSchema: {}, schemaName: 's', maxTokens: 10 })
      .catch((e) => e);
    expect(err).toMatchObject({ transient: true });
  });
});

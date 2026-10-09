import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Book } from '@quillgon/core';
import { extractJson, ModelAdapter, RecordReplayBackend, SchemaFailure, strictify, type Backend, type RawRequest, type UsageRecord } from '../src/index.js';

const book = Book.parse({ title: 'T' });

function backend(replies: string[]): Backend & { requests: RawRequest[] } {
  const requests: RawRequest[] = [];
  return {
    provider: 'anthropic',
    requests,
    async call(req) {
      requests.push(structuredClone(req));
      return { text: replies.shift() ?? '', inputTokens: 1000, outputTokens: 200, model: req.config.model };
    },
  };
}

const Out = z.object({ answer: z.string(), score: z.number().int().min(1).max(5) });

describe('phase 3: model adapter', () => {
  it('extracts JSON from fences and preamble', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here it is: {"a":{"b":"}"}} trailing')).toEqual({ a: { b: '}' } });
  });

  it('validates output and logs cost', async () => {
    const usage: UsageRecord[] = [];
    const b = backend(['{"answer":"yes","score":4}']);
    const a = new ModelAdapter({ anthropic: b }, () => book, (u) => usage.push(u));
    const r = await a.complete({ agent: 'reader.read', tier: 'frontier', system: 'S', messages: [{ role: 'user', content: 'Q' }], schema: Out, schemaName: 'reader.read' });
    expect(r).toEqual({ answer: 'yes', score: 4 });
    expect(usage[0]).toMatchObject({ agent: 'reader.read', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 200, attempts: 1, ok: true });
    expect(usage[0].cost_usd).toBeCloseTo((1000 * 4 + 200 * 20) / 1e6);
    expect(b.requests[0].system).toContain('JSON Schema');
  });

  it('re-prompts with the validation error, at most twice', async () => {
    const b = backend(['not json', '{"answer":"x","score":9}', '{"answer":"x","score":3}']);
    const a = new ModelAdapter({ anthropic: b }, () => book);
    const r = await a.complete({ agent: 'x', tier: 'mid', system: 'S', messages: [{ role: 'user', content: 'Q' }], schema: Out, schemaName: 'x' });
    expect(r.score).toBe(3);
    expect(b.requests).toHaveLength(3);
    const last = b.requests[2].messages.at(-1)!.content;
    expect(last).toMatch(/score: Too big/);
  });

  it('fails after three bad attempts', async () => {
    const b = backend(['{}', '{}', '{}']);
    const usage: UsageRecord[] = [];
    const a = new ModelAdapter({ anthropic: b }, () => book, (u) => usage.push(u));
    await expect(a.complete({ agent: 'x', tier: 'mid', system: 'S', messages: [], schema: Out, schemaName: 'x' })).rejects.toBeInstanceOf(SchemaFailure);
    expect(usage[0]).toMatchObject({ ok: false, attempts: 3 });
  });

  it('routes tiers to the models configured in book.yaml', async () => {
    const custom = Book.parse({ title: 'T', models: { mid: { provider: 'openai-compatible', model: 'local-llm', price_in: 0, price_out: 0 } } });
    const b = backend(['{"answer":"a","score":1}']);
    const a = new ModelAdapter({ 'openai-compatible': b }, () => custom);
    await a.complete({ agent: 'x', tier: 'mid', system: 'S', messages: [], schema: Out, schemaName: 'x' });
    expect(b.requests[0].config.model).toBe('local-llm');
  });

  it('strictify makes objects closed and drops unsupported constraints', () => {
    const s = strictify(z.toJSONSchema(Out)) as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['answer', 'score']);
    expect(s.properties.score.maximum).toBeUndefined();
  });

  it('records and replays responses', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    const live = backend(['{"answer":"recorded","score":2}']);
    const rec = new ModelAdapter({ anthropic: new RecordReplayBackend(dir, 'record', live) }, () => book);
    const opts = { agent: 'x', tier: 'mid' as const, system: 'S', messages: [{ role: 'user' as const, content: 'Q' }], schema: Out, schemaName: 'x.y' };
    await rec.complete(opts);
    const rep = new ModelAdapter({ anthropic: new RecordReplayBackend(dir, 'replay') }, () => book);
    expect(await rep.complete(opts)).toEqual({ answer: 'recorded', score: 2 });
    await expect(rep.complete({ ...opts, messages: [{ role: 'user', content: 'other' }] })).rejects.toThrow(/no recording/);
  });
});

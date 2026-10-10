import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Book, CODEX_MODELS } from '@quillgon/core';
import { CodexBackend, ModelAdapter, OpenAIBackend, RefusalError, type RawRequest, type UsageRecord } from '../src/index.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), openai: vi.fn(), codex: vi.fn(), startThread: vi.fn(), run: vi.fn() }));
vi.mock('openai', () => ({ default: class { responses = { create: mocks.create }; constructor(options: unknown) { mocks.openai(options); } } }));
vi.mock('@openai/codex-sdk', () => ({ Codex: class { startThread = mocks.startThread; constructor(options: unknown) { mocks.codex(options); } } }));

const request: RawRequest = { config: { provider: 'openai', model: 'gpt-6.1-sol', effort: 'high' }, system: 'Return JSON', messages: [{ role: 'user', content: 'Story context' }], schemaName: 'writer.draft', jsonSchema: { type: 'object', properties: { prose: { type: 'string' } } }, maxTokens: 32000 };
const completed = { status: 'completed', model: 'gpt-6.1-sol', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"prose":"A story"}' }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 50 } };
function respond(response = completed, type = 'response.completed') {
  mocks.create.mockImplementation(async function* () { yield { type, response }; });
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('OpenAI Responses', () => {
  it('uses native structured output, effort, no storage, and separates cached tokens', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    respond();
    const result = await new OpenAIBackend().call(request);
    expect(mocks.openai).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key' }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ instructions: 'Return JSON', input: request.messages, max_output_tokens: 32000, reasoning: { effort: 'high' }, store: false, stream: true, text: { format: expect.objectContaining({ name: 'writer_draft', strict: true, schema: expect.objectContaining({ additionalProperties: false, required: ['prose'] }) }) } }));
    expect(result).toMatchObject({ text: '{"prose":"A story"}', inputTokens: 800, cacheReadTokens: 200, outputTokens: 50 });
  });
  it('fails before requesting when no key is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(new OpenAIBackend().call(request)).rejects.toThrow('Set OPENAI_API_KEY');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps arbitrary-key records in prompt-validated JSON mode', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key'); respond();
    await new OpenAIBackend().call({ ...request, jsonSchema: z.toJSONSchema(z.object({ feels: z.record(z.string(), z.string()) })) });
    expect(mocks.create.mock.calls[0][0].text.format).toEqual({ type: 'json_object' });
  });
  it('rejects incomplete output instead of presenting truncated prose', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    respond({ ...completed, status: 'incomplete' }, 'response.incomplete');
    await expect(new OpenAIBackend().call(request)).rejects.toThrow('incomplete');
  });
  it('propagates a refusal without schema retries', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    mocks.create.mockImplementation(async function* () { yield { type: 'response.completed', response: { ...completed, output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Declined' }] }] } }; });
    await expect(new OpenAIBackend().call(request)).rejects.toBeInstanceOf(RefusalError);
  });
});

describe('Codex subscription', () => {
  it('uses ChatGPT auth, removes API credentials, and starts each call in an empty read-only directory', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'must-not-be-used'); vi.stubEnv('CODEX_API_KEY', 'must-not-be-used');
    mocks.startThread.mockImplementation((options) => {
      expect(fs.readdirSync(options.workingDirectory)).toEqual([]);
      return { run: mocks.run };
    });
    mocks.run.mockResolvedValue({ finalResponse: '{"prose":"Codex story"}', usage: { input_tokens: 1000, cached_input_tokens: 300, output_tokens: 100 } });
    const result = await new CodexBackend().call({ ...request, config: CODEX_MODELS.frontier });
    const options = mocks.codex.mock.calls[0][0];
    expect(options.env.OPENAI_API_KEY).toBeUndefined(); expect(options.env.CODEX_API_KEY).toBeUndefined();
    expect(options.config).toMatchObject({ forced_login_method: 'chatgpt', model_provider: 'openai', features: { shell_tool: false, apps: false } });
    expect(options.configOverrides).toEqual(['mcp_servers={}']);
    const thread = mocks.startThread.mock.calls[0][0];
    expect(thread).toMatchObject({ sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' });
    expect(thread.model).toBeUndefined();
    expect(fs.existsSync(thread.workingDirectory)).toBe(false);
    expect(result).toMatchObject({ inputTokens: 700, cacheReadTokens: 300, outputTokens: 100, model: 'codex-account-default' });
  });
  it('reports auth/limit failures and cleans up without falling back to the API', async () => {
    mocks.startThread.mockReturnValue({ run: mocks.run }); mocks.run.mockRejectedValue(new Error('usage limit reached'));
    await expect(new CodexBackend().call(request)).rejects.toThrow('will not fall back to API billing');
    expect(fs.existsSync(mocks.startThread.mock.calls[0][0].workingDirectory)).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('logs subscription tokens without inventing an API charge even with stale prices', async () => {
    const usage: UsageRecord[] = [];
    const book = Book.parse({ title: 'T', models: { frontier: { provider: 'codex', model: '', price_in: 99, price_out: 99 } } });
    const adapter = new ModelAdapter({ codex: { provider: 'codex', call: async () => ({ text: '{"prose":"Story"}', inputTokens: 1000, outputTokens: 200, model: 'codex-account-default' }) } }, () => book, (u) => usage.push(u));
    await adapter.complete({ agent: 'writer', tier: 'frontier', system: 'S', messages: [], schema: z.object({ prose: z.string() }), schemaName: 'writer' });
    expect(usage[0]).toMatchObject({ provider: 'codex', cost_usd: 0, input_tokens: 1000, output_tokens: 200 });
  });
});

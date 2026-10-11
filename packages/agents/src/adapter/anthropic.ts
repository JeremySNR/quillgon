import Anthropic from '@anthropic-ai/sdk';
import type { Backend, RawRequest, RawResponse, WebSource } from './types.js';
import { RefusalError } from './types.js';
import { strictify } from './schema.js';

export { strictify };

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
      // Only a rejection of the output schema itself downgrades this schema to prompt-only
      // JSON; any other 400 (a too-long prompt, say) is a real error.
      if (native && e instanceof Anthropic.BadRequestError && /output_config|json_schema|\bschema\b/i.test(e.message)) {
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
    // Research asks for JSON in the prompt rather than natively: search results arrive as cited
    // text blocks, and the JSON is pulled out of the final text either way.
    if (native && !req.web) outputConfig.format = { type: 'json_schema', schema: strictify(req.jsonSchema, 'optional') };
    const fallbackCapable = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(req.config.model);
    // The dynamic-filtering search needs a current model; older ones take the basic tool.
    const searchTool = /^claude-(opus-(5|4-[678])|fable-5|sonnet-(5|4-6))/.test(req.config.model) ? 'web_search_20260209' : 'web_search_20250305';
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0 };
    const sources = new Map<string, WebSource>();
    let text = '';
    let model = req.config.model;
    // A long search can pause the server's loop; sending the turn back resumes it.
    for (let turn = 0; turn < 6; turn++) {
      const params = {
        model: req.config.model,
        max_tokens: req.maxTokens,
        // The system prompt (shared rules + intent + agent prompt + output schema) is stable
        // across calls: cache it, so repeated calls read it at a fraction of the price.
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages,
        ...(req.web ? { tools: [{ type: searchTool, name: 'web_search', max_uses: req.web.maxSearches }] } : {}),
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
      const u = msg.usage as Anthropic.Usage & { cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
      usage.input += u.input_tokens;
      usage.output += u.output_tokens;
      usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
      usage.cacheRead += u.cache_read_input_tokens ?? 0;
      usage.searches += u.server_tool_use?.web_search_requests ?? 0;
      model = msg.model;
      // The answer is in the last turn; text before a pause is commentary between searches.
      text = '';
      for (const b of msg.content) {
        if (b.type === 'text') text += b.text;
        // A failed search comes back as an error object, not a list.
        else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) sources.set(r.url, { url: r.url, title: r.title });
      }
      if (msg.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: msg.content as Anthropic.ContentBlockParam[] });
    }
    return {
      text,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheWriteTokens: usage.cacheWrite,
      cacheReadTokens: usage.cacheRead,
      model,
      ...(req.web ? { sources: [...sources.values()], searches: usage.searches } : {}),
    };
  }
}

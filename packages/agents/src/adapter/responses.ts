import OpenAI from 'openai';
import type { Backend, RawRequest, RawResponse, WebSource } from './types.js';
import { BackendError, RefusalError } from './types.js';
import { nativeSchema } from './schema.js';

/** The pages the response's searches returned, and the pages its text cites. */
function webSources(final: OpenAI.Responses.Response): { sources: WebSource[]; searches: number } {
  const seen = new Map<string, WebSource>();
  let searches = 0;
  for (const item of final.output) {
    if (item.type === 'web_search_call') {
      if (item.action?.type === 'search') {
        searches++;
        for (const s of item.action.sources ?? []) if (!seen.has(s.url)) seen.set(s.url, { url: s.url, title: '' });
      } else if (item.action?.type === 'open_page' && item.action.url && !seen.has(item.action.url)) seen.set(item.action.url, { url: item.action.url, title: '' });
    }
    if (item.type === 'message')
      for (const c of item.content)
        if (c.type === 'output_text')
          for (const a of c.annotations) if (a.type === 'url_citation') seen.set(a.url, { url: a.url, title: a.title || seen.get(a.url)?.title || '' });
  }
  return { sources: [...seen.values()], searches };
}

/** OpenAI's native Responses API; the compatible Chat Completions adapter is separate. */
export class OpenAIBackend implements Backend {
  readonly provider = 'openai';
  /** One client per key and endpoint, so connections are reused across calls. */
  private clients = new Map<string, OpenAI>();

  async call(req: RawRequest): Promise<RawResponse> {
    const variable = req.config.api_key_env || 'OPENAI_API_KEY';
    const apiKey = process.env[variable];
    if (!apiKey) throw new Error(`Set ${variable} in the environment that launches Quillgon, then restart. Or select Codex subscription in Settings → Models.`);
    const baseURL = req.config.base_url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const key = `${baseURL}|${variable}|${apiKey.length}:${apiKey.slice(-6)}`;
    let client = this.clients.get(key);
    if (!client) this.clients.set(key, (client = new OpenAI({ apiKey, baseURL })));
    const schema = nativeSchema(req.jsonSchema);
    const response = await client.responses.create({
      model: req.config.model,
      instructions: req.system,
      input: req.messages,
      max_output_tokens: req.maxTokens,
      ...(req.config.effort ? { reasoning: { effort: req.config.effort } } : {}),
      ...(req.web ? { tools: [{ type: 'web_search' as const }], include: ['web_search_call.action.sources' as const], max_tool_calls: req.web.maxSearches } : {}),
      store: false,
      text: { format: schema ? { type: 'json_schema', name: req.schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), strict: true, schema } : { type: 'json_object' } },
      stream: true,
    });
    let final: OpenAI.Responses.Response | undefined;
    for await (const event of response) {
      if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') final = event.response;
      // A failure mid-stream is not retried by the SDK; the adapter retries it.
      if (event.type === 'error') throw new BackendError(`OpenAI: ${event.message}`, true);
    }
    if (!final) throw new BackendError('OpenAI response ended before completion.', true);
    for (const item of final.output) {
      if (item.type !== 'message') continue;
      for (const content of item.content) if (content.type === 'refusal') throw new RefusalError(null, content.refusal);
    }
    if (final.status === 'incomplete') {
      // Usually the output limit: retrying the same request would fail the same way.
      const reason = final.incomplete_details?.reason ?? 'unknown reason';
      throw new BackendError(`OpenAI response incomplete (${reason})${reason === 'max_output_tokens' ? ': the scene needs more output tokens than allowed; lower the effort for this tier or shorten the scene' : ''}`, false);
    }
    if (final.status !== 'completed') throw new BackendError(`OpenAI response ${final.status}: ${final.error?.message ?? 'try again'}`, final.status === 'failed');
    const cached = final.usage?.input_tokens_details.cached_tokens ?? 0;
    const web = req.web ? webSources(final) : {};
    return {
      ...web,
      text: final.output.filter((item) => item.type === 'message').flatMap((item) => item.content).filter((content) => content.type === 'output_text').map((content) => content.text).join(''),
      inputTokens: (final.usage?.input_tokens ?? 0) - cached,
      cacheReadTokens: cached,
      outputTokens: final.usage?.output_tokens ?? 0,
      model: final.model,
    };
  }
}

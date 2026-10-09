import type { Backend, RawRequest, RawResponse } from './types.js';

/**
 * Any OpenAI-compatible chat completions endpoint (another vendor for the simulated reader,
 * a local model server, etc.). Configure base_url and api_key_env in book.yaml.
 */
export class OpenAICompatibleBackend implements Backend {
  readonly provider = 'openai-compatible';

  async call(req: RawRequest): Promise<RawResponse> {
    const base = (req.config.base_url ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const key = process.env[req.config.api_key_env ?? 'OPENAI_API_KEY'];
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model: req.config.model,
        max_tokens: req.maxTokens,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`${base}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      model?: string;
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: body.choices[0]?.message?.content ?? '',
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      model: body.model ?? req.config.model,
    };
  }
}

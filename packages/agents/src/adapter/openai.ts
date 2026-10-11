import type { Backend, RawRequest, RawResponse } from './types.js';
import { BackendError } from './types.js';

/** Local models can take minutes for a long scene; this bounds a hung request. */
const TIMEOUT_MS = Number(process.env.QUILLGON_COMPAT_TIMEOUT_MS) || 15 * 60 * 1000;

/**
 * Any OpenAI-compatible chat completions endpoint (another vendor for the simulated reader,
 * a local model server, etc.). Configure base_url and api_key_env in book.yaml.
 */
export class OpenAICompatibleBackend implements Backend {
  readonly provider = 'openai-compatible';

  async call(req: RawRequest): Promise<RawResponse> {
    if (req.web) throw new BackendError('This provider cannot search the web. For research, set the research tier to OpenAI, Anthropic or Codex in Settings → Models.', false);
    const base = (req.config.base_url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const key = process.env[req.config.api_key_env || 'OPENAI_API_KEY'];
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model: req.config.model,
          max_tokens: req.maxTokens,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
          response_format: { type: 'json_object' },
        }),
      });
    } catch (e) {
      // Connection refused or reset (a local server restarting) is worth a retry; a timeout is not.
      const timedOut = (e as Error).name === 'TimeoutError';
      throw new BackendError(`${base}: ${timedOut ? `no response after ${Math.round(TIMEOUT_MS / 60000)} minutes` : (e as Error).message}`, !timedOut);
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new BackendError(`${base}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, res.status === 408 || res.status === 429 || res.status >= 500, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined, res.status);
    }
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

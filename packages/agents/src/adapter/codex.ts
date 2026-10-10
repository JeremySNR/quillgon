import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Codex } from '@openai/codex-sdk';
import type { Backend, RawRequest, RawResponse } from './types.js';
import { nativeSchema } from './schema.js';

/** Runs locally with the user's saved ChatGPT login, never with Quillgon's API key. */
export class CodexBackend implements Backend {
  readonly provider = 'codex';

  async call(req: RawRequest): Promise<RawResponse> {
    const workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'quillgon-codex-'));
    try {
      const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !/^(OPENAI_API_KEY|OPENAI_BASE_URL|CODEX_API_KEY)$/i.test(entry[0])));
      const codex = new Codex({
        env,
        config: { forced_login_method: 'chatgpt', model_provider: 'openai', features: { shell_tool: false, apps: false } },
        configOverrides: ['mcp_servers={}'],
      });
      const thread = codex.startThread({
        ...(req.config.model ? { model: req.config.model } : {}),
        modelReasoningEffort: req.config.effort,
        workingDirectory,
        skipGitRepoCheck: true,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
      });
      const result = await thread.run(
        `${req.system}\n\nUse only the supplied story context. Return the requested JSON; do not use tools or inspect files.\n\nConversation:\n${JSON.stringify(req.messages)}`,
        { outputSchema: nativeSchema(req.jsonSchema), signal: AbortSignal.timeout(15 * 60 * 1000) },
      );
      const cached = result.usage?.cached_input_tokens ?? 0;
      return { text: result.finalResponse, inputTokens: (result.usage?.input_tokens ?? 0) - cached, cacheReadTokens: cached, outputTokens: result.usage?.output_tokens ?? 0, model: req.config.model || 'codex-account-default' };
    } catch (error) {
      throw new Error(`Codex subscription: ${(error as Error).message}. Run codex login and sign in with ChatGPT on this computer. Your plan's model access and usage limits apply; Quillgon will not fall back to API billing.`);
    } finally {
      await fs.rm(workingDirectory, { recursive: true, force: true });
    }
  }
}

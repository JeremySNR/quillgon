import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Codex } from '@openai/codex-sdk';
import type { Backend, RawRequest, RawResponse } from './types.js';
import { nativeSchema } from './schema.js';
import { BackendError } from './types.js';

/**
 * What the Codex child process may see: enough to find its home, its saved ChatGPT login,
 * temp space, locale and the network (proxies, CA certificates). Nothing else: no API keys,
 * no cloud or GitHub credentials, whatever else is in the environment that launched Quillgon.
 */
const CODEX_ENV = /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|USER|USERNAME|LOGNAME|SHELL|LANG|LANGUAGE|TERM|TZ|LC_[A-Z]+|XDG_[A-Z_]+|CODEX_HOME|(HTTPS?|ALL|NO)_PROXY|SSL_CERT_(FILE|DIR)|NODE_EXTRA_CA_CERTS)$/i;

export function codexEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && CODEX_ENV.test(entry[0])));
}

/** Runs locally with the user's saved ChatGPT login, never with Quillgon's API key. */
export class CodexBackend implements Backend {
  readonly provider = 'codex';

  async call(req: RawRequest): Promise<RawResponse> {
    const workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'quillgon-codex-'));
    try {
      const env = codexEnv();
      const codex = new Codex({
        // An installed desktop app does not ship the Codex binary: point at the user's own
        // (`which codex`) with QUILLGON_CODEX_PATH.
        ...(process.env.QUILLGON_CODEX_PATH ? { codexPathOverride: process.env.QUILLGON_CODEX_PATH } : {}),
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
      const message = (error as Error).message;
      if ((error as Error).name === 'TimeoutError' || /aborted|timed? ?out/i.test(message)) {
        throw new BackendError(`Codex subscription: no answer after 15 minutes (${message}). Quillgon will not fall back to API billing.`, false);
      }
      const auth = /log ?in|auth|unauthori[sz]ed|401|403|token|credential/i.test(message);
      throw new BackendError(
        `Codex subscription: ${message}.${auth ? ' Run codex login and sign in with ChatGPT on this computer.' : ''} Your plan's model access and usage limits apply; Quillgon will not fall back to API billing.`,
        false,
      );
    } finally {
      await fs.rm(workingDirectory, { recursive: true, force: true });
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Backend, RawRequest, RawResponse } from './types.js';

/** Stable key for a request: model-independent so recordings survive model swaps. */
export function requestKey(req: RawRequest): string {
  return createHash('sha256')
    .update(JSON.stringify({ system: req.system, messages: req.messages, schema: req.schemaName }))
    .digest('hex')
    .slice(0, 20);
}

/**
 * Record/replay for tests. In 'record' mode, calls the real backend and saves each
 * response; in 'replay' mode, answers only from recordings and fails loudly otherwise.
 */
export class RecordReplayBackend implements Backend {
  readonly provider: string;
  constructor(
    private dir: string,
    private mode: 'record' | 'replay',
    private inner?: Backend,
  ) {
    this.provider = inner?.provider ?? 'replay';
  }

  async call(req: RawRequest): Promise<RawResponse> {
    const file = path.join(this.dir, req.schemaName, `${requestKey(req)}.json`);
    if (this.mode === 'replay') {
      if (!fs.existsSync(file)) throw new Error(`no recording for ${req.schemaName} at ${file}`);
      return JSON.parse(fs.readFileSync(file, 'utf8')).response as RawResponse;
    }
    if (!this.inner) throw new Error('record mode needs a live backend');
    const response = await this.inner.call(req);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ request: { schema: req.schemaName, model: req.config.model }, response }, null, 2));
    return response;
  }
}

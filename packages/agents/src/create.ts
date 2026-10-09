import path from 'node:path';
import type { AgentSuite, GraphStore } from '@novel/core';
import { ModelAdapter } from './adapter/structured.js';
import { AnthropicBackend } from './adapter/anthropic.js';
import { OpenAICompatibleBackend } from './adapter/openai.js';
import { RecordReplayBackend } from './adapter/record.js';
import type { Backend, UsageRecord } from './adapter/types.js';
import { ModelSuite } from './suite.js';
import { OfflineSuite } from './offline.js';

export interface CreateOptions {
  /** Record every model response to this directory (for building test fixtures). */
  record?: string;
  /** Answer only from recordings in this directory. */
  replay?: string;
  onUsage?: (u: UsageRecord) => void;
}

export function suiteMode(store: GraphStore): 'offline' | 'live' {
  if (process.env.NOVEL_OFFLINE === '1') return 'offline';
  return store.book.models.frontier?.provider === 'offline' ? 'offline' : 'live';
}

/**
 * Build the agent suite for a project from book.yaml. Model tiers map to concrete models
 * there, so swapping providers is config. Every call's cost goes to reports/costs.jsonl.
 */
export function createSuite(store: GraphStore, opts: CreateOptions = {}): AgentSuite {
  if (!opts.replay && suiteMode(store) === 'offline') return new OfflineSuite();
  const wrap = (b: Backend): Backend => {
    if (opts.replay) return new RecordReplayBackend(path.resolve(opts.replay), 'replay');
    if (opts.record) return new RecordReplayBackend(path.resolve(opts.record), 'record', b);
    return b;
  };
  const backends: Record<string, Backend> = {
    anthropic: wrap(new AnthropicBackend()),
    'openai-compatible': wrap(new OpenAICompatibleBackend()),
  };
  const adapter = new ModelAdapter(backends, () => store.book, (u) => {
    store.appendReport('costs.jsonl', JSON.stringify(u));
    opts.onUsage?.(u);
  });
  return new ModelSuite(adapter, { projectDir: store.dir, book: () => store.book, intent: () => store.project.intent });
}

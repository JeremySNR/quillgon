import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  checkCleanup,
  cleanDictation,
  dictionaryFor,
  joinToCursor,
  recognitionPrompt,
  wavSeconds,
  type AgentSuite,
  type CleanupLevel,
  type Project,
} from '@quillgon/core';

/**
 * Speech to text for dictation and recorded memories. The UI records 16 kHz mono WAV and posts
 * it base64-encoded inside JSON (the API only accepts JSON bodies); a segment is at most about a
 * minute, so long recordings arrive as several requests.
 */

export const DEFAULT_OPENAI_TRANSCRIBE = 'gpt-4o-mini-transcribe';
/** A long single segment; the UI cuts at pauses well before this. */
const MAX_SECONDS = 180;

export type TranscribeProvider = 'openai' | 'local' | 'offline';

export interface VoiceStatus {
  ready: boolean;
  provider: TranscribeProvider | null;
  model: string;
  /** Leaves the computer? Shown next to the record button. */
  local: boolean;
  reason?: string;
}

const isOffline = (p: Project) => process.env.QUILLGON_OFFLINE === '1' || p.book.models.frontier?.provider === 'offline';
const openaiKeyEnv = (p: Project) => (p.book.models.frontier?.provider === 'openai' && p.book.models.frontier.api_key_env) || 'OPENAI_API_KEY';
const whisperCmd = () => process.env.QUILLGON_WHISPER_CMD?.trim() || '';
const whisperModel = () => process.env.QUILLGON_WHISPER_MODEL?.trim() || '';

/** Which recogniser this book would use, and why not when none is available. */
export function voiceStatus(p: Project): VoiceStatus {
  const v = p.book.voice;
  const local = (): VoiceStatus =>
    whisperCmd() && whisperModel()
      ? { ready: true, provider: 'local', model: path.basename(whisperModel()), local: true }
      : { ready: false, provider: 'local', model: '', local: true, reason: 'Set QUILLGON_WHISPER_CMD (the whisper.cpp whisper-cli binary) and QUILLGON_WHISPER_MODEL (a ggml model file) in the environment that launches Quillgon.' };
  const openai = (): VoiceStatus =>
    process.env[openaiKeyEnv(p)]
      ? { ready: true, provider: 'openai', model: v.model || DEFAULT_OPENAI_TRANSCRIBE, local: false }
      : { ready: false, provider: 'openai', model: v.model || DEFAULT_OPENAI_TRANSCRIBE, local: false, reason: `Set ${openaiKeyEnv(p)} in the environment that launches Quillgon, or set up a local whisper.cpp.` };
  if (v.provider === 'offline' || (v.provider === 'auto' && isOffline(p) && !whisperCmd())) return { ready: true, provider: 'offline', model: 'placeholder', local: true };
  if (v.provider === 'local') return local();
  if (v.provider === 'openai') return openai();
  // auto: on this computer when possible, then the cloud.
  if (whisperCmd() && whisperModel()) return local();
  const o = openai();
  return o.ready ? o : { ...o, reason: 'No speech recogniser is set up. Add an OpenAI API key, or point Quillgon at a local whisper.cpp (Settings → Voice explains how).' };
}

export const DictateRequest = z.object({
  /** Base64 16 kHz mono PCM WAV. */
  audio: z.string().min(1),
  before: z.string().max(4000).default(''),
  after: z.string().max(1000).default(''),
  scene: z.string().nullable().default(null),
  level: z.enum(['book', 'verbatim', 'light', 'polished']).default('book'),
  /** What the offline recogniser "hears" (tests and demos only). */
  offline_text: z.string().max(4000).optional(),
});
export type DictateRequest = z.infer<typeof DictateRequest>;

export interface DictateResult {
  /** What the recogniser heard, untouched. */
  raw: string;
  /** What goes in at the cursor. */
  text: string;
  level: CleanupLevel;
  provider: TranscribeProvider;
  seconds: number;
  /** Set when the tidy-up was refused and the plain clean-up used instead. */
  flags: string[];
}

export function decodeWav(audio: string): { wav: Buffer; seconds: number } {
  const wav = Buffer.from(audio, 'base64');
  const seconds = wavSeconds(wav);
  if (seconds === null) throw new Error('audio must be a PCM WAV file');
  if (seconds > MAX_SECONDS) throw new Error(`recording segment too long (${Math.round(seconds)} s); the limit is ${MAX_SECONDS} s`);
  return { wav, seconds };
}

/** Speech to text, raw. */
export async function transcribe(p: Project, wav: Buffer, opts: { prompt?: string; offlineText?: string } = {}, request: typeof fetch = fetch): Promise<{ text: string; provider: TranscribeProvider }> {
  const status = voiceStatus(p);
  if (!status.ready || !status.provider) throw new Error(status.reason ?? 'No speech recogniser is set up.');
  if (status.provider === 'offline')
    return { text: opts.offlineText ?? process.env.QUILLGON_OFFLINE_TRANSCRIPT ?? 'Um, this is what an offline transcript looks like. Connect a speech model in Settings, Voice.', provider: 'offline' };
  if (status.provider === 'local') return { text: await whisperCpp(wav, p.book.voice.language, opts.prompt ?? ''), provider: 'local' };
  const config = p.book.models.frontier;
  const base = ((config?.provider === 'openai' ? config.base_url : undefined) || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', status.model);
  form.append('response_format', 'json');
  if (opts.prompt) form.append('prompt', opts.prompt);
  if (p.book.voice.language) form.append('language', p.book.voice.language);
  const res = await request(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env[openaiKeyEnv(p)]}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    // Upstream bodies can echo request details; keep the message to the status.
    throw new Error(`Transcription failed (HTTP ${res.status}). ${res.status === 401 ? 'Check your API key.' : res.status === 429 ? 'Check your API quota or try again shortly.' : 'Check the speech model in Settings → Voice.'}`);
  }
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? '').trim(), provider: 'openai' };
}

/** whisper.cpp's whisper-cli on a temporary file, never leaving the computer. */
function whisperCpp(wav: Buffer, language: string, prompt: string): Promise<string> {
  const file = path.join(os.tmpdir(), `quillgon-${randomUUID()}.wav`);
  fs.writeFileSync(file, wav, { mode: 0o600 });
  const args = ['-m', whisperModel(), '-f', file, '-nt', '-np', '-l', language || 'auto', ...(prompt ? ['--prompt', prompt] : [])];
  return new Promise<string>((resolve, reject) => {
    execFile(whisperCmd(), args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      fs.rmSync(file, { force: true });
      if (err) return reject(new Error(`whisper.cpp failed: ${(stderr || err.message).trim().split('\n').slice(-1)[0]}`));
      resolve(stdout.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim());
    });
  });
}

/**
 * Hear, then tidy. The scribe's clean-up is used only when it passes the guardrails (no new
 * names, most of the speaker's words kept); otherwise the plain clean-up goes in and the author
 * is told why.
 */
export async function dictate(p: Project, agents: AgentSuite, req: DictateRequest, request: typeof fetch = fetch): Promise<DictateResult> {
  const { wav, seconds } = decodeWav(req.audio);
  const names = dictionaryFor(p, { scene: req.scene });
  const heard = await transcribe(p, wav, { prompt: recognitionPrompt(names), offlineText: req.offline_text }, request);
  const level: CleanupLevel = req.level === 'book' ? p.book.voice.cleanup : req.level;
  const base = { raw: heard.text, level, provider: heard.provider, seconds };
  if (!heard.text.trim()) return { ...base, text: '', flags: [] };
  const plain = cleanDictation(heard.text, { level, before: req.before, names });
  if (level === 'verbatim') return { ...base, text: plain, flags: [] };
  const sheet = p.style.sheet;
  try {
    const out = await agents.scribe({ raw: heard.text, before: req.before, after: req.after, dictionary: names, level, style: { spelling: sheet.spelling, quotes: sheet.quotes } });
    const tidy = out.text.trim();
    const check = checkCleanup(heard.text, tidy, { names, level });
    if (!tidy || !check.ok) return { ...base, text: plain, flags: check.flags.length ? check.flags : ['the tidy-up came back empty'] };
    return { ...base, text: joinToCursor(tidy, req.before, names), flags: [] };
  } catch (e) {
    return { ...base, text: plain, flags: [`tidy-up unavailable: ${(e as Error).message}`] };
  }
}

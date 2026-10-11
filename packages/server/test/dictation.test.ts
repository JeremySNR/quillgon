import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphStore, type AgentSuite } from '@quillgon/core';
import { ScriptedSuite } from '@quillgon/agents';
import { dictate, transcribe, voiceStatus } from '../src/dictation.js';
import { NovelServer } from '../src/index.js';
import { copyFixture, silentWav } from '../../core/test/helpers.js';

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

describe('dictation', () => {
  const env = { ...process.env };
  afterAll(() => {
    process.env = env;
  });

  it('chooses a recogniser and says why when there is none', () => {
    delete process.env.QUILLGON_OFFLINE;
    delete process.env.OPENAI_API_KEY;
    delete process.env.QUILLGON_WHISPER_CMD;
    const store = GraphStore.open(copyFixture(), { noIndex: true });
    const p = store.project;
    p.book.models.frontier = { provider: 'openai', model: 'x' };
    expect(voiceStatus(p)).toMatchObject({ ready: false, provider: 'openai' });
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(voiceStatus(p)).toMatchObject({ ready: true, provider: 'openai', model: 'gpt-4o-mini-transcribe', local: false });
    process.env.QUILLGON_WHISPER_CMD = '/usr/bin/whisper-cli';
    process.env.QUILLGON_WHISPER_MODEL = '/models/ggml-large-v3-turbo.bin';
    expect(voiceStatus(p)).toMatchObject({ ready: true, provider: 'local', local: true });
    p.book.voice.provider = 'openai';
    expect(voiceStatus(p).provider).toBe('openai');
    p.book.voice.provider = 'offline';
    expect(voiceStatus(p).provider).toBe('offline');
    store.close();
  });

  it('sends audio, the dictionary and the language to OpenAI', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.QUILLGON_WHISPER_CMD;
    const store = GraphStore.open(copyFixture(), { noIndex: true });
    const p = store.project;
    p.book.models.frontier = { provider: 'openai', model: 'x' };
    p.book.voice = { ...p.book.voice, provider: 'openai', language: 'en' };
    let sent: FormData | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      sent = init.body as FormData;
      return new Response(JSON.stringify({ text: ' Mara went down to the harbour. ' }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await transcribe(p, Buffer.from(silentWav(1)), { prompt: 'Names: Mara Penrose.' }, fake);
    expect(out).toEqual({ text: 'Mara went down to the harbour.', provider: 'openai' });
    expect(sent!.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(sent!.get('prompt')).toBe('Names: Mara Penrose.');
    expect(sent!.get('language')).toBe('en');
    const failing = (async () => new Response('{"error":"secret details"}', { status: 401 })) as unknown as typeof fetch;
    await expect(transcribe(p, Buffer.from(silentWav(1)), {}, failing)).rejects.toThrow(/HTTP 401\). Check your API key/);
    store.close();
  });

  it('uses the tidy-up only when it adds nothing', async () => {
    const store = GraphStore.open(copyFixture(), { noIndex: true });
    const p = store.project;
    p.book.voice.provider = 'offline';
    const audio = b64(silentWav(1));
    const good = new ScriptedSuite({ scribe: async () => ({ text: 'she went to see Eliza at the cannery.' }) }) as unknown as AgentSuite;
    const ok = await dictate(p, good, { audio, before: 'Later that day', after: '', scene: 's04', level: 'book', offline_text: 'um she went to see Eliza at the uh cannery' });
    expect(ok).toMatchObject({ raw: 'um she went to see Eliza at the uh cannery', text: ' she went to see Eliza at the cannery.', level: 'light', provider: 'offline', flags: [] });

    const inventive = new ScriptedSuite({ scribe: async () => ({ text: 'She went to see Margaret at the cannery, its brick glowing in the dusk.' }) }) as unknown as AgentSuite;
    const refused = await dictate(p, inventive, { audio, before: '', after: '', scene: null, level: 'light', offline_text: 'um she went to see her at the cannery' });
    expect(refused.text).toBe('She went to see her at the cannery');
    expect(refused.flags.join(' ')).toContain('Margaret');

    const verbatim = await dictate(p, inventive, { audio, before: '', after: '', scene: null, level: 'verbatim', offline_text: 'um she went' });
    expect(verbatim.text).toBe('Um she went');
    await expect(dictate(p, good, { audio: b64(new TextEncoder().encode('x'.repeat(60))), before: '', after: '', scene: null, level: 'book' })).rejects.toThrow(/WAV/);
    store.close();
  });
});

describe('dictation API', () => {
  let server: NovelServer;
  let base = '';
  beforeAll(async () => {
    process.env.QUILLGON_OFFLINE = '1';
    const dir = copyFixture();
    server = new NovelServer();
    server.open(dir);
    base = `http://127.0.0.1:${await server.listen(0)}`;
  });
  afterAll(() => server.close());
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-quillgon-token': server.token }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: (await res.json()) as any };
  };

  it('reports the recogniser and transcribes offline', async () => {
    expect((await api('GET', '/api/voice')).json).toMatchObject({ ready: true, provider: 'offline' });
    expect((await api('GET', '/api/project')).json.dictation).toMatchObject({ provider: 'offline' });
    const r = await api('POST', '/api/dictate', { audio: b64(silentWav(0.5)), before: 'The tide was', offline_text: 'uh, out' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ raw: 'uh, out', text: ' out', provider: 'offline' });
    expect((await api('POST', '/api/dictate', { before: 'x' })).status).toBe(422);
  });
});

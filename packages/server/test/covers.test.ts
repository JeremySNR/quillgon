import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProject } from '@quillgon/core';
import { copyFixture } from '../../core/test/helpers.js';
import { COVER_MODEL, CoverOptions, coverAvailability, coverImage, coverPrompt, generateCover, listCovers } from '../src/covers.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGo0AAAAASUVORK5CYII=', 'base64');
function project() {
  const p = loadProject(copyFixture()).project;
  p.book.models.frontier = { provider: 'openai', model: 'gpt-6.1-sol', api_key_env: 'COVER_TEST_KEY' };
  vi.stubEnv('QUILLGON_OFFLINE', '0');
  vi.stubEnv('COVER_TEST_KEY', 'test-key');
  return p;
}
afterEach(() => vi.unstubAllEnvs());

describe('book covers', () => {
  it('uses bounded story context and exact lettering, with optional creative control', () => {
    const p = project();
    const automatic = coverPrompt(p, CoverOptions.parse({}));
    expect(automatic).toContain(p.book.title);
    expect(automatic).toContain(p.intent.tone);
    expect(automatic).toContain('small bookstore thumbnail');
    const custom = coverPrompt(p, CoverOptions.parse({ style: 'printmaking', direction: 'Red ink, no faces', author: 'A. Writer', typography: false }));
    expect(custom).toContain('Red ink, no faces');
    expect(custom).toContain('No letters or text anywhere');
    p.intent.notes = 'x'.repeat(100000);
    expect(coverPrompt(p, CoverOptions.parse({ direction: 'x'.repeat(3000) } )).length).toBeLessThan(32000);
    expect(CoverOptions.safeParse({ style: 'unknown' }).success).toBe(false);
    expect(CoverOptions.safeParse({ direction: 'x'.repeat(3001) }).success).toBe(false);
  });

  it('prevents paid requests while offline or missing a key', async () => {
    const p = project(); const request = vi.fn();
    vi.stubEnv('QUILLGON_OFFLINE', '1');
    await expect(generateCover(p, CoverOptions.parse({}), vi.fn(), request)).rejects.toThrow('offline');
    expect(request).not.toHaveBeenCalled();
    vi.stubEnv('QUILLGON_OFFLINE', '0'); vi.stubEnv('COVER_TEST_KEY', '');
    expect(coverAvailability(p)).toMatchObject({ ready: false });
  });

  it('calls the Images API and persists separate downloadable versions', async () => {
    const p = project();
    p.book.models.frontier!.base_url = 'https://example.invalid/v1/';
    const request = vi.fn().mockImplementation(async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }));
    const options = CoverOptions.parse({ author: 'A. Writer', direction: 'Quiet seaside' });
    const first = await generateCover(p, options, vi.fn(), request);
    const second = await generateCover(p, options, vi.fn(), request);
    expect(first.id).not.toBe(second.id);
    expect(listCovers(p.dir)).toHaveLength(2);
    expect(coverImage(p.dir, first.id)).toEqual(png);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://example.invalid/v1/images/generations');
    expect(JSON.parse(init.body)).toMatchObject({ model: COVER_MODEL, n: 1, size: '1600x2560', output_format: 'png', quality: 'high' });
    expect(init.headers.authorization).toBe('Bearer test-key');
    expect(fs.readFileSync(path.join(p.dir, 'covers', `${first.id}.json`), 'utf8')).not.toContain('test-key');
    expect(() => coverImage(p.dir, '../book.yaml')).toThrow('Invalid cover id');
  });

  it('reports provider errors without saving a cover or retrying a paid request', async () => {
    const p = project();
    const request = vi.fn().mockResolvedValue(new Response('secret details', { status: 429 }));
    await expect(generateCover(p, CoverOptions.parse({}), vi.fn(), request)).rejects.toThrow('quota');
    expect(request).toHaveBeenCalledTimes(1);
    expect(listCovers(p.dir)).toEqual([]);
    const invalid = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: 'dGV4dA==' }] }));
    await expect(generateCover(p, CoverOptions.parse({}), vi.fn(), invalid)).rejects.toThrow('invalid PNG');
    expect(listCovers(p.dir)).toEqual([]);
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from './content.mjs';
import { site } from './site.config.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const titles = new Set();
const descriptions = new Set();
const origin = new URL(site.url).origin;
let links = 0;
for (const page of pages) {
  const filename = page.path === '/404.html' ? '404.html' : `${page.path}/index.html`;
  const html = await fs.readFile(path.join(root, filename), 'utf8');
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${page.path}: one main heading`);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
  assert.ok(title && !titles.has(title), `${page.path}: unique title`);
  assert.ok(description && !descriptions.has(description), `${page.path}: unique description`);
  titles.add(title); descriptions.add(description);
  assert.ok(html.includes(`rel="canonical" href="${new URL(page.path, origin).href}"`), `${page.path}: canonical`);
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.ok(data.length > 0, `${page.path}: structured data parses`);
  assert.ok(!html.includes('PLACEHOLDER'), `${page.path}: no unfinished placeholders`);
  for (const match of html.matchAll(/(?:href|src)="(\/[^"#]*)(#[^"]*)?"/g)) {
    const [full, url, fragment] = match;
    const target = path.join(root, url.endsWith('/') ? `${url}index.html` : url);
    await assert.doesNotReject(fs.access(target), `${page.path}: missing ${url}`);
    if (fragment && target.endsWith('.html')) {
      const targetHtml = await fs.readFile(target, 'utf8');
      assert.ok(targetHtml.includes(`id="${fragment.slice(1)}"`), `${page.path}: missing anchor ${full}`);
    }
    links++;
  }
}
for (const font of ['inter', 'literata']) assert.ok((await fs.stat(path.join(root, `assets/fonts/${font}-latin.woff2`))).size > 1000);
const card = await fs.readFile(path.join(root, 'assets/social-card.png'));
assert.equal(card.readUInt32BE(16), 1200, 'Social card width');
assert.equal(card.readUInt32BE(20), 630, 'Social card height');
const sitemap = await fs.readFile(path.join(root, 'sitemap.xml'), 'utf8');
assert.equal((sitemap.match(/<loc>/g) || []).length, pages.filter(page => !page.noindex).length);
assert.ok(!sitemap.includes('404.html'));
assert.ok((await fs.readFile(path.join(root, 'robots.txt'), 'utf8')).includes(`${origin}/sitemap.xml`));
console.log(`Checked ${pages.length} pages, ${links} internal links/assets, unique metadata, structured data, fonts, sitemap, and the 1200×630 social card.`);

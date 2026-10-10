import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from './site.config.mjs';
import { pages } from './content.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
const repoRoot = path.resolve(root, '../..');
const origin = new URL(site.url).origin;
if (!/^https?:$/.test(new URL(site.url).protocol)) throw new Error('SITE_URL must use HTTP or HTTPS');
if (path.dirname(out) !== root || path.basename(out) !== 'dist') throw new Error('Output must stay inside apps/site/dist');
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.cp(path.join(root, 'public'), out, { recursive: true });
await fs.mkdir(path.join(out, 'assets/screenshots'), { recursive: true });
for (const name of ['desk-light', 'desk-dark', 'editor', 'editor-details', 'planning', 'characters', 'ledger', 'reader', 'manuscript']) {
  await fs.copyFile(path.join(repoRoot, `docs/screenshots/ui-refresh/${name}.png`), path.join(out, `assets/screenshots/${name}.png`));
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const quill = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 25 22 10M12 21c-1-7 4-15 14-16 1 10-5 17-14 16Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="m15 14 4 1m-7 3 4 1M6 27h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const arrow = '<span aria-hidden="true">↗</span>';
function nav(active) {
  return `<header class="site-header"><div class="container nav-inner"><a class="wordmark" href="/" aria-label="Quillgon home">${quill}<span>Quillgon</span></a><nav aria-label="Main navigation"><a href="/#workspace"${active === 'features' ? ' aria-current="true"' : ''}>The workspace</a><a href="/guides/plotting-a-novel/"${active === 'guides' ? ' aria-current="page"' : ''}>Writing guides</a><a class="github-link" href="${site.repo}">GitHub ${arrow}</a></nav><a class="button button-small" href="/get-started/">Get started <span aria-hidden="true">→</span></a></div></header>`;
}
function footer() {
  return `<footer class="site-footer"><div class="container footer-top"><div><a class="wordmark" href="/">${quill}<span>Quillgon</span></a><p>A whole novel. Still your story.</p><span class="small">An independent project, in early development.</span></div><div class="footer-links"><div><span class="eyebrow">The workspace</span><a href="/features/story-planning/">Story planning</a><a href="/features/continuity/">Story continuity</a><a href="/features/revision/">Reviewed revisions</a></div><div><span class="eyebrow">Take a look</span><a href="/get-started/">Get started</a><a href="${site.release}">Download source preview ${arrow}</a><a href="${site.repo}">Source on GitHub ${arrow}</a><a href="${site.repo}/issues">Report an issue ${arrow}</a></div></div></div><div class="container footer-bottom"><span>Made for the stories only you can tell.</span><a href="/privacy/">Website privacy</a><span>Quillgon · 2026</span></div></footer>`;
}
function document(page) {
  const canonical = new URL(page.path, origin).href;
  const schema = [{ '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${origin}/#website`, name: site.name, url: `${origin}/` }];
  if (page.path === '/') schema.push({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: site.name, url: `${origin}/`, description: site.description, applicationCategory: 'BusinessApplication', operatingSystem: 'Windows, macOS, Linux', sameAs: site.repo, screenshot: `${origin}/assets/screenshots/desk-light.png` });
  if (page.path.startsWith('/guides/')) schema.push({ '@context': 'https://schema.org', '@type': 'Article', headline: page.heading, description: page.description, mainEntityOfPage: canonical, publisher: { '@type': 'Organization', name: site.name, url: `${origin}/` } });
  if (page.path !== '/' && !page.noindex) schema.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Quillgon', item: `${origin}/` }, { '@type': 'ListItem', position: 2, name: page.heading, item: canonical }] });
  const preview = process.env.VERCEL_ENV === 'preview';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(page.title)}</title><meta name="description" content="${escape(page.description)}"><meta name="theme-color" content="#faf9f6"><meta name="robots" content="${page.noindex || preview ? 'noindex, follow' : 'index, follow'}"><link rel="canonical" href="${canonical}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preload" href="/assets/fonts/literata-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css"><meta property="og:type" content="${page.path.startsWith('/guides/') ? 'article' : 'website'}"><meta property="og:site_name" content="Quillgon"><meta property="og:title" content="${escape(page.title)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${origin}/assets/social-card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Quillgon — A whole novel. Still your story."><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(page.title)}"><meta name="twitter:description" content="${escape(page.description)}"><meta name="twitter:image" content="${origin}/assets/social-card.png"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script><script src="/site.js" defer></script></head><body><a class="skip-link" href="#main">Skip to content</a>${nav(page.active)}<main id="main">${page.body}</main>${footer()}<dialog class="image-dialog" aria-label="Workspace screenshot"><button class="dialog-close" aria-label="Close screenshot">Close <span aria-hidden="true">×</span></button><img alt=""><p></p></dialog></body></html>`;
}

for (const page of pages) {
  const file = page.path === '/404.html' ? path.join(out, '404.html') : path.join(out, page.path, 'index.html');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, document(page));
}
const publicPages = pages.filter(page => !page.noindex);
await fs.writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPages.map(page => `<url><loc>${escape(new URL(page.path, origin).href)}</loc></url>`).join('')}</urlset>\n`);
await fs.writeFile(path.join(out, 'robots.txt'), `User-agent: *\n${process.env.VERCEL_ENV === 'preview' ? 'Disallow: /' : 'Allow: /'}\nSitemap: ${origin}/sitemap.xml\n`);
await fs.writeFile(path.join(out, 'llms.txt'), `# Quillgon\n\n> ${site.description}\n\nQuillgon is an early-development, source-run local novel-writing application. Offline models produce placeholders; AI generation uses the author's configured provider. AI requests can send story context to that provider. No packaged installers are currently offered on this website.\n\n## Product\n${publicPages.map(page => `- [${page.heading}](${new URL(page.path, origin).href}): ${page.description}`).join('\n')}\n\n## Source\n- [GitHub](${site.repo}): Code, issue tracker, and technical documentation.\n`);
console.log(`Built ${pages.length} static pages for ${origin}. No client framework or runtime dependencies.`);

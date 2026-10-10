# Quillgon public website

The public website belongs in this monorepo so product changes, screenshot updates, and public copy can ship together. Deploy it as a separate Vercel project with **Root Directory `apps/site`**. It has no connection to the manuscript API and no runtime dependencies.

Live website: **https://quillgon.vercel.app**. The project is connected to GitHub, with production tracking the repository's default branch.

## Local development

From the repository root:

```sh
node apps/site/build.mjs
node apps/site/check.mjs
node apps/site/serve.mjs
```

Open http://127.0.0.1:4321. Rebuild and reload after edits. The equivalent pnpm commands are `pnpm site:build`, `pnpm site:check`, and `pnpm site:dev`.

Content lives in `content.mjs`, the shared document shell in `build.mjs`, and styles and progressive enhancements in `public/`. The build copies the actual editorial refresh screenshots from `docs/screenshots/ui-refresh/`; it does not maintain another set of source images.

Inter and Literata Latin variable fonts are self-hosted from Fontsource packages version 5.3.0. Their upstream SIL Open Font Licenses are included alongside them. The social card is a rendered, 1200 × 630 brand composition.

## Vercel

- Project: `quillgon`
- Git repository: `JeremySNR/quillgon`
- Root Directory: `apps/site`
- Include source files outside the Root Directory: **enabled** (the build reads `docs/screenshots/ui-refresh/`)
- Framework preset: Other
- Install Command: `echo No dependencies to install`
- Build Command: `node build.mjs`
- Output Directory: `dist`
- Node: 22 or newer
- Production branch: the repository's current default branch, `ccr-c6ab75dd-8lzqn8`

The app-level `vercel.json` supplies the build settings and static response headers. Importing the repository must target this directory; `apps/desktop` is the local manuscript UI and is not the marketing website.

`site.config.mjs` is the single source for the canonical origin, defaulting to `https://quillgon.vercel.app`. For a custom domain, update it or set `SITE_URL` on the Vercel project and rebuild. The build uses that origin for canonicals, social images, structured data, `robots.txt`, `sitemap.xml`, and `llms.txt`. Vercel preview builds have `noindex` metadata and disallow crawling.

## Positioning and search

The primary audience is novelists comfortable trying an early project from source, especially those who want AI help while keeping control over story logic and revisions. The central message is **“A whole novel. Still your story.”** The supporting distinction is connected story state, character knowledge, setups and payoffs, and reviewed ripple changes.

Avoid implying a finished consumer service, available binary installers, proven 80k-word generation, guaranteed continuity, or fully on-device AI. The repository uses the MIT license. Do not add fabricated reviews, usage counts, or software ratings to structured data.

Search intent maps to real pages:

| Page | Intended topic |
| --- | --- |
| `/` | Quillgon; AI novel writing software |
| `/features/story-planning/` | Novel planning software; scene cards |
| `/features/continuity/` | Story continuity; character knowledge; setups and payoffs |
| `/features/revision/` | AI novel editing; reviewed revisions |
| `/guides/plotting-a-novel/` | How to plot a novel |
| `/guides/fixing-plot-holes/` | How to find and fix plot holes |
| `/guides/character-knowledge/` | How to track character knowledge in a novel |
| `/get-started/` | Quillgon setup and requirements |

All pages are complete static HTML with unique titles, descriptions, canonical URLs, semantic headings, internal links, and relevant JSON-LD. Images have alternate text and intrinsic dimensions; below-the-fold screenshots load lazily. Core content, navigation, and FAQs work without JavaScript.

After the public URL is stable, verify it in Google Search Console and submit `/sitemap.xml`. Connect a permanent domain before investing in backlinks. Add new guides only when they answer a real writing problem with enough substance to stand alone. Search rankings and indexing are not guaranteed by this implementation.

References: [Vercel monorepos](https://vercel.com/docs/monorepos), [Google Search developer guidance](https://developers.google.com/search/docs/fundamentals/get-started-developers), and [software application structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app). The software schema describes the application; it does not invent an offer or a review to qualify for a rich result.

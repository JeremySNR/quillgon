# Contributing to Quillgon

Quillgon is in early development. Reports from people trying the sample novella are especially useful: tell us what you tried, what you expected, and what happened. Please check existing issues before opening a new one.

## Run the project

Use Node.js 22 or newer and pnpm 10. From the repository root:

```sh
pnpm install
pnpm build
pnpm serve
```

Open <http://127.0.0.1:4317> and choose **Open the sample novella**. To explore a new book without an API key, choose **Offline** models. Offline generation produces placeholder text.

For UI development, run `pnpm dev`. The local Vite server uses <http://localhost:5173>.

## Desktop app and packaging

`pnpm desktop` runs the Electron shell against the source tree (plain Node and tsx; needs `node` on your `PATH`). Installers are built with:

```sh
pnpm dist                       # UI + server bundle + electron-builder, for this platform
pnpm -C apps/desktop dist:dir   # the same, but only the unpacked app (faster)
pnpm -C apps/desktop bundle     # only stage apps/desktop/out/ (needs `pnpm build` first)
```

The pieces:

- `apps/desktop/electron/main.cjs` and `preload.cjs`: the shell. It starts the server, waits up to 30 seconds for its URL (`QUILLGON_STARTUP_TIMEOUT_MS`), and keeps the window on the server's origin.
- `apps/desktop/electron/server-entry.mjs`: the server's entry point in a packaged app.
- `apps/desktop/scripts/prepare-package.mjs`: bundles that entry and the workspace packages into `out/server/server.mjs` with esbuild, copies the UI, the sample novella and the agent prompts next to it, and installs `better-sqlite3` rebuilt for Electron (a prebuilt binary if one exists, otherwise compiled, which needs a C/C++ toolchain, Python 3 and access to electronjs.org).
- `apps/desktop/electron-builder.config.cjs`: targets, and optional signing.
- `.github/workflows/release.yml`: on a `v*` tag, builds macOS, Windows and Linux and attaches the installers to a draft release.

To run the bundled server without packaging, stage it and point the shell at it: `pnpm -C apps/desktop bundle`, then `QUILLGON_SERVER_BUNDLE="$PWD/apps/desktop/out/server/server.mjs" pnpm desktop` from the repository root. If you add a file that the server reads at runtime relative to its own source file, stage it in `prepare-package.mjs` too, or the installed app will not find it. Build output (`apps/desktop/out/`, `apps/desktop/release/`) is ignored by Git; do not commit it.

## Before a pull request

```sh
pnpm lint
pnpm test
pnpm typecheck
pnpm site:build
pnpm site:check
```

If you change the desktop UI, include a screenshot and describe the user flow you checked. If you change the Electron shell or packaging, say which platforms you built and ran (`pnpm -C apps/desktop dist:dir` is enough for most changes). If you change story data or an agent, describe the fixture or offline scenario you ran. Live-model tests require a provider key and are not part of the normal contribution gate.

Keep pull requests focused. Explain the user-facing problem, the change, and how you verified it. Do not commit API keys, private manuscripts, generated books, or `.engine` databases. The project stores books as local Markdown and YAML; sample data belongs in `fixtures/` only when it is safe to publish.

## Useful places to start

- [Report a bug](https://github.com/JeremySNR/quillgon/issues/new) with reproduction steps and the operating system.
- [Suggest an improvement](https://github.com/JeremySNR/quillgon/issues/new) based on a concrete writing task.
- Read the [architecture and verified milestones](README.md#architecture) before changing the engine.

By contributing, you agree that your contribution may be distributed under the [MIT license](LICENSE).

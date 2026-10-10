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

## Before a pull request

```sh
pnpm test
pnpm typecheck
pnpm site:build
pnpm site:check
```

If you change the desktop UI, include a screenshot and describe the user flow you checked. If you change story data or an agent, describe the fixture or offline scenario you ran. Live-model tests require a provider key and are not part of the normal contribution gate.

Keep pull requests focused. Explain the user-facing problem, the change, and how you verified it. Do not commit API keys, private manuscripts, generated books, or `.engine` databases. The project stores books as local Markdown and YAML; sample data belongs in `fixtures/` only when it is safe to publish.

## Useful places to start

- [Report a bug](https://github.com/JeremySNR/quillgon/issues/new) with reproduction steps and the operating system.
- [Suggest an improvement](https://github.com/JeremySNR/quillgon/issues/new) based on a concrete writing task.
- Read the [architecture and verified milestones](README.md#architecture) before changing the engine.

By contributing, you agree that your contribution may be distributed under the [MIT license](LICENSE).

# Novel Engine

A local desktop tool that generates full-length novels while you stay in charge of the story. You set the intent, pin plot points, choose between alternatives and edit anything. Every change ripples through the rest of the book, and nothing changes until you've reviewed it.

**The story graph is the source; prose is compiled output.** Intent, plot points, threads, character state and scene cards define what is true. Prose is generated from them and can be edited, but every prose edit is read back into the graph so the two never drift.

![Overview](docs/screenshots/overview-dark.png)

## Quick start

```bash
pnpm install
pnpm build          # build the UI
pnpm serve          # http://127.0.0.1:4317, then "Open the sample novella"
pnpm desktop        # or run it as an Electron app
```

The app works with no API key: choose **Offline** models when you create a book (or set `NOVEL_OFFLINE=1`). Offline output is placeholder text, but every screen and workflow works.

To use Claude, set `ANTHROPIC_API_KEY`. Models per tier live in each book's `book.yaml`, and you can also change them under Settings → Models. The defaults are:

| Tier | Default | Used by |
| --- | --- | --- |
| frontier | `claude-opus-5-5` | interviewer, planner, writer, reviser |
| mid | `claude-sonnet-5-5` | extractor, voice checker, humaniser |
| small | `claude-haiku-5-5` | continuity |
| reader | `claude-sonnet-5-5` | simulated reader (point it at another vendor through an OpenAI-compatible endpoint if you can) |

For development, `pnpm dev` runs the API and the Vite dev server with hot reload on http://localhost:5173.

## Using it

1. **Build** walks you through five gates, top down:
   1. **Intent:** answer a few questions about your premise.
   2. **Plot points:** pin what must happen; the planner proposes the rest.
   3. **Structure:** pick one of **three** different act/chapter structures (expected, breaks an expectation, wild card).
   4. **Scene cards:** pick one of **two** beat sequences per chapter.
   5. **Prose:** each scene goes writer → voice check → banned patterns → humaniser → extraction.
2. **Outline:** drag to reorder. If the new order breaks what characters know, you're offered a ripple.
3. **Scene editor:** the card on the left (simple fields first, the rest under "More"), the prose on the right in a 66-character reading column. Banners show the sync state and tell you what to do next.
4. **Ripple review:** the change, the affected scenes (conflicts pinned to the top), and card and prose diffs. Accept or reject each scene. Use `j`/`k` to move, `a`/`r` to decide, `⇧↵` to apply the round. Each applied round is one git commit, and you can revert the whole ripple.
5. **Characters:** a scene-by-scene grid of what each person knows. Click a square to change it; the book is checked for knock-on effects.
6. **Reader report:** an engagement curve, twists the reader guessed early, confusion, and runs of boredom.

`⌘K` / `Ctrl K` opens the command palette (every scene, character, thread and action). `⌘\` collapses the sidebar, `⌘.` enters focus mode, and `⌘1`–`⌘7` switch views. The **what-if** menu in the top bar creates, compares and merges git branches.

| | |
| --- | --- |
| ![Scene editor](docs/screenshots/scene-light.png) | ![Ripple review](docs/screenshots/ripple-dark.png) |
| ![Characters](docs/screenshots/characters-dark.png) | ![Reader report](docs/screenshots/reader-dark.png) |

## CLI

The same engine, headless. `novel` lives at `packages/cli/bin/novel.mjs`; `pnpm novel <command>` also works.

```
novel init <dir> [--title T] [--words 12000] [--offline]
novel validate [dir]                 schema + reference check with file/field-precise errors
novel status | sync | log | costs
novel intent | plan | cards <chapter|all> [--default] | write <scene|chapter|all>
novel impact <entity>                preview what a change touches (no model calls)
novel change <entity>                edit in $EDITOR → impact → card diffs → prose diffs → commit
        entity: scene:s04  state:mara@s04  thread:ledger  plot:pp-drowning  character:mara  structure
novel extract <scene>                read a hand edit back; "your edit changed these facts"
novel ripple [revert|abandon|list]
novel read [--act act-1] | check [--mechanical] | voice | estimate
novel export [--format md|docx|epub]   (docx/epub need Pandoc)
novel branch [name | switch <b> | merge <b> | delete <b>]
novel serve [--dir book] [--port 4317]
```

Pass `--yes` to accept the defaults at every gate (useful for scripting), or `--record <dir>` / `--replay <dir>` to record model responses as test fixtures or replay them.

## Architecture

```
apps/desktop/        Electron shell + React/Vite UI (talks to the server over HTTP + SSE)
packages/core/       schemas, graph store, SQLite index, impact analyser, sync,
                     pipeline, ripple engine, quality checks, git
packages/agents/     nine agents (prompt.md + schemas), model adapter, offline suite
packages/server/     local JSON API, background jobs, file watching
packages/cli/        the `novel` command
fixtures/novella/    "The Tidekeeper's Ledger": 12 scenes, 4 characters, 3 threads, 2 plot points
```

- **Only the graph store writes to the manuscript.** Agents return structured output, validated with Zod, and the store writes files, updates the index and commits.
- **A book is a git repo of Markdown and YAML** (`book.yaml`, `intent.md`, `plot-points/`, `threads/`, `characters/<id>/{bio.md,voice.md,state.yaml}`, `scenes/<id>/{card.yaml,prose.md,facts.yaml}`, `structure.yaml`, `timeline.yaml`, `style/`, `reports/`). You can edit any of it in another editor; the app reloads.
- **The index is disposable.** `.engine/index.sqlite` holds entities, references, facts and scene embeddings. Delete it and it rebuilds. Embeddings are local and deterministic (hashed term vectors), so impact analysis needs no network.
- **Sync** compares the card hash the prose was generated from with the prose hash at its last extraction. The result is `in_sync`, `card_ahead`, `prose_ahead` or `conflict`, and a conflict blocks generation.
- **Impact analysis** walks references, facts and per-scene state. Hop 0 is the edited scene, hop 1 a direct reference, hop 2 a thread or character state, and hop 3 similarity only (listed, never proposed). Locked scenes become conflicts with three choices: unlock, keep (recorded in `reports/known-inconsistencies.md`), or revert.
- **Model adapter:** `complete(messages, schema, options) → parsed object`. It streams from Claude with adaptive thinking, the configured effort and native JSON-schema output (falling back to prompt-only JSON), validates the result, and re-prompts with the validation error up to twice. Every call is logged to `reports/costs.jsonl`. An OpenAI-compatible backend is included for other vendors.
- **Prompts are Markdown** (`packages/agents/src/agents/<name>/prompt.md`). Edit them in the app; overrides are saved to `prompts/<agent>.md` in the book. The intent and its hard rules are always in the system prompt.

## Tests and acceptance

```bash
pnpm test           # 70 unit/integration tests, no model calls
pnpm e2e            # drives the real UI in Chromium (offline models)
pnpm screenshots    # regenerates docs/screenshots
pnpm typecheck
pnpm test:live      # live-model tests; needs NOVEL_LIVE=1 and an API key
```

| Phase | Status |
| --- | --- |
| 1. Schemas and store | ✅ Fixture validates; 12 kinds of corruption reported with exact file and field; index rebuild matches its snapshot |
| 2. Impact analyser | ✅ 15 named changes with expected affected sets; removing Mara's `knows` fact in s04 flags exactly the later scenes where she speaks of it |
| 3. Adapter and extractor | ✅ Adapter: retries, cost logging, tier routing, record/replay. Extractor: scoring harness and contradiction flagging tested with scripted output. ⏳ The live 90% accuracy run (`extractor.live.test.ts`) needs an API key and has not been run |
| 4. Pipeline via CLI | ✅ Every gate end to end with offline models; result validates, all scenes in sync, reader run completes. ⏳ A 10–15k-word live novella has not been generated yet |
| 5. Ripples | ✅ Plot-point change touches the expected scenes, a locked scene raises a conflict, and continuity is clean afterwards; a prose edit that changes a fact triggers the right ripple; cascade cap; full revert |
| 6. Quality systems | ✅ Planted twist: early guesses detected with how early; a hand-made knowledge error is caught; incremental model-assisted continuity |
| 7. UI views 1–3 | ✅ Browsed and edited in Chromium; also smoke-tested in Electron |
| 8. UI views 4–6 | ✅ `scripts/e2e-ui.ts` completes the phase 5 ripple scenario entirely in the UI, accepting and rejecting individually |
| 9. Full novel | ⏳ Needs live models: generate 80k+ words, then tune context scoping, caps and prompts against what breaks |

## Notes and deviations from the plan

- **Anthropic SDK, not the Agent SDK.** Every agent call is a single structured completion, so the agents use `@anthropic-ai/sdk` directly. The Agent SDK's file and tool loop isn't needed.
- **Electron runs the core as a plain Node process.** This lets `better-sqlite3` load without an Electron rebuild. It needs `node` on your `PATH` (or set `NOVEL_NODE`).
- **Reader prediction matching is mechanical** (embedding similarity, synonym folding, and the prediction must name the right person). A cheap model judge would be more accurate and is an easy swap.
- **Two small additions to the data model:** `scenes/<id>/facts.yaml` holds extracted facts, so the index can rebuild from files, and an optional `locations.yaml` / `facts.yaml` glossary gives ids human-readable names.

The UI design follows the research brief in [docs/design.md](docs/design.md).

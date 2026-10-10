# Quillgon: an editorial workspace

The refresh puts the manuscript ahead of the machinery supporting it. The writing desk opens with the book, its premise, and a clear Continue writing action. Chapter navigation stays available while the author writes; scene cards move into a secondary inspector. Planning, revision, and review retain their existing API flows.

## Research and decisions

These are concrete product references, not a claim that there is one objectively best UI. The choices below are design judgments for Quillgon's long-form writing workflow.

| Reference | Relevant principle | Quillgon implementation |
| --- | --- | --- |
| [Ulysses: Library & Editor](https://help.ulysses.app/en_US/getting-started/first-steps-library-editor) | Organizing a long work and editing its parts belong together. | Chapter and scene navigation in the sidebar, single-click scene titles, and a remembered last-opened scene per manuscript. |
| [iA Writer](https://ia.net/writer) | The text should have visual priority while writing. | A generous reading column, restrained controls, and an optional scene-details inspector. Existing focus mode remains available. |
| [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh) | Supporting navigation should recede; controls should have predictable locations and visual weight. | Muted navigation, consistent headings and controls, fewer competing card surfaces, and one primary next action. |
| [Ulysses: Designing the Editor](https://stories.ulysses.app/designing-the-ulysses-editor/) | Powerful editing can still feel straightforward. | Keep all scene-card and review capabilities accessible while reducing the amount shown by default. |

## Visual system

- Paper and sage surfaces with forest-green actions; a complementary dark palette. Status colors retain their meanings.
- Literata for manuscript text and editorial headings; Inter for controls; existing bundled fonts continue working offline.
- Small corner radii, fine separators, consistent spacing, and minimal shadows. The manuscript cover is generated from the actual book title and genre, with no external imagery.
- `tokens.css` owns colors, type, and dimensions. `app.css` keeps the established component styles; `workspace.css` supplies the editorial layout and responsive rules.
- Theme changes persist, including preferences written by previous versions. Prose size and line-length preferences remain honored.

## Workflow changes

- **Writing desk:** book summary, word target, Continue writing, chapter list, recent changes, and actionable editor notes. Additional notes expand rather than disappearing.
- **Navigation:** explicit Writing desk / Story planning / Manuscript labels; expandable chapters; persistent search. Existing shortcuts remain mapped to their original routes.
- **Editor:** prose first. Scene details opens an inspector on the right, or an overlay in smaller windows. Its preference persists. Focus mode can be exited by opening Scene details.
- **Manuscript:** titles open on a single click; row selection, dragging, and keyboard reorder controls are retained.
- **Settings and welcome:** shared visual language and clearer copy. Settings sections wrap and stack in smaller windows.
- **Accessibility:** native buttons, named navigation, current-page states, expanded-state reporting, a skip link, visible keyboard focus, and reduced-motion support. Hidden tooltips no longer widen the viewport. This is not a formal accessibility certification.

## Screenshots

Captured from the running application with the sample novella, not static mockups.

| Screen | Preview |
| --- | --- |
| Original overview | [Before](screenshots/ui-refresh/before-overview.png) |
| Writing desk | [Light](screenshots/ui-refresh/desk-light.png) · [Dark](screenshots/ui-refresh/desk-dark.png) |
| Editor | [Writing](screenshots/ui-refresh/editor.png) · [Scene details](screenshots/ui-refresh/editor-details.png) |
| Manuscript | [Outline](screenshots/ui-refresh/manuscript.png) |
| Planning and characters | [Planning](screenshots/ui-refresh/planning.png) · [Characters](screenshots/ui-refresh/characters.png) |
| Settings | [Desktop](screenshots/ui-refresh/settings.png) · [390px](screenshots/ui-refresh/settings-390.png) |
| Narrow workspace | [Writing desk](screenshots/ui-refresh/desk-390.png) · [Editor](screenshots/ui-refresh/editor-390.png) |

## Verification

`CHROME=/usr/bin/chromium pnpm test:ui-refresh` builds the app, opens a disposable copy of the sample manuscript through the UI, checks navigation and saving against the real server, and captures the main screens. Set `CHROME` to your Chromium executable if different.

Verified with Node 22 and Chromium:

- Frontend and backend TypeScript checks and production build.
- Existing suite: 94 passed, one live-provider test skipped.
- Open manuscript → Continue writing → edit → autosave API → reload and read the saved text.
- Scene inspector and focus-mode transitions, keyboard search, remembered scene, single-click manuscript links, and persisted theme.
- Main screens render without page errors; desktop plus 900px and 390px layouts for the writing desk, editor, manuscript, and settings have no page overflow.

Live model calls and the packaged Electron binary were not exercised. Native SQLite required a Node 22-compatible build in this environment; no dependency or engine changes are part of the UI refresh.

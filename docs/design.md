# Design: warm ink on paper

The interface follows a short research brief on current practice in productivity and writing tools (Linear, Raycast, iA Writer, Vercel Geist, Radix, NN/g). The aim is an app that is easy to follow and quiet enough to write in, without looking plain. The tokens live in `apps/desktop/src/styles/tokens.css` and the components in `app.css`.

## Typography

- **UI: Inter** (variable), with `cv11` and `ss01` enabled and tabular numbers for counts. Weights 400, 500 and 600 only.
- **Prose and page titles: Literata.** It was designed for long-form reading on screens, and its optical-size axis is used. The serif makes the app feel literary while the controls stay neutral.
- **IDs and metadata: JetBrains Mono.**
- **UI scale:** 11 / 12 / **13** / 14 / 16 / 20 / 24 / 32 px.
- **Prose:** 19px (adjustable from 16 to 23) at line-height 1.65, in a 66-character column (adjustable from 50 to 80), with `text-wrap: pretty`.
- **Fonts are bundled locally** (`@fontsource`), so the app works offline.

## Colour

- **Palette:** OKLCH tokens. Neutrals carry a slight amber tint (hue 65–85), with one ember accent. Status colours (success, warning, danger, info) are used only to carry meaning.
- **Contrast:** Body text clears 13:1. Secondary text, tertiary text, the accent and the status colours each clear 4.5:1 on every surface.
- **Themes:** Dark is the default. Light follows the system setting or a manual override.
- **Surfaces:** navigation sits on `--bg-sunken`, content on `--surface`, and interactive elements on `--surface-2`.
- **Diffs:** insertions are tinted green with an underline; deletions are tinted red with a strikethrough.
- **Threads and characters** get a stable hue derived from their id, so the same thread is the same colour everywhere.

## Shape, space, depth, motion

- **Radius:** 4 / 6 / 8 / 12 px, plus pills.
- **Spacing:** a 4px scale. Rows are 30–32px high.
- **Depth:** dark mode shows depth with a lighter surface step, an inset highlight and a 1px border. Light mode uses soft two-layer shadows.
- **Motion:** 100ms for a press, 150ms for popovers, 200ms for panels, 280ms for dialogs, with `cubic-bezier(.23,1,.32,1)`. Only transform and opacity are animated. With `prefers-reduced-motion`, everything becomes a 120ms fade.
- **Focus:** a 2px accent ring on `:focus-visible`.

## Patterns adopted

1. **⌘K command palette:** every view, scene, character, thread and action, each with its shortcut shown.
2. **Visible pipeline stepper:** Intent → Plot points → Structure → Scene cards → Prose → Review, showing which steps are done, current or locked.
3. **Progressive disclosure:** a scene card shows about seven fields; people, threads and facts sit under "More".
4. **Autosave:** prose saves as you type, and the status bar shows "Saved · 2s ago". The scene card has an explicit Save, because saving it triggers impact analysis.
5. **Undo instead of confirm** where reversible: decisions in ripple review and reordering both offer Undo.
6. **Keyboard-first review:** `j`/`k` to move, `a`/`r` to decide, `⇧↵` to apply. The cursor stays where it is after a decision.
7. **Prose diffs** in the reading font. Paragraphs are aligned first, then word-level diffs show within edited paragraphs. Unchanged paragraphs collapse, and you can switch to side by side.
8. **Severity dots and hop badges** on affected scenes, with conflicts pinned to the top.
9. **Skeletons** for layout-known loads. Model work shows a named stage ("Humaniser pass", "Reading back into the graph"), never a bare spinner.
10. **Drag and drop with a keyboard equivalent:** `⌥↑` / `⌥↓` in the outline.
11. **Empty states that teach:** one sentence, one primary action, and the sample novella as a way in.
12. **Status chips used only for meaning:** Draft, Approved, Locked, and the sync states.
13. **Tooltips** appear after a 500ms delay and show the shortcut.
14. **Saved preferences:** theme, prose size, line length and sidebar state persist per user.

## Sources

- Linear UI redesign: https://linear.app/now/how-we-redesigned-the-linear-ui
- OKLCH in CSS (Evil Martians): https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl
- Radix colour roles: https://radix-ui.com/themes/docs/theme/color
- Vercel Geist: https://vercel.com/geist
- Line length (Baymard): https://baymard.com/blog/line-length-readability
- iA Writer on writing fonts: https://ia.net/topics/in-search-of-the-perfect-writing-font
- WCAG 2.2 focus criteria: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- Command palettes (Superhuman): https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- Empty states (NN/g): https://www.nngroup.com/articles/empty-state-interface-design
- Skeletons and loading indicators (NN/g): https://www.nngroup.com/videos/skeleton-screens-vs-progress-bars-vs-spinners/

# Editor UX recovery behavior matrix

This matrix is the red-test backlog. Each item is honestly classified by what
kind of test actually protects it — a checkbox is not a claim of coverage
quality. **A weak DOM-presence/class-name check is never labeled as exact UX
coverage.**

## Classification legend

- **EXACT-FAST** — a fast (`npm test` / vitest, jsdom or pure Node) test drives
  the real production algorithm or the real CodeMirror `EditorView` end to end
  (real `dispatch`, real commands, real `parseMarkdown`/`markdown.ts`
  functions, or a real click handler fed a deterministic geometry seam because
  jsdom has no layout engine) and asserts the literal described behavior —
  exact source, exact selection/caret, exact ordering — not a proxy for it. A
  regression in the real behavior fails this test.
- **FAST-MODEL** — a fast test exercises a reasonable but partial model of the
  behavior (structural DOM/class-name/attribute presence, a single static
  snapshot, or an approximation of real geometry) that catches many but not
  all regressions. A real browser could still disagree. Never claimed as
  "exact."
- **BROWSER-REQUIRED** — the behavior is fundamentally about real browser
  layout, CSS, or OS/platform APIs (text wrapping, `coordsAtPos`, computed
  style, `prefers-reduced-motion`, the Fullscreen API) that jsdom cannot
  execute. Only a real-WebView e2e spec can verify it, and none of the e2e
  specs below were executed in this pass (see test-plan.md).
- **UNSUPPORTED** — no behavior exists to test yet: a documented, currently
  **failing** test exposes a genuine implementation gap. The test is
  intentionally red; fixing the gap, not the test, is the correct action.

## Editing authority and selection (`AUTH-*`, `REVEAL-*`)

- One CodeMirror document contains the exact canonical Markdown source.
  - **EXACT-FAST** — every assertion in `tests/integration/editor-editing-invariants.test.tsx` (27 tests) and `tests/unit/markdown-source-invariants.property.test.ts` (89 tests) compares `view.state.doc.toString()` / the returned source against an exact expected string, not a proxy; `tests/integration/editor-state-machine.test.tsx` additionally reasserts a live delimiter-count invariant against the real doc after every randomized step (160+ assertions across 3 seeds). Pre-existing "uses one CodeMirror live-preview canvas..." test (`tests/integration/presentation-preview.test.tsx`) is a FAST-MODEL smoke check on top of this.
- React rendering never mutates the CodeMirror-owned editable DOM.
  - **EXACT-FAST** — `AUTH-2` (`tests/integration/presentation-preview.test.tsx`) spies on `EditorView.dispatch` and asserts zero calls on an unchanged-source re-render.
- Clicking a rendered slide focuses the nearest source position without revealing the entire slide.
  - **EXACT-FAST** — `SEQ-1` (`tests/integration/editor-interaction-sequences.test.tsx`) drives a real click through the real reveal/caret-placement handler and asserts the exact resulting character offset, that only the clicked line reveals, and that neighboring blocks stay rendered. `GEOM-1` (`it.each`, same file) checks 4 distinct y-coordinates against 4 distinct expected revealed lines using a mocked (unavoidable, since jsdom has no layout) `getBoundingClientRect` as the geometry seam feeding the real mapping code.
- Rendered clicks map to the nearest source character when measurable.
  - **EXACT-FAST** — `GEOM-1` (character/line-ratio table) plus the pre-existing TeX click/dblclick precise-character-mapping test (`presentation-preview.test.tsx`).
- Rendered clicks use deterministic line or structured-unit boundaries when character mapping is unavailable.
  - **EXACT-FAST** — `GEOM-2` (`editor-interaction-sequences.test.tsx`) feeds the real click handler a zero-size rect and asserts a deterministic line-boundary fallback, not a crash or a whole-block reveal. Pre-existing `REVEAL-3` test corroborates.
- Clicking a rendered paragraph reveals only the line under the pointer.
  - **EXACT-FAST** — pre-existing paragraph-click reveal test, reinforced by `GEOM-1`/`SEQ-1`.
- Clicking a rendered heading reveals only that heading line.
  - **EXACT-FAST** — `REVEAL-5`.
- Clicking a rendered list item reveals only the selected list line.
  - **EXACT-FAST** — `REVEAL-6`.
- Clicking a rendered quote reveals only the selected quote line.
  - **EXACT-FAST** — `REVEAL-7`.
- Clicking a rendered code block reveals the complete fenced block as one editing unit.
  - **EXACT-FAST** — pre-existing "reveals a fenced code block as one coherent source unit" test drives the real reveal handler.
- Clicking a task checkbox toggles only its Markdown marker without revealing the surrounding source line.
  - **EXACT-FAST** — pre-existing "toggles a task marker through the source transaction without exposing the line" test (also serves as `MD-11`).
- Clicking outside the active source line returns the previous line to rendered form.
  - **EXACT-FAST** — `REVEAL-10`, and the click-away leg of `SEQ-1`/`SEQ-2`.
- Moving the caret into a line does not reveal neighboring lines.
  - **EXACT-FAST** — `REVEAL-11`.
- Moving the caret to the beginning of a heading reveals its `#` markers; moving away hides them again.
  - **EXACT-FAST** — pre-existing heading-reveal-via-caret test (covers both directions in one test).
- Moving through ordinary paragraph text preserves the native caret position.
  - **EXACT-FAST** — `AUTH-3`.
- Selection ranges remain stable when inactive content re-renders.
  - **EXACT-FAST** — `AUTH-4`, and the "neighboring content remains rendered" assertion in `SEQ-1`/`SEQ-2`.
- Drag selection across rendered and source-revealed content preserves the exact Markdown range.
  - **EXACT-FAST** — `AUTH-5`.
- Paste inserts source at the CodeMirror selection without duplicating or deleting surrounding content.
  - **EXACT-FAST** — `AUTH-6`, massively reinforced by the 4-test "Paste emulation" `describe` block in `editor-editing-invariants.test.tsx` (mid-line, multi-line, delimiter-mid-slide, at-boundary — each asserting exact doc string AND exact resulting caret offset, verified against hand-checked character-index tables, not guessed).
- Cut removes exactly the selected source and rerenders the affected region.
  - **EXACT-FAST** — `AUTH-7`, reinforced by the 3-test "Cut emulation" `describe` block in `editor-editing-invariants.test.tsx` (whole-slide-body cut, cross-block cut, delimiter-spanning cut — each with exact resulting doc/caret).
- Backspace at a source-line boundary joins adjacent content predictably.
  - **EXACT-FAST** — `AUTH-8`, reinforced by the 5-test Backspace `describe` block in `editor-editing-invariants.test.tsx` (mid-word, line-join, doc-start no-op, Unicode/emoji code-point-exact deletion, single-dash-of-delimiter deletion).
- Delete at a source-line boundary joins adjacent content predictably.
  - **EXACT-FAST** — `AUTH-9`, reinforced by the 3-test Delete/forward-delete `describe` block in `editor-editing-invariants.test.tsx`.
- Tab and Shift-Tab preserve CodeMirror indentation behavior.
  - **EXACT-FAST** — `AUTH-10`.
- Command/Ctrl-Z restores the exact previous source; Ctrl-Shift-Z/Ctrl-Y reapplies the exact undone source; undo remains coherent after rendered/source transitions.
  - **EXACT-FAST** — pre-existing undo/redo/coherence test, massively reinforced by the 4-test Undo/redo `describe` block in `editor-editing-invariants.test.tsx`, which asserts **both** the restored doc string **and** the restored caret/selection (not just text) — including the `isolateHistory`-forced history-boundary test proving two rapid edits undo one at a time rather than collapsing into one group. `editor-state-machine.test.tsx` additionally fires randomized undo/redo actions and reasserts every invariant afterward.

## Slide surfaces and navigation (`SURFACE-*`, `NAV-*`, `BOUNDARY-*`)

- Every parsed slide renders as one coherent visual surface.
  - **FAST-MODEL** — pre-existing structural DOM check only.
- Slide surfaces use the active light/dark presentation theme consistently.
  - **FAST-MODEL** — `SURFACE-2` checks the theme class name only; real computed-style verification is BROWSER-REQUIRED (jsdom loads no CSS).
- Slide surfaces do not contain nested scrollbars.
  - **FAST-MODEL** — pre-existing structural check (absence of a nested `.cm-scroller`); real overflow/scrollbar rendering is BROWSER-REQUIRED.
- Slide surfaces preserve the established 16:9 visual treatment in edit mode.
  - **FAST-MODEL** — `SURFACE-4` (rewritten this pass) now asserts exactly one `.cm-slide-page-fill` hook **per boundary**, each nested inside its own boundary (was previously `length > 0`, a near-tautology). The actual visual aspect-ratio fill is CSS (`aspect-ratio`/`padding-top` trick) and is **BROWSER-REQUIRED** — no e2e spec currently asserts it (documented gap).
- Overflow adds an inline scrollbar without leaving edit mode or hiding source.
  - **UNSUPPORTED** — pre-existing "keeps overflow inline with a scrollbar and non-blocking warning" test. Currently **FAILING**: genuine, pre-existing implementation gap.
- The overflow warning is small, non-blocking, and does not steal editor focus.
  - **EXACT-FAST** — `SURFACE-6` asserts the real ARIA `role="status"`, a non-focusable `tabIndex`, and that `document.activeElement` never leaves the editor's `contentDOM` — a genuine behavioral contract, not a class-name check.
- Slide labels and boundaries remain stable while source changes.
  - **FAST-MODEL** — `SURFACE-7` checks `dataset.slideIndex` stability structurally.
- Clicking a slide boundary focuses the adjacent editable position.
  - **UNSUPPORTED** — `NAV-1`. Currently **FAILING**: `.slide-boundary-label` has no `[data-block-from]`/`[data-math-from]` ancestor, so `selectWidgetRange` bails and the click is a no-op. The same root cause makes the new `GEOM-3` test (`editor-interaction-sequences.test.tsx`) fail too — documented inline as tied to this exact gap, not a new bug.
- ArrowDown at the true last visual line of a slide moves to the beginning of the next slide.
  - **UNSUPPORTED** — `NAV-2`. Currently **FAILING**: genuine implementation gap.
- ArrowUp at the true first visual line of a slide moves to the end of the previous slide.
  - **UNSUPPORTED** — `NAV-3`. Currently **FAILING**: genuine implementation gap.
- ArrowUp/Down inside a slide remain native vertical movement; wrapped visual lines do not trigger slide transitions prematurely.
  - **BROWSER-REQUIRED** — `NAV-4`/`NAV-5`, deferred to `tests/e2e/slide-boundary-vertical-nav.spec.ts` (written, not executed this pass): jsdom has no text-layout engine, so CodeMirror's real `moveVertically`/`coordsAtPos` cannot run. No fast-test seam can substitute here (unlike click mapping, which only needs a rect) because the whole point is *which* visual line a logical line wraps onto.
- Empty slides remain focusable.
  - **EXACT-FAST** — `NAV-6`.
- Add creates a blank slide at the requested boundary and focuses it.
  - **EXACT-FAST** — `BOUNDARY-1`/`BOUNDARY-2`, exercised repeatedly (real button clicks) by `editor-state-machine.test.tsx`'s `add-slide` action across all 3 seeds.
- Delete removes the requested slide and focuses a sensible neighbor.
  - **EXACT-FAST** — `BOUNDARY-3`, exercised repeatedly by the state machine's `delete-slide` action.
- Deleting the only slide leaves one blank slide.
  - **EXACT-FAST** — `BOUNDARY-4` (integration) plus the pure-domain "deleting every slide down to one then re-inserting matches deleting a fresh single-slide document" test in `markdown-source-invariants.property.test.ts`.
- Deleting an empty slide does not delete an adjacent non-empty slide.
  - **EXACT-FAST** — `BOUNDARY-5` (`tests/unit/presentation.test.ts`).
- Boundary controls do not become part of the Markdown source.
  - **EXACT-FAST** — `BOUNDARY-6`, reinforced far beyond a single static check by `editor-state-machine.test.tsx`, which asserts no widget-only markup (`data-slide-action`, `cm-slide-boundary`, button/aria-label HTML, `undefined`/`NaN`) leaks into the document after **every single step** of 3×40 randomized action sequences (120+ checks vs. 1).
- Standalone `---` remains in canonical source after all boundary actions.
  - **EXACT-FAST** — `BOUNDARY-7`, reinforced by the property suite's delimiter-count invariant (14+ source shapes) and the state machine's per-step `slideSourceRanges.length === delimiterCount + 1` check.
- `---` inside fenced code / front matter never creates a slide.
  - **EXACT-FAST** — `BOUNDARY-8`/`BOUNDARY-9` (`tests/unit/presentation.test.ts`), reinforced by the "Front matter and fence interaction invariants" `it.each` block in the property suite.
- Typing the third dash on an otherwise empty line creates a slide; an incomplete `--` remains editable text.
  - **EXACT-FAST** — `BOUNDARY-10`/`BOUNDARY-11`, reinforced by the property suite's delimiter-shape table.
- Backspace after a newly inserted boundary follows the documented invariant.
  - **UNSUPPORTED** — `BOUNDARY-12`. Currently **FAILING**: genuine, previously-undocumented implementation bug (delimiter-destroying Backspace right after Add). Note: this is distinct from (and not fixed by) the new "deletes a full slide-boundary delimiter as a single backward step" test in `editor-editing-invariants.test.tsx`, which documents ordinary single-char backspace on an *already-settled* delimiter (passes) — `BOUNDARY-12`'s failure is specific to the Add-then-immediately-Backspace sequence.

## Markdown rendering and source preservation (`MD-*`)

- Headings/paragraphs render with the established slide typography/spacing.
  - **FAST-MODEL** — `MD-1`/`MD-2`: jsdom loads no stylesheet, so only element-type/semantic-level structure is checked; real visual typography is BROWSER-REQUIRED.
- Strong, emphasis, deletion, inline code, fenced code, block quotes, ordered/unordered lists, tables, links preserve exact source across edits.
  - **EXACT-FAST** — `MD-3`–`MD-8`, `MD-13`, `MD-14` (`tests/unit/presentation.test.ts`, pure-domain exact-source assertions), now reinforced by 11 real Markdown syntax snippets (bold/italic/strike, inline code, fences, blockquote, ordered/unordered lists, tables, links/images, TeX) each round-tripped through `insertSlideMarkdown`/`deleteSlideMarkdown`/`replaceSlideMarkdown`/`splitSlideAtSeparator` in `markdown-source-invariants.property.test.ts` (33 assertions total from one table).
- Empty list items can become normal paragraphs.
  - **UNSUPPORTED** — `MD-9`. Currently **FAILING**: genuine implementation gap, contract not yet built.
- Task checkboxes render interactively.
  - **FAST-MODEL** — `MD-10` checks the `<input type=checkbox>` exists and is enabled (structural); the actual toggle *interaction* is separately EXACT-FAST (see `MD-11` below).
- Toggling a task checkbox changes only its Markdown marker.
  - **EXACT-FAST** — same real-dispatch test as the `REVEAL-9` item above.
- Tables render correctly.
  - **EXACT-FAST** — `MD-12` asserts exact row count, header text, and cell values (not just "a `<table>` exists").
- Images render correctly without becoming editable DOM.
  - **FAST-MODEL** — `MD-15` checks `<img>` renders with correct `src`/`alt`; it does not independently verify the widget is excluded from `contentEditable` traversal beyond the widget-decoration pattern shared with math/checkbox widgets.
- Horizontal rules render only when they are not structural slide delimiters.
  - **EXACT-FAST** — `MD-16`, reinforced by the property suite's delimiter-shape table (which explicitly distinguishes real delimiters from look-alike horizontal rules, e.g. `***`, `- - -`, HR-inside-fence).
- Front matter never renders as slide content and remains source-preserving/locally editable.
  - **EXACT-FAST** — pre-existing `MD-17`/`MD-18` tests, reinforced by the property suite's front-matter `it.each` block.
- Presentation theme metadata remains valid after editing.
  - **EXACT-FAST** — `MD-19` (`world-workspace.test.ts`/`editor-session.test.ts`).
- Malformed Markdown remains editable and does not crash rendering.
  - **EXACT-FAST** — `MD-20` (`tests/unit/presentation.test.ts`), massively reinforced by the property suite's dedicated "Malformed input never throws and never silently replaces source" `it.each` block (unterminated fences, unterminated front matter, lone `-`/`--`/`----`, null bytes, huge single line, mismatched brackets, etc.) **and** by `editor-state-machine.test.tsx`, which asserts `parseMarkdown` never throws after every one of 120+ randomized mutation steps — effectively a small fuzz test, not a single fixed example.

## TeX behavior (`TEX-*`)

- Valid inline/display TeX renders with KaTeX.
  - **EXACT-FAST** — pre-existing test using real `katex.renderToString`, reinforced by the property suite's TeX `describe` block, whose expected offsets/validity were verified against real KaTeX via throwaway scratch scripts (not guessed) — e.g. confirming `x^2` is actually *valid* KaTeX.
- Clicking TeX reveals only that formula's exact source; double-clicking selects the exact delimiter-inclusive range.
  - **EXACT-FAST** — pre-existing test, real dispatch + selection assertions.
- Moving away from TeX restores its rendered form.
  - **EXACT-FAST** — `TEX-5`.
- Editing TeX preserves surrounding Markdown.
  - **EXACT-FAST** — `TEX-6`, reinforced by the property suite's TeX-preservation cases.
- Invalid/incomplete TeX remains visible as editable source with a non-blocking error state.
  - **EXACT-FAST** — pre-existing test asserting the `.cm-math-invalid-source` marker plus continued editability; the property suite separately confirms specific invalid cases (`\frac{1}`, `\sqrt{1`, `\notarealcommand`) against real KaTeX.
- Invalid TeX never throws during CodeMirror decoration updates.
  - **EXACT-FAST** — `TEX-10`, plus `RESILIENCE-10`'s forced-throw mock.
- Repeated TeX click/edit/re-render cycles do not duplicate or delete source.
  - **EXACT-FAST** — `TEX-11`, massively reinforced by `SEQ-1`/`SEQ-2` and the state machine's repeated-transition fuzzing.
- Display-math line breaks remain exact across reveal and rerender.
  - **EXACT-FAST** — `TEX-12`, reinforced by the property suite's display-math offset verification.

## Overflow and splitting (`OVERFLOW-*`, `SPLIT-*`)

- Overflow is detected without requiring a slow Tauri E2E run.
  - **EXACT-FAST** — `OVERFLOW-1` (pure function), now reinforced by `GEOM-4`/`GEOM-5` (`editor-interaction-sequences.test.tsx`), which use the `EditorView.prototype.measure(flush)` seam to synchronously flush `fixedPageMeasurements`'s real `requestMeasure` read/write pair against mocked (but deterministic) rect heights — this is the "deterministic geometry seam for overflow measurement" called for in this pass, exercising the real measurement plugin end to end rather than only the pure budget function.
- Overflow warning does not automatically modify source.
  - **EXACT-FAST** — `OVERFLOW-2`.
- Split preview shows the proposed canonical Markdown.
  - **EXACT-FAST** — `SPLIT-1`.
- Canceling split leaves source, selection, and undo history unchanged.
  - **EXACT-FAST** — pre-existing `SPLIT-2` test, reinforced by `GEOM-6`'s repeated preview/cancel cycles (never changes source across N repetitions, not just once).
- Confirming split inserts structural delimiters only at valid boundaries; preserves all original content.
  - **EXACT-FAST** — pre-existing `SPLIT-3` test plus `SPLIT-4` (`tests/unit/presentation.test.ts`).
- Confirming split focuses the newly created slide.
  - **UNSUPPORTED** — `SPLIT-5`. Currently **FAILING**: genuine implementation gap (`replaceDocument` focuses the split slide's own original index, not the new one).
- Split supports top-level heading boundaries; refuses or explains when no safe split point exists.
  - **EXACT-FAST** — `SPLIT-6`/`SPLIT-7` (`tests/unit/presentation.test.ts`).
- Split can be undone once with exact source restoration.
  - **EXACT-FAST** — pre-existing `SPLIT-8` test, reinforced by `GEOM-6`'s repeated preview/confirm/undo/preview/confirm cycle (never duplicates or loses content across repeated transitions) and `SEQ-2` (click/edit/undo restores exact prior source with a valid selection and no duplicated delimiter).
- Split preview remains usable while the editor is scrolled.
  - **FAST-MODEL** — `SPLIT-9` (rewritten this pass): a synthetic `scroll` event no longer just checks the dialog still exists in the DOM (near-tautological in jsdom, which does nothing on scroll); it now also clicks "Confirm split" *after* the scroll and asserts the split actually still executes (slide count increases, dialog closes) — a real functional check that scrolling doesn't corrupt the preview's event wiring. Real visual "stays visible" (`position: sticky`/`fixed` layout) is **BROWSER-REQUIRED** and is not covered by any e2e spec (documented gap).

## Persistence and recovery (`SAVE-*`, `RECOVERY-*`)

- Source changes are persisted in the background after the debounce; rapid typing coalesces into one write.
  - **EXACT-FAST** — `SAVE-1`/`SAVE-2`.
- A failed save retries without blocking editing; never replaces in-memory source with stale content.
  - **EXACT-FAST** — `SAVE-3`/`SAVE-4`, and now closed at the **on-disk write-argument level** (not just in-memory state) by two new tests:
    - **`SAVE-10`** ("a stale retry never overwrites a newer edit, verified by exact writeText call arguments and ordering") — asserts every retry `writeText` call to the settled content path carries the current source, never the failed attempt's stale payload.
    - **`SAVE-11`** ("three back-to-back failures each retry with their own current content, in call order, never swapping payloads") — asserts a sequence of 3 edits with 2 injected failures never interleaves/swaps payloads and the final on-disk content matches the final edit.
- Recovery snapshots are written silently; normal editing never displays a recovery banner; a crash before persistence can recover the latest settled snapshot.
  - **EXACT-FAST** — `RECOVERY-1`/`RECOVERY-2`/`RECOVERY-3` (both `world-workspace.test.ts` and `editor-session.test.ts` for backend parity).
- Successful persistence does not create an intrusive UI state.
  - **EXACT-FAST** — `SAVE-5`.
- Switching presentations flushes or safely queues pending persistence; closing flushes the pending source; renaming does not lose a pending edit.
  - **EXACT-FAST** — `SAVE-6`/`SAVE-7`/`SAVE-8`.
- Browser and Tauri persistence share the same editor behavior.
  - **EXACT-FAST** — `SAVE-9` (both backends tested with the same debounce/retry shape assertions).

## Resilience and accessibility (`RESILIENCE-*`)

- Repeated click, type, undo, preview, and slide navigation never causes a crash.
  - **EXACT-FAST** — `RESILIENCE-1`, and this exact property is now the *organizing principle* of `editor-state-machine.test.tsx`: 3 fixed seeds × 40 weighted-random actions (type/backspace/delete-forward/undo/redo/add-slide/delete-slide/preview-split-confirm-or-cancel) through a real, persistent `EditorView`, with full invariant re-verification after every step, plus a 4th determinism test proving the same seed reproduces byte-identical output across two independent runs.
- Editor focus remains visible without a full-slide outline flash.
  - **BROWSER-REQUIRED** — `RESILIENCE-2`, deferred to `tests/e2e/presentation-mode-and-resilience.spec.ts` (written, not executed this pass): purely CSS-driven, jsdom loads no stylesheet.
- Buttons are keyboard reachable and have stable accessible names.
  - **EXACT-FAST** — `RESILIENCE-3` (real `aria-label` assertions, real tab-order check).
- Slide controls do not intercept ordinary text selection.
  - **EXACT-FAST** — `RESILIENCE-4` (compares real selection/reveal state before vs. after a click, since `event.defaultPrevented` is not a valid signal — CodeMirror's own mousedown handling always calls `preventDefault`).
- Reduced-motion preferences disable decorative transitions; light/dark mode has no cross-theme source surfaces unless actively editing.
  - **BROWSER-REQUIRED** — `RESILIENCE-5`/`RESILIENCE-6`/`RESILIENCE-7`, deferred to `tests/e2e/presentation-mode-and-resilience.spec.ts` (written, not executed this pass): CSS media queries and custom properties, unrunnable in jsdom.
- Empty documents render a usable blank first slide.
  - **EXACT-FAST** — `RESILIENCE-8`.
- Very long slides remain navigable without trapping the caret.
  - **EXACT-FAST** — **re-covered this pass.** The old `RESILIENCE-9` test was removed: it only called `editor.dispatch({selection:{anchor}})` directly and asserted the dispatch took effect, which is a CodeMirror API guarantee, not app behavior, and proved nothing about real caret placement under overflow. Real coverage now comes from `GEOM-1`–`GEOM-4` (`editor-interaction-sequences.test.tsx`), which place the caret via real click coordinates/measurement, including on over-budget/overflowing slides.
- The editor remains usable when KaTeX or Markdown rendering fails.
  - **EXACT-FAST** — `RESILIENCE-10` (real forced `katex.renderToString` throw via `vi.mock`/`vi.hoisted`).

## Presentation mode (`PRESENT-*`)

- Present mode is separate from edit mode; never changes canonical Markdown.
  - **EXACT-FAST** — pre-existing `PRESENT-1`/`PRESENT-6` tests.
- Present mode renders fixed 16:9 pages without editor controls.
  - **FAST-MODEL** — `PRESENT-2` asserts the `hidden` class + `aria-hidden="true"` structural proxy rather than DOM absence, since jsdom does not apply the CSS `display: none` rule that actually hides the live canvas.
- Present mode supports previous/next navigation.
  - **EXACT-FAST** — `PRESENT-3` (real state transitions across all slides).
- Present mode can enter fullscreen when supported.
  - **UNSUPPORTED** — `PRESENT-4`. Currently **FAILING**: genuine implementation gap — no `requestFullscreen` call exists anywhere in the component. Once implemented, the real Fullscreen API contract remains additionally **BROWSER-REQUIRED** (`tests/e2e/presentation-mode-and-resilience.spec.ts`, written, not executed this pass).
- Returning from Present mode restores the prior editor selection.
  - **EXACT-FAST** — `PRESENT-5`.

## Added this pass: interaction-sequence, geometry-seam, and randomized-invariant coverage

These are compound properties that were never single checkbox items above —
they are the specific "chained sequence" and "no-corruption-under-repetition"
guarantees the previous, checkbox-driven pass could not express.

- **EXACT-FAST** — `SEQ-1`/`SEQ-2` (`editor-interaction-sequences.test.tsx`): full click → reveal → caret placement → edit → rerender → click-away chains, asserting exact caret offsets at each step, that neighboring blocks stay rendered throughout, and (for `SEQ-2`) that undo-then-click-away restores the exact prior source with a valid selection and no duplicated delimiter.
- **EXACT-FAST** — `GEOM-1`–`GEOM-6` (`editor-interaction-sequences.test.tsx`): deterministic geometry seams (a mocked `getBoundingClientRect` feeding the real click-mapping code, and the `EditorView.prototype.measure(flush)` seam feeding the real overflow-measurement plugin) for click-to-character mapping, line fallback, slide-boundary click handoff (`GEOM-3` — **intentionally FAILING**, tied 1:1 to the `NAV-1` gap above, documented inline), overflow measurement, and repeated split preview/cancel/confirm/undo cycles.
- **EXACT-FAST** — the randomized state-machine suite (`editor-state-machine.test.tsx`): 3 fixed seeds (`mulberry32`) × 40 weighted-random actions each, plus 1 determinism check, asserting after **every step**: valid selection bounds, `parseMarkdown` never throws, the delimiter-count invariant holds, and no widget-only markup leaks into the source. Deterministic seeds and diagnostics (last 8 action-log entries with before/after doc snapshots) are printed on failure.
- **EXACT-FAST** — the property/table-driven source-invariant suite (`markdown-source-invariants.property.test.ts`, 89 tests): delimiters (14+ shapes), front matter/fence interaction, 11 real Markdown/TeX syntax snippets round-tripped through every model operation, malformed input (never throws), and composed add/delete/undo invariants — each asserting exact resulting source.
- **EXACT-FAST** — `SAVE-10`/`SAVE-11` (`world-workspace.test.ts`): realistic persistence-ordering tests for rapid edits and stale retries, verified at the level of exact `writeText` call arguments and call order, not just final in-memory state.

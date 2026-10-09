# Elef Slide Reveals — Feature Constitution

**Goal:** Implement manual, instantaneous, cumulative reveals within presentation slides on `dev`. Let speakers introduce information in stages without duplicating slides or configuring animation effects.

**Authority:** This document defines feature behavior; repository `AGENTS.md` governs engineering and validation, and `ELEF-DOCTRINE.md` supplies product principles. Read both at the checked-out revision. Surface conflicts instead of guessing. This specification applies to presentation slides, not documents.

## 1. Product contract

- **Appear only (v1).** Each advance shows one reveal event; already visible content stays visible. Backward navigation undoes one event. No automatic timing, transition, fade, movement, disappearance, replacement, or independent toggling.
- **Opt-in.** Unmarked content is visible from slide entry regardless of source position. Decks without `:::step` retain existing behavior.
- **Source first.** The source fully defines reveal groups and sequence. No visual authoring UI in v1.
- **Stable geometry.** Lay out the *complete* slide once; unrevealed content reserves its final space. Reveal state must not move text, columns, headings, or media.
- **One behavior across products.** Web Present and Tauri desktop must reveal the same content on the same clicks. Normal previews, documents, printing, published releases, and existing decks must not regress.

## 2. Source semantics (normative)

### Syntax and association

- Valid directive lines are `:::step` and `:::step{N}`, with `N` one or more ASCII digits (`[0-9]+`). Case-sensitive; at most three **leading spaces** and optional trailing spaces/tabs; the marker occupies its whole line. Four-space-indented code and fenced code/math contents are **not** directives.
- A valid marker attaches to **exactly the next contiguous, nonblank source-line group**. A blank line, a subsequent step marker, an existing scoped-group closure `:::`, or a slide boundary ends the active content group. Ordinary line breaks do not.
- A directive stack may contain recognized compatible directives on consecutive lines before its first content line, with **no intervening blank line**. The stack annotates that same following group, not another directive. For example, `:::step` followed by `:::align{center}` applies both properties. Within existing `:::`-scoped alignment groups, step markers retain the same one-content-group rule; a step does not open or close an alignment scope.
- Multiple step markers in the **same directive stack** refer to the **same** target group, which must reveal only once. If they differ, the *last valid step marker* wins (including unnumbered vs. numbered); emit a warning for conflicting step markers. Stacked/conflicting alignment properties retain their established scope rules; where a property conflicts on the same target, the last value wins. Do not render directive text.
- A marker with no adjacent target (blank line, closing delimiter, or end of slide before content), or malformed syntax, produces an actionable warning and **must not hide unrelated content**. A malformed marker is not silently accepted or displayed as slide content. Preserve adjacent valid directives, source offsets, and content.
- Numbered identifiers are **slide-local labels, not numeric ranks**. Canonicalize by removing leading zeros, retaining `0` for an all-zero label. Thus `{001}` and `{1}` match, `{000}` and `{0}` match. Never convert arbitrary-length labels to bounded JS numbers (or rely on numeric sorting).
- Each plain `:::step` defines a distinct event unless another step marker in its **own stack** supersedes it. All *effective* groups with the same numbered label share one event, including across columns. Assign event ordinals `0,1,...` from the **first source occurrence of each effective event**; values such as `{20}` before `{10}` reveal in that order. Named and unnamed markers may mix. Unused/overridden markers do not reserve events.
- Headings (`#`, `##`, `###`), text, lists, tables, images, and math may share a contiguous reveal group. Headers keep their existing layout role; source order and existing two-/three-column inference determine placement, **not** event order. A stepped H1 title must be revealable. Do not refactor column/subheading inference as part of this feature.
- Preserve existing metadata rules: put slide-level `:::section`/`:::subsection` before reveal directives and `:::footnote` where its current contract requires. Invalid metadata ordering warns instead of silently losing metadata. Do not reinterpret margin directives as reveal content.
- In **document mode**, `:::step` is not a document feature. Preserve the existing document-rendering and warning behavior; do not apply reveal visibility to documents.

### Canonical example

~~~markdown
# La Génération Perdue

## Fitzgerald

:::step{01}
His life

:::step{2}
His books

## Hemingway

:::step{1}
His life

:::step{2}
His books

:::step
Their connection
~~~

| Presenter state | Newly visible |
| --- | --- |
| Open | Title and both column headings (unmarked) |
| Click 1 | Both `His life` groups (`{01}` = `{1}`) |
| Click 2 | Both `His books` groups |
| Click 3 | `Their connection` |

A group can contain multiple Markdown constructs without a blank line:

~~~markdown
:::step
## Fitzgerald
American novelist
- The Great Gatsby
- The Jazz Age
~~~

A blank line is deliberately **functional**. Here, only `- a` is stepped; `- b` is unmarked and visible from the start:

~~~markdown
:::step
- a

- b
~~~

### Stacking and order examples

~~~markdown
:::step{20}
First reveal

:::step
Second reveal

:::step{10}
Third reveal

:::step{20}
Also part of first reveal
~~~

This has **three** events in the order `{20}`, unnamed, `{10}`. The last block appears with the first event. `:::step` followed immediately by `:::align{center}` followed by content is one stepped, center-aligned content group; reversing the two directive lines has the same meaning. Two step markers stacked on one group create one event, with last-valid precedence.

## 3. Presenter state and media

- Assign **canonical event ordinals during parsing**; the controller consumes ordinals and per-slide event counts, **never source labels or DOM traversal order**. Every renderer annotates the corresponding content wrapper, including `.slide-title`. Unmarked blocks have no reveal membership.
- Maintain an integer *revealed-event count* per slide, in `[0, eventCount]`. A newly entered next slide begins at `0`. Advancing reveals the next event before changing slides; after the last event, advance to the next slide. Reversing hides the last event; backing out from `0` enters the prior slide **fully revealed**. At deck boundaries do nothing. `Home` goes to the first slide at `0`; `End` to the final slide fully revealed. Preserve existing keyboard and button mappings.
- Re-render/preview refresh must rediscover current wrappers, preserve the current slide where possible, and **clamp** its saved progress to the new event count. Do not leave stale hidden states. Exiting or stopping Present must remove presentation-only hidden states; re-entering starts at the first slide with `0` events.
- Apply hidden state **only in Present**, preferably via presenter-scoped `visibility: hidden` on the complete content wrapper (not `display: none`); reserved geometry must be unchanged. Hidden content must not receive focus or pointer interaction or be exposed as visible to accessibility APIs. Editor block controls must not remain visible when their associated content is hidden. Restore focusability and visibility on reveal/exit. Normal authoring preview and print show **all** content.
- Videos **without** a step retain existing slide-entry playback behavior. A video in an unrevealed group must not receive `play()` until that event is revealed. On reveal, attempt playback subject to browser restrictions; navigating away/exit pauses according to the existing media lifecycle. The same policy applies to any other auto-activated media as appropriate; do not broaden media features.
- Use one final slide in PDF/print, not a page per event. Ordinary documents and historical published-release sources retain their expected behavior. No animation effects in PPTX export are required in v1.

## 4. Implementation boundary (evidence-backed)

**Verified on public `dev` (2026-10-09), subject to branch drift.** These are entry points, not a prescribed new architecture. Trace the live call graph before editing.

| Entry point / existing behavior | Implication |
| --- | --- |
| [`app/controllers/presentations_controller.rb`](https://github.com/Hansespinosa2/elef/blob/dev/app/controllers/presentations_controller.rb) `present`; [`app/views/presentations/present.html.erb`](https://github.com/Hansespinosa2/elef/blob/dev/app/views/presentations/present.html.erb) renders `_slide` | **Web Present uses Rails views; JS preview parity alone is insufficient.** |
| [`app/lib/source/document.rb`](https://github.com/Hansespinosa2/elef/blob/dev/app/lib/source/document.rb) `parse`, `slide_metadata`, `parse_blocks`, `markdown_blocks`, `column_regions`; [`app/views/presentations/_slide.html.erb`](https://github.com/Hansespinosa2/elef/blob/dev/app/views/presentations/_slide.html.erb) title and block wrappers | Ruby source structure and ERB output both need event metadata; annotate `.slide-title` and `.slide-block`. `_slide` currently calls `slide.blocks.index(block)`; duplicate-valued blocks must not be conflated when assigning events. |
| [`app/javascript/lib/document_map.js`](https://github.com/Hansespinosa2/elef/blob/dev/app/javascript/lib/document_map.js) `buildEditorStructure`, `editorBlocks`, `parseBlocks`, source boundary logic | Keep editor map/source ranges aligned with parsed blocks. Existing unknown-directive and alignment paths need explicit step/stack handling. |
| [`app/javascript/lib/renderer.js`](https://github.com/Hansespinosa2/elef/blob/dev/app/javascript/lib/renderer.js) `renderPreview` / `renderPresentation` | JS rendering matches mapped and parsed blocks by index; emit event annotation **even if editor-map editability validation fails**. |
| [`app/lib/source/javascript_renderer.rb`](https://github.com/Hansespinosa2/elef/blob/dev/app/lib/source/javascript_renderer.rb) `resolve_art_bindings`, `editor_map`, `editor_preview`, MiniRacer bundle | Shared JS parses in both browser/worker and MiniRacer. Keep parser/renderer logic DOM-free; build the renderer bundle. Ruby may consume shared boundary data, but must still match event assignments. |
| [`app/javascript/lib/presentation_navigation.js`](https://github.com/Hansespinosa2/elef/blob/dev/app/javascript/lib/presentation_navigation.js); [`app/javascript/controllers/presentation_controller.js`](https://github.com/Hansespinosa2/elef/blob/dev/app/javascript/controllers/presentation_controller.js) | Extend the existing navigation state/controller; its current `showCurrentSlide` plays videos as soon as a slide activates. |
| [`app/javascript/lib/preview_sanitizer.js`](https://github.com/Hansespinosa2/elef/blob/dev/app/javascript/lib/preview_sanitizer.js) `safeAttribute`; [`app/assets/stylesheets/components/slides.css`](https://github.com/Hansespinosa2/elef/blob/dev/app/assets/stylesheets/components/slides.css) | New ordinal metadata must survive sanitization with a narrow safe attribute policy; keep hidden-state CSS presenter-scoped. |
| [`app/views/presentations/print.html.erb`](https://github.com/Hansespinosa2/elef/blob/dev/app/views/presentations/print.html.erb); [`app/models/presentation_release.rb`](https://github.com/Hansespinosa2/elef/blob/dev/app/models/presentation_release.rb) `presentation` | Print uses the Rails slide partial. Published releases replay pinned **source revisions**, not pre-rendered slide HTML; preserve compatibility with old sources. |
| [`docs/architecture.md`](https://github.com/Hansespinosa2/elef/blob/dev/docs/architecture.md); [`AGENTS.md`](https://github.com/Hansespinosa2/elef/blob/dev/AGENTS.md) | Rails `app/` owns shared frontend behavior; desktop consumes it. No parallel Tauri renderer or new rendering system. |

**Implementation direction (proposal):** Extend existing Ruby/JS block metadata with an optional `reveal_event` ordinal. Parse/resolve directive stacks and source groups once per path; canonicalize numeric labels as strings; assign ordinals by first effective occurrence per slide. Carry metadata through title/regions to Ruby ERB and JS HTML wrappers (e.g., `data-elef-reveal-event="0"`). Use the existing Stimulus controller for progress, visibility, focus/media lifecycle. Do not infer ordinals by traversing DOM nodes; do not put DOM operations in shared parser/renderer code. A common fixture/contract should define both implementations' output shape; they need not be identical source implementations.

**Rendering paths to trace and record before coding:** Rails web Present (`Source::Document` → view), Rails/editor preview (`JavascriptRenderer`/MiniRacer), browser or worker JS preview, desktop static host and worker, print, and any legacy/rollback renderer. The architecture describes a legacy Ruby renderer as an explicit rollback path; verify its actual reachability. **Policy:** if a legacy fallback is used for step-bearing decks, either implement correct reveals there or explicitly reject/report that fallback as unsupported for steps; never silently show incorrect sequence. The current web Present Ruby path is **not optional**.

## 5. Verification (all required)

1. **Before editing:** Capture golden baselines for representative *unchanged* decks' rendered HTML and editor maps from the unmodified base commit, independent of the new parser. Assert exact/appropriately normalized equality after implementation. Preserve preexisting test baselines instead of regenerating them from new output.
2. **Shared parsing fixtures:** Compare Ruby and JS **canonical per-block event ordinal assignments**, content/source mapping, warnings, and per-slide event counts. Cover no-step sources; `{01}`/`{1}`, `{0}`/`{000}`, enormous identifiers; `{20}` before `{10}`; mixed plain/numbered; repeated labels across columns and reused labels on different slides; overwritten/stacked markers; block boundaries; blank-separated list items; escaped/fenced/indented code and math fences; CRLF; leading spaces; malformed/orphan directives; alignment ordering, scoped closure, and margin metadata.
3. **Render coverage:** Assert event attributes on ordinary blocks, column blocks, art/media blocks, and stepped H1 `.slide-title` in **both** Ruby `_slide.html.erb` web Present and JS `renderPresentation`. Verify correct map index alignment, event metadata despite invalid editability projection, no leaked directive text, and survival through `installSanitizedPreview` (including post-install DOM).
4. **Navigation:** Deterministic DOM tests of next/previous, multiple objects in one event, zero-step slides, slide boundary reverse, first/last and `Home`/`End`, repeated entry, exit/re-enter, slide edits/refresh with clamped progress, and restored focus/visibility. Keep presenter controls and mappings functional.
5. **Visual/media/export:** For representative one-/two-/three-column slides, assert identical block bounding boxes before/after reveals (not merely same element count), including headers. Test hidden focusable links and editor controls, full print/PDF visibility, video **no premature `play()`**, playback attempt on reveal, and pause on leave. Normal preview/docs must show expected content and warnings; published old-source release remains compatible.
6. **End to end:** Update or add a Rails-owned shared scenario under `test/e2e/scenarios/`; verify actual reveal progression in **web Present and real desktop**, not just slide navigation. Test relevant Ruby present/print paths and the desktop worker/preview path. Browser and native tests are distinct evidence.
7. **Repository gates:** Inspect live `AGENTS.md` and package scripts; run focused Ruby/JS tests, renderer build, Rails browser/system tests, architecture/frontend ownership checks, desktop frontend build, and relevant shared E2E parity harness/CI. Rebuild generated assets and inspect diff. Confirm exact commands in the checkout instead of relying on line-numbered guesses.

## 6. Execution and boundaries

1. Read the current repository rules, trace all entry points above, verify the legacy fallback and release behavior, and capture no-step golden baselines **before** modifying anything.
2. Implement the smallest coherent change inside existing modules. Preserve canonical Markdown source, source offsets, existing column/layout behavior, output sanitization, unrelated document behavior, and existing deck semantics. Do not invent new renderers or duplicate desktop UI. If code reality conflicts with a feature rule, report the conflict rather than silently changing it.
3. Add deterministic tests, shared parity fixtures, and concise **user-facing source syntax documentation** covering blank lines, grouping, identifier reuse, stacked directives, and reverse navigation. Follow `AGENTS.md` for live ports, test data, builds, and PR workflow.
4. Re-run relevant checks after the final edit; commit coherent changes on a feature branch from `dev`, open a PR targeting `dev`, and **do not merge** without permission.

## Out of scope

Disappearance, replacement, independent toggling, timing, fades, movement, sub-block/per-word animations, animation authoring UI, intermediate PDF pages, PPTX animation effects, unrelated renderer refactors, or changing column inference.

## Done

The same Markdown produces the same reveal events and interactive sequence in web Present and desktop, while all normal-preview, document, print, release, media, and no-step regression checks pass—and the verification record honestly distinguishes tested from unverified surfaces.

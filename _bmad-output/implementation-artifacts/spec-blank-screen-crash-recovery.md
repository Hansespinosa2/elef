---
title: 'Recover from blank-screen editing crashes'
type: 'bugfix'
created: '2026-08-18'
status: 'done'
review_loop_iteration: 0
baseline_commit: '72bc4c085954687211d2cb716df9a1fd311892b6'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Editing a slide in Tauri can leave the application window dark or blank, most likely after a source mutation causes parsing to throw during the next React render. The current failure surface hides the exception and provides no evidence for diagnosing the trigger.

**Approach:** Add a recoverable React failure surface and local diagnostics first, trace the complete source-mutation path, then fix the earliest confirmed invariant and lock it down with controlled rerender tests.

## Boundaries & Constraints

**Always:** Preserve Markdown as the source of truth; preserve typed `---`, empty-slide Backspace deletion, Undo, themes, autosave, browser behavior, and Tauri persistence. Diagnostics must avoid recording document contents and must surface errors locally. Failed parsing or persistence must not silently discard in-memory edits.

**Ask First:** Retaining verbose diagnostic details in production builds beyond the recoverable error screen; adding any remote telemetry or changing the existing persistence/error UX.

**Never:** Swallow exceptions, add broad catches with success-shaped fallbacks, change Markdown semantics to hide the bug, or refactor unrelated presentation/workspace behavior before a reproduction is captured.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|-----------------------------|----------------|
| EDIT_SPLIT | Type the third `-` on an otherwise empty line | Source keeps `---`; preview rerenders with a new slide | Show a diagnostic state if any render/update fails |
| EDIT_DELETE | Press Backspace on an empty non-first slide | Slide is removed and replacement slide remains editable | Preserve source and expose the error if update fails |
| RAPID_EDIT | Perform split/delete followed immediately by more edits | Source, parsed presentation, and rendered state stay coherent | No blank window; report the first exception if one occurs |
| INVALID_PARSE | A source mutation reaches the parser with invalid data | Editor remains recoverable and current source is retained | Surface a local actionable error |
| STARTUP_FAILURE | React or an async handler fails outside editing | App shows recovery details instead of an empty shell | Capture `window.onerror`/`unhandledrejection` locally |

</frozen-after-approval>

## Code Map

- `src/main.tsx:5` -- React bootstrap; wrap the application entry in the recoverable failure surface.
- `src/App.tsx:112,180-182` -- subscribes to workspace state and calls `world.presentation()` during render; preserve existing visible error states while preventing uncaught render failures.
- `src/components/PresentationPreview.tsx:410-415,462-494,621,654` -- source mutation paths for normal edits, typed separators, empty-slide deletion, Delete, and Add; add only diagnostic context needed to isolate transitions.
- `src/application/world/workspace.ts:205-215,251` -- `updateSource()` publishes state and `presentation()` reparses source; reuse existing workspace error-state and persistence recovery patterns.
- `src/application/presentation-editor/session.ts:60-70` -- existing parse-error handling pattern for retaining source and exposing an error; reuse its narrow error normalization.
- `src/domain/presentation/markdown.ts:116-118` -- parser contract and throw conditions; do not alter semantics unless the captured root exception proves a domain invariant is wrong.
- `tests/integration/presentation-preview.test.tsx` -- existing controlled preview harness; extend it so source updates cause a real parent rerender.
- `tests/unit/` workspace/presentation tests -- cover the confirmed parser/state invariant without coupling domain tests to React or Tauri.
- `package.json` -- existing test/build scripts; do not add tooling.

## Tasks & Acceptance

**Execution:**
- [x] `src/main.tsx` and a focused error-surface component -- add a recoverable React error boundary plus local `window.onerror` and `unhandledrejection` reporting -- replace the opaque blank window with actionable diagnostics.
- [x] `src/components/PresentationPreview.tsx`, `src/App.tsx`, and `src/application/world/workspace.ts` -- add development-gated transition tracing and fix the earliest confirmed failure invariant while preserving source/error recovery -- make the actual crash path observable and safe.
- [x] `tests/integration/presentation-preview.test.tsx` and relevant `tests/unit/` files -- reproduce the failing mutation through a controlled parent rerender and test the root fix -- prevent regression without changing product semantics.

**Acceptance Criteria:**
- Given a runtime exception during rendering or an async interaction, when the failure occurs, then the user sees a recovery screen with local error details instead of only a dark/blank window.
- Given the typed-separator, empty-slide-Backspace, Add, or Delete flows, when each is repeated through a controlled parent rerender, then the source and rendered slides remain coherent and no exception is thrown.
- Given a parser or persistence failure, when the update fails, then the current in-memory source is retained and an actionable error is surfaced.
- Given diagnostics are enabled, when a mutation is traced, then logs identify the action and transition phase without including presentation contents.

## Design Notes

The first implementation pass must instrument before changing parser semantics. If the confirmed exception is in `world.presentation()`, use the existing editor-session pattern to retain source and set an explicit workspace error; do not return a fabricated presentation. The boundary is defense-in-depth, not a substitute for fixing the root invariant.

## Verification

**Commands:**
- `npm test -- --run tests/unit tests/integration/presentation-preview.test.tsx` -- expected: targeted regression coverage passes.
- `npm run build` -- expected: TypeScript and production build complete successfully.
- `git diff --check` -- expected: no whitespace errors.

**Manual checks:**
- Run the Tauri app and repeat typed `---`, empty-slide Backspace, rapid edits, Add/Delete, reopen, and both themes. Expected: no opaque blank window; any forced failure shows recovery details.

## Suggested Review Order

**Recovery surface**

- The bootstrap now keeps render and global async failures visible instead of leaving an empty shell.
  [`main.tsx:6`](../../src/main.tsx#L6)

- Local diagnostics expose actionable details while production output remains concise.
  [`RecoverableErrorBoundary.tsx:15`](../../src/components/RecoverableErrorBoundary.tsx#L15)

**Source and presentation safety**

- Mutations validate derived presentation state before publishing and retain failed source edits.
  [`workspace.ts:205`](../../src/application/world/workspace.ts#L205)

- Rendering reports parse failures without fabricating a presentation or discarding source.
  [`App.tsx:180`](../../src/App.tsx#L180)

- Development-only transition logs identify mutation phases without document contents.
  [`PresentationPreview.tsx:410`](../../src/components/PresentationPreview.tsx#L410)

**Regression coverage**

- Controlled parent rerenders exercise rapid slide additions against canonical source.
  [`presentation-preview.test.tsx:122`](../../tests/integration/presentation-preview.test.tsx#L122)

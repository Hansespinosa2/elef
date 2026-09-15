---
title: 'Add a live Markdown editor'
type: 'feature'
created: '2026-08-17'
status: 'done'
baseline_commit: '3e31fee51d0046ebbf47329036f17571dcb91d61'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current Elef app can open and preview Markdown, but it has no way to create or edit a presentation inside the app. This makes the renderer difficult to evaluate because every test requires preparing a file externally.

**Approach:** Add a New Markdown action and a simple source editor beside the existing slide preview. Keep one active presentation context, track its last opened/new baseline, and re-parse the raw Markdown as it changes so the preview remains a direct projection of the source. New replaces the active context only after warning about unsaved edits.

## Boundaries & Constraints

**Always:** Preserve the existing `---` slide convention and parser behavior; keep the renderer core framework-agnostic; make the editor usable in both browser and Tauri runtimes; show the untitled state clearly; keep source and preview synchronized; retain existing file-open and error behavior; maintain one active presentation context; compare edits against the last opened/new baseline.

**Ask First:** Adding tabs or a document switcher, autosave, file persistence, save dialogs, collaborative editing, syntax highlighting, or a component DSL.

**Never:** Replace the Markdown source of truth with canvas geometry; change the parser contract; add a backend, database, Rails runtime, or visual drag editor; silently discard loaded source when switching documents.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| NEW_DOCUMENT | User clicks New Markdown with no unsaved edits | Editor clears to an untitled blank document and preview shows one empty slide | N/A |
| LIVE_EDIT | User types valid Markdown or adds `---` | Preview updates to the corresponding ordered slides | N/A |
| INVALID_SOURCE | Editor contains malformed or unsupported Markdown | Editor remains editable and preview shows the parser's existing safe result | Do not crash or lose source |
| OPEN_EXISTING | User opens a local Markdown file | Editor displays the file source and preview matches it | Existing load errors remain actionable |
| DIRTY_REPLACEMENT | User edits source, then clicks New Markdown | Existing source remains until replacement is confirmed | Warn that unsaved edits will be discarded; cancel preserves source |

</frozen-after-approval>

## Code Map

- `src/App.tsx:12-76` -- owns the active document, baseline/dirty state, file loading, toolbar actions, and preview composition.
- `src/core/markdown.ts:9-43` -- existing parser to reuse on every source update.
- `src/core/document.ts` -- shared dirty-state predicate for safe document replacement.
- `src/core/presentation.ts:1-10` -- stable presentation and slide types.
- `src/components/PresentationPreview.tsx:10-25` -- existing preview projection; keep its public contract.
- `src/app.css:4-14` -- toolbar and responsive application layout.
- `src/components/MarkdownEditor.tsx` -- new controlled source editor component.
- `src/components/MarkdownEditor.css` -- editor layout and readable source styling.
- `src/core/markdown.test.ts` -- parser regression coverage; add tests for editor-facing document transitions where practical.

## Tasks & Acceptance

**Execution:**
- [x] `src/components/MarkdownEditor.tsx`, `src/components/MarkdownEditor.css` -- add a controlled Markdown textarea with an accessible label and responsive layout -- provide the source editing surface.
- [x] `src/App.tsx`, `src/core/document.ts` -- add New Markdown action, raw source state, baseline/dirty tracking, replacement confirmation, live parse synchronization, and existing-file hydration -- connect the editor to the current preview without changing file-open semantics.
- [x] `src/app.css` -- style the editor/preview workspace and keep the toolbar usable on narrow screens -- preserve the existing visual language.
- [x] `src/core/markdown.test.ts` -- cover blank-document and multi-slide source transitions plus dirty-state decisions -- protect the parser contract used by live editing.

**Acceptance Criteria:**
- Given the app is open with no unsaved edits, when the user clicks New Markdown, then the editor is empty, the document is labeled untitled, and the preview shows one empty slide.
- Given the editor contains Markdown, when the user types or adds a `---` separator, then the preview updates to the matching content and slide count.
- Given the editor contains malformed or unsupported Markdown, when the user continues typing, then the source remains intact and the app does not crash.
- Given an existing Markdown file is opened, when loading completes, then its source appears in the editor and its preview remains equivalent to the current behavior.
- Given the source differs from its last opened/new baseline, when the user clicks New Markdown, then Elef warns before discarding it and canceling preserves the source.
- Given a narrow window, when the editor and preview are displayed, then both remain usable without overlapping or making the source inaccessible.

## Verification

**Commands:**
- `npm test` -- expected: all parser and editor-facing tests pass.
- `npm run build` -- expected: TypeScript and browser production build complete successfully.

**Manual checks:**
- Start `npm run dev`, click New Markdown, type Markdown with `---`, and confirm live slide updates.
- Open an existing `.md` file and confirm its source appears without changing its rendered slides.

## Suggested Review Order

**Application workflow**

- Start with the state model and replacement safeguards for the active document.
  [`App.tsx:14`](../../src/App.tsx#L14)

- Review New Markdown replacement and stale-request protection.
  [`App.tsx:37`](../../src/App.tsx#L37)

- Review file hydration and error-preserving load behavior across runtimes.
  [`App.tsx:58`](../../src/App.tsx#L58)

**Editor and preview binding**

- Follow controlled source updates into the existing parser and preview.
  [`App.tsx:48`](../../src/App.tsx#L48)

- Inspect the accessible textarea and slide-separator guidance.
  [`MarkdownEditor.tsx:8`](../../src/components/MarkdownEditor.tsx#L8)

- Check the responsive two-column workspace and narrow-screen fallback.
  [`app.css:12`](../../src/app.css#L12)

**Supporting contracts**

- Verify the small dirty-state predicate used by replacement guards.
  [`document.ts:1`](../../src/core/document.ts#L1)

- Review parser-facing coverage for blank and multi-slide editor sources.
  [`markdown.test.ts:16`](../../src/core/markdown.test.ts#L16)

---
title: 'Migrate to an Obsidian-style Markdown editor'
type: 'feature'
created: '2026-08-18'
status: 'done'
baseline_commit: 'f106bbb7a8c1f919baad987ed1fc34359e50c2e2'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef currently places React-rendered Markdown and KaTeX inside a whole-slide `contentEditable`. Browser editing mutates React-owned DOM, producing `insertBefore` crashes, lost or duplicated TeX, and unreliable transitions between preview and source editing.

**Approach:** Replace the DOM editor with one CodeMirror 6 document that owns text, selection, undo, and redo. Render slides as distinct fixed 16:9 visual pages within that continuous editor, using inline Markdown/TeX decorations and widgets while preserving canonical Markdown source.

## Boundaries & Constraints

**Always:** Keep Markdown source canonical and portable. Preserve standalone `---` as Elef's structural slide delimiter, including fenced-code and front-matter rules. Use one editor document and one history, while presenting clear per-slide pages, gaps, labels, Add/Delete controls, and seamless scrolling. Reveal TeX source when the caret enters it; double-click selects the formula. Keep malformed or incomplete TeX visible and editable with a small error state; never delete or silently replace it. Autosave after edits settle and retain periodic local recovery snapshots. Keep browser and Tauri behavior consistent, preserve themes, math display modes, accessibility focus, and existing slide-boundary navigation.

**Ask First:** None. The editor foundation, continuous document model, fixed slide pages, unified editing surface, Obsidian-style TeX behavior, autosave/recovery approach, and `---` boundary behavior are approved decisions.

**Never:** Do not keep a whole React-rendered slide `contentEditable`. Do not use a second textarea as the primary editing path. Do not make rendered KaTeX independently editable DOM. Do not rewrite or hide `---` in the saved Markdown. Do not require valid TeX before saving. Do not introduce platform-specific editor behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| INLINE_TEX | Caret enters `$x^2$` | Rendered math reveals its source without changing surrounding text | Preserve exact source and selection |
| DISPLAY_TEX | Caret enters `$$...$$` | Display formula reveals editable source and restores rendering after exit | Preserve delimiters and line breaks |
| INVALID_TEX | Incomplete or invalid TeX | Raw source remains visible/editable with an error state | Never throw, delete, or duplicate source |
| SLIDE_BOUNDARY | Caret or click reaches standalone `---` | Boundary behaves as a slide gap; Add creates/focuses a blank slide there | Keep delimiter in canonical source |
| AUTOSAVE | User pauses after an edit | Source persistence occurs after a debounce, not on every keystroke | Surface persistence errors and retain recovery snapshot |
| RECOVERY | App closes before normal persistence completes | Recovery snapshot remains available without blocking ordinary startup | Allow explicit restore or discard |
| RECONCILIATION | Repeated click, edit, preview, and slide navigation | DOM remains stable and no React placement crash occurs | Preserve source and report recoverable errors |

</frozen-after-approval>

## Code Map

- `src/components/PresentationPreview.tsx` -- current whole-slide `contentEditable`, KaTeX rendering, serialization, source textarea mode, and slide navigation; replace DOM editing ownership while preserving slide actions and boundary behavior.
- `src/components/PresentationPreview.css` -- current fixed slide pages, scaling, gaps, and editing styles; add CodeMirror surface and inline widget states without changing presentation layout semantics.
- `src/domain/presentation/markdown.ts` -- canonical front-matter, fenced-code-aware slide parsing and transformations; reuse as the document/slide boundary model.
- `src/domain/presentation/presentation.ts` -- current slide and presentation shapes; extend only if editor state needs stable source ranges or recovery metadata.
- `src/application/world/workspace.ts` -- Tauri/browser source updates and persistence boundary; add debounced save and recovery snapshots without changing portable file format.
- `src/App.tsx` -- supplies canonical source and persistence callbacks to the preview; keep platform-neutral integration.
- `tests/integration/presentation-preview.test.tsx` -- current jsdom coverage for math serialization, source mode, focus, and slide behavior; replace brittle DOM-editing expectations with editor behavior coverage.
- `tests/unit/presentation.test.ts` -- parser and Markdown transformation coverage; add delimiter/range invariants needed by the continuous editor.
- `package.json` -- add CodeMirror 6 packages and any existing test integration needed for the editor surface.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` and lockfile -- add CodeMirror 6 editor dependencies -- establish the source-backed editing foundation.
- [x] `src/components/PresentationPreview.tsx` and related editor module -- implement one continuous CodeMirror document with fixed slide page widgets, inline Markdown decorations, TeX reveal/edit behavior, unified history, and slide controls -- eliminate React/contentEditable ownership conflicts.
- [x] `src/application/world/workspace.ts` and `src/App.tsx` -- debounce canonical source persistence and retain periodic recovery snapshots -- match approved autosave behavior in browser and Tauri.
- [x] `src/components/PresentationPreview.css` -- style editor pages, inline TeX states, invalid-TeX state, slide boundaries, and keyboard focus -- preserve the current presentation layout.
- [x] `tests/unit/presentation.test.ts` -- cover slide delimiter and source-range invariants -- protect canonical Markdown.
- [x] `tests/integration/presentation-preview.test.tsx` -- cover TeX editing, malformed TeX, slide boundaries, autosave, and repeated focus transitions -- prevent regressions.
- [x] `tests/integration/presentation-preview.test.tsx` -- include repeated TeX click/edit/preview transitions and crash-free rendering in the fast test suite -- make the primary regression signal deterministic and inexpensive.

**Acceptance Criteria:**
- Given a rendered TeX expression, when the caret enters or the formula is double-clicked, then its exact Markdown source becomes editable in place and surrounding content remains unchanged.
- Given invalid or incomplete TeX, when the document renders, then Elef remains usable and preserves the raw source with an error state.
- Given repeated edits, clicks, preview transitions, and slide navigation, when React renders updates, then no DOM placement crash occurs and source is neither duplicated nor deleted.
- Given a standalone `---`, when the caret reaches its boundary, then Elef treats it as a slide delimiter and Add creates/focuses a blank slide without removing the delimiter.
- Given a paused edit, when the debounce elapses, then canonical source is persisted and a recovery snapshot is retained according to the approved policy.
- Given browser or Tauri mode, when the editor is used, then the shared editor behavior remains platform-neutral; Tauri E2E is an optional smoke check, not the primary acceptance gate.

## Design Notes

Use one CodeMirror state/view as the editing authority. Slide pages should be visual block widgets or decorations derived from the same document, not separate editors. The implementation may migrate in phases, but the old whole-slide `contentEditable` must not remain active alongside the new editor for the same content.

## Verification

**Commands:**
- `npm test` -- expected: all unit and integration tests pass.
- `npm run build` -- expected: TypeScript and production build pass.
- `npm run test:e2e -- --mochaOpts.grep='TeX|math|slide boundary'` -- optional smoke check only, run when a real-WebView-specific issue is suspected; it must not gate normal implementation iterations.
- `git diff --check` -- expected: no whitespace errors.

## Suggested Review Order

**Editor architecture**

- The preview now delegates editing ownership to one continuous CodeMirror document.
  [`PresentationPreview.tsx:493`](../../src/components/PresentationPreview.tsx#L493)

- Source ranges, history, TeX widgets, and boundary navigation share one editor state.
  [`ObsidianStyleEditor.tsx:1`](../../src/components/ObsidianStyleEditor.tsx#L1)

**Canonical Markdown and persistence**

- Slide ranges preserve front matter, fenced separators, and exact delimiter boundaries.
  [`markdown.ts:32`](../../src/domain/presentation/markdown.ts#L32)

- Debounced saves and recoverable snapshots cover both workspace and browser editing paths.
  [`workspace.ts:42`](../../src/application/world/workspace.ts#L42)

- Recovery actions are exposed at the application boundary without changing portable Markdown.
  [`App.tsx:180`](../../src/App.tsx#L180)

**Verification**

- Integration coverage exercises CodeMirror mounting, TeX rendering, malformed source, and slide controls.
  [`presentation-preview.test.tsx:10`](../../tests/integration/presentation-preview.test.tsx#L10)

- Unit coverage protects source ranges and recovery restoration.
  [`presentation.test.ts:131`](../../tests/unit/presentation.test.ts#L131)

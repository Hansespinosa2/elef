---
id: SPEC-editor-ux-recovery
companions:
  - behavior-matrix.md
sources: []
---

# Recover slide editor UX with CodeMirror

## Why

Elef needs to retain CodeMirror's reliable document ownership, history, TeX
editing, keybindings, autosave, and recovery while restoring the polished slide
editing experience and behavioral coverage lost during the migration. The
current implementation is technically test-green but fails the user's basic
interaction expectations: clicking and navigating reveal too much source,
visual slide surfaces are inconsistent, and important pre-migration behavior is
not protected by tests.

## Capabilities

- **CAP-1**
    - **intent:** Users can edit canonical Markdown inside coherent slide-shaped
    surfaces while rendered content remains visually stable.
    - **success:** A browser smoke test can click, type, select, undo, and navigate
    across multiple slides without source duplication, deletion, or layout
    corruption.
- **CAP-2**
    - **intent:** Users can reveal only the Markdown line or structured unit they
    need while neighboring content remains rendered.
    - **success:** Integration tests prove that heading, paragraph, list, quote,
    code, and TeX interactions reveal the smallest expected source range.
- **CAP-3**
    - **intent:** Users can create, delete, navigate, split, and undo slides
    without losing canonical delimiters or content.
    - **success:** Model and integration tests cover slide-boundary invariants,
    overflow split preview/confirmation, exact undo, and one-slide deletion.
- **CAP-4**
    - **intent:** Users can edit common Markdown and TeX constructs while
    preserving exact portable source.
    - **success:** Serialization and interaction tests cover headings, lists,
    tasks, quotes, tables, links, code, inline/display TeX, and malformed TeX.
- **CAP-5**
    - **intent:** Elef saves settled edits in the background and protects recent
    work without requiring save-related user decisions.
    - **success:** Persistence tests prove debounce, retry, stale-write
    protection, silent recovery, and flush-on-close behavior.
- **CAP-6**
    - **intent:** Users can switch between editing and full-screen presentation
    without changing source or losing editor context.
    - **success:** Presentation-mode tests prove fixed 16:9 rendering,
    navigation, fullscreen support, and selection restoration.

## Constraints

- CodeMirror remains the canonical authority for source, selection, history,
  undo/redo, keybindings, and persistence callbacks.
- Whole-slide `contentEditable` is prohibited.
- React-rendered visual DOM must never be directly mutated by browser editing.
- Edit mode remains visually slide-oriented; Present mode owns playback and
  fullscreen behavior.
- Rendered widgets are read-only projections; every widget interaction dispatches
  an explicit CodeMirror source transaction.
- Simple Markdown reveals locally; fenced code, display math, tables, and other
  inherently multi-line constructs reveal as bounded structured units.
- Rendered clicks use best-effort character mapping with deterministic
  line/structured-unit fallback when exact mapping is unavailable.
- ArrowUp/Down remains native within a slide and hands off only at the true first
  or last visual line of a slide.
- Standalone `---` remains canonical structural Markdown and is ignored inside
  front matter and fenced code.
- Other horizontal-rule syntax remains available; standalone `---` is never a
  horizontal rule in Elef.
- Overflow stays in the editing flow with an inline scrollbar and small,
  non-blocking warning; splitting is explicit and deferred.
- The newest in-memory source is authoritative during persistence; debounced
  saves are sequenced, retries never overwrite newer edits, and close/switch
  flushes or safely queues the latest source.
- Rendering failures preserve raw source and show a non-blocking fallback state;
  they never throw or replace source.
- Ordinary editing keeps the canvas clean; add/delete affordances appear at
  focused boundaries, split controls appear only for overflow, and global
  actions remain in a small toolbar.
- Malformed Markdown and TeX remain editable and cannot crash or silently
  replace source.
- Fast model/integration tests are the primary development gate; Tauri E2E is
  targeted WebView smoke coverage.

## Non-goals

- Replacing CodeMirror with another editor.
- Requiring every edit iteration to run the full Tauri E2E suite.
- Introducing a second portable document format.
- Automatically splitting overflowing slides without explicit confirmation.
- Recreating every Obsidian feature unrelated to slide authoring.

## Success signal

The recovered editor feels like the previous Elef slide editor while retaining
CodeMirror reliability: users can click into a slide, make ordinary edits,
navigate boundaries, edit TeX, undo, and split overflow without seeing
unexpected source exposure, scroll traps, duplicated content, or crashes. The
behavior matrix is implemented as red tests first and reaches green across
model, integration, and targeted browser smoke layers.

## Assumptions

- The existing pre-migration integration test file is the authoritative
  inventory of lost editor behaviors.
- Current user-owned changes in `tests/e2e/arrow-navigation.spec.ts` remain
  separate from this recovery effort.

## Open Questions

- Which visual mapping heuristics best approximate character positions inside
  complex tables and display-math layouts?

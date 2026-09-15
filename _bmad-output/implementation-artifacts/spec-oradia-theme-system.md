---
title: 'Add the Oradia theme system'
type: 'feature'
created: '2026-08-17'
status: 'done'
baseline_revision: 'b14bbf19ab75c6c1a5ad1fc31b8a9b7dd0b76641'
baseline_commit: 'b14bbf19ab75c6c1a5ad1fc31b8a9b7dd0b76641'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Elef currently has hard-coded blue-gray editor styling and a light-only presentation canvas, so the product has no coherent visual identity or way to adapt editor and presentation appearance to user preferences.

**Approach:** Add semantic theme tokens with two built-in variants, Oradia Slate and Oradia Paper. Keep editor mode global per device and presentation mode per document, defaulting presentations to match the editor while allowing an explicit light/dark override stored in front matter.

## Boundaries & Constraints

**Always:** Preserve existing layout, interactions, Markdown source-of-truth, browser single-file behavior, and Tauri World autosave. Use Oradia's quiet slate-graphite and green-forward hierarchy as the palette core, tuning only for contrast. Editor mode follows the OS preference by default and reacts live to OS changes; explicit editor Light/Dark selection persists per device. Presentation mode defaults to `match` and supports `match`, `light`, and `dark`; the UI writes `presentationTheme: match|light|dark` into an initial YAML front-matter block and leaves it visible/editable. The theme menu is compact and available in browser and Tauri headers. Invalid or absent presentation metadata safely resolves to `match`.

**Block If:** Implementation requires changing the existing slide separator contract, hiding or rewriting user-authored front matter, adding a dependency not already available without a clear need, or requires choosing a third presentation theme/mode not covered by the confirmed contract.

**Never:** Add arbitrary user-authored themes, syntax highlighting, a settings subsystem, per-world editor preferences, or a redesign of the current navigation/editor workflow. Do not make presentation theme selection silently non-portable or store it only in local app state.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| SYSTEM_EDITOR_MODE | No explicit editor preference; OS mode changes | Editor resolves to the current OS light/dark mode and updates live | Use a deterministic fallback mode when media-query APIs are unavailable |
| EXPLICIT_EDITOR_MODE | User selects Light or Dark in theme menu | Editor keeps the selected mode across reloads | Ignore malformed stored values and use system mode |
| MATCH_PRESENTATION | Document has no `presentationTheme` or value `match` | Slides use the resolved editor mode | Preserve source and render normally |
| OVERRIDE_PRESENTATION | Document has `presentationTheme: light` or `dark` | Slides use the selected mode independently of editor mode | Unknown values resolve to `match` without dropping metadata |
| THEME_MENU_UPDATE | User selects a presentation mode | Initial front matter is added or updated and the editor/preview update | Preserve other front-matter keys and Markdown content |
| FRONT_MATTER_SLIDES | Source begins with front matter and later uses standalone `---` separators | Front matter is excluded from slide content; later separators still split slides | Malformed/non-initial front matter remains ordinary Markdown |

</intent-contract>

## Code Map

- `src/App.tsx` -- composition root for browser and Tauri views; add shared theme state and compact theme menu to both toolbar/header surfaces.
- `src/app.css` -- currently hard-codes application colors and surfaces; migrate chrome, focus, action, error, and responsive styles to semantic CSS variables.
- `src/components/MarkdownEditor.css` -- currently hard-codes editor panel, textarea, labels, and focus colors; consume shared semantic tokens.
- `src/components/PresentationPreview.tsx` -- owns slide list projection; accept the resolved presentation theme and apply a theme class to the slide surface.
- `src/components/PresentationPreview.css` -- currently hard-codes white slide pages and cyan accents; define coordinated Slate/Paper slide surfaces, typography, code, quote, and hierarchy styles.
- `src/domain/presentation/markdown.ts` -- pure `parseMarkdown` currently treats every standalone `---` as a slide separator; add initial-front-matter extraction before splitting and preserve existing fence behavior.
- `src/domain/presentation/presentation.ts` and `src/domain/presentation/index.ts` -- extend stable domain types/exports for presentation theme metadata and resolved modes without platform dependencies.
- `src/application/world/workspace.ts` -- `editorSource`, `presentation`, and `updateSource` currently strip only Elef identity metadata; preserve front matter while deriving the presentation mode and writing menu changes back to source.
- `src/application/presentation-editor/session.ts` -- browser document source/baseline state; provide the theme menu with source updates without changing replacement semantics.
- `tests/unit/presentation.test.ts` -- parser and metadata unit coverage, including front matter, separator compatibility, malformed metadata, and theme resolution.
- `tests/unit/world-workspace.test.ts` and `tests/unit/editor-session.test.ts` -- verify per-document metadata updates and browser/Tauri source synchronization.

## Tasks & Acceptance

**Execution:**
- `src/domain/presentation/markdown.ts`, `src/domain/presentation/presentation.ts`, `src/domain/presentation/index.ts` -- implement front-matter parsing, `presentationTheme` resolution, and theme-aware presentation metadata -- keep parsing deterministic and platform-neutral.
- `src/application/world/workspace.ts`, `src/application/presentation-editor/session.ts` -- expose and persist presentation theme overrides while preserving existing Elef identity metadata, autosave, dirty-state, and browser file behavior.
- `src/App.tsx` -- add global editor preference resolution, live system preference handling, persisted explicit mode, per-document presentation mode, and a compact menu in both app surfaces.
- `src/app.css`, `src/components/MarkdownEditor.css`, `src/components/PresentationPreview.tsx`, `src/components/PresentationPreview.css` -- implement shared semantic tokens and coordinated Oradia Slate/Paper chrome and slide styling with stronger slide hierarchy.
- `tests/unit/presentation.test.ts`, `tests/unit/world-workspace.test.ts`, `tests/unit/editor-session.test.ts` -- cover the matrix and UI state plumbing at the existing unit/application layer.

**Acceptance Criteria:**
- Given no explicit editor preference, when Elef starts or the OS color scheme changes, then editor chrome uses the matching Oradia Slate or Oradia Paper mode.
- Given an explicit editor mode, when Elef reloads or the OS mode changes, then the selected editor mode remains active until changed.
- Given a presentation without `presentationTheme`, when it is opened, then its slides match the editor mode and its Markdown source is unchanged.
- Given a presentation with `presentationTheme: light` or `dark`, when it is opened, then its slides use that mode independently while the editor keeps its own mode.
- Given a user changes presentation mode from the compact menu, when the document is saved or autosaved, then the initial front matter contains the selected `presentationTheme` and existing Markdown content remains intact.
- Given front matter followed by standalone slide separators, when the source is parsed, then front matter is not rendered and all later separators still create the expected slides.
- Given browser mode or Tauri World mode, when the theme menu is used, then the same theme behavior and labels are available without changing the existing document workflow.

## Design Notes

Theme state has two scopes: `editorMode` (`system`, `light`, `dark`) is a device preference, while `presentationTheme` (`match`, `light`, `dark`) belongs to each Markdown document. CSS variables provide the shared vocabulary; the preview receives a resolved mode so presentation styling can remain independently stronger without duplicating theme selection policy.

The parser must only recognize YAML front matter at the beginning of the source. This avoids interpreting the closing front-matter delimiter as the first slide separator while preserving Elef's existing separator behavior everywhere else.

## Verification

**Commands:**
- `npm test -- --run` -- expected: all existing and new unit/integration tests pass.
- `npm run build` -- expected: TypeScript compilation and Vite production build succeed.
- `git diff --check` -- expected: no whitespace errors.

</intent-contract>

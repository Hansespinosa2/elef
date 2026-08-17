---
title: 'Desktop Markdown presentation renderer'
type: 'feature'
created: '2026-08-17'
status: 'draft'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef currently has no application foundation, so the presentation model and rendering approach cannot be evaluated. The project needs a small, end-to-end slice that proves a Markdown document can become a usable slide presentation.

**Approach:** Build a portable React/TypeScript renderer core and a Tauri desktop shell. The first slice opens one local Markdown file, splits it into slides, renders ordinary Markdown into a slide canvas, and supports a browser-hosted build so the same core remains compatible with a future Rails web/API host.

## Boundaries & Constraints

**Always:** Keep the renderer core independent of Tauri and Rails; use Markdown as the authoring format; preserve source order; make slide boundaries deterministic; provide clear parse/load errors; keep the UI usable at a 16:9 presentation aspect ratio.

**Ask First:** Any change to the initial Markdown slide-boundary convention, adding a component DSL, adding a persistence/database layer, or making Rails a required runtime dependency.

**Never:** Build a visual drag editor, semantic layout engine, LaTeX/Python/chart execution, AI features, PPTX/PDF export, collaboration, or a bundled Rails server in this slice. Do not represent content as arbitrary absolute-positioned PowerPoint objects.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| HAPPY_PATH | Markdown containing two sections separated by `---` | Two ordered slides render with headings, paragraphs, lists, fenced code, and images | N/A |
| NO_SEPARATOR | Markdown with content but no `---` | One slide renders all content | N/A |
| EMPTY_SLIDE | Consecutive separators or leading/trailing separator | Empty slide is preserved in order with a non-crashing empty state | Show a readable empty-slide state |
| INVALID_FILE | File cannot be read or is not UTF-8 Markdown | Preview remains stable and shows an actionable error | Never silently render stale content |

</frozen-after-approval>

## Code Map

- `package.json` -- Node/Vite/React/TypeScript scripts and runtime dependencies to establish the frontend build.
- `src/core/presentation.ts` -- framework-agnostic presentation and slide types.
- `src/core/markdown.ts` -- deterministic Markdown-to-slide parsing and rendering input preparation; no Tauri or Rails imports.
- `src/core/*.test.ts` -- unit coverage for separators, empty slides, ordering, and supported Markdown input.
- `src/App.tsx` -- application state, file loading boundary, and error presentation.
- `src/components/PresentationPreview.tsx` -- 16:9 slide canvas and ordered slide rendering.
- `src-tauri/` -- minimal Tauri shell and native file-open integration, isolated from core rendering.
- `index.html`, `vite.config.*`, `tsconfig*.json` -- browser build and type-check configuration.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json`, `vite.config.*`, `tsconfig*.json`, `index.html` -- establish reproducible React/TypeScript/Vite scripts and dependencies -- provide browser and desktop build inputs.
- [ ] `src/core/presentation.ts`, `src/core/markdown.ts` -- define the portable model and Markdown slide parser -- make the renderer testable without a desktop shell.
- [ ] `src/core/*.test.ts` -- cover the I/O matrix and deterministic ordering -- prevent regressions in the source contract.
- [ ] `src/components/PresentationPreview.tsx`, `src/App.tsx` -- render slides and expose local-file loading plus errors -- deliver the usable vertical slice.
- [ ] `src-tauri/` -- add the minimal Tauri shell and file-open bridge -- make desktop the primary runtime without coupling the core.

**Acceptance Criteria:**
- Given a valid Markdown file with `---` separators, when it is opened, then the app renders the same number of ordered slides and preserves supported Markdown semantics.
- Given a file with no separators, when it is opened, then the app renders one slide.
- Given empty slides or malformed input, when it is opened, then the app stays usable and shows an explicit empty/error state.
- Given the browser build, when it is started without Tauri, then the renderer core and preview work through the web-compatible file-loading path.
- Given a Tauri build, when the native file-open action is used, then the selected file reaches the same portable parser and preview path.

## Verification

**Commands:**
- `npm test` -- expected: parser and UI-adjacent unit tests pass.
- `npm run build` -- expected: browser production build completes with no TypeScript errors.
- `npm run tauri build` -- expected: desktop bundle completes when the local Tauri toolchain is available.


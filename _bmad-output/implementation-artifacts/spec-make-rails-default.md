---
title: 'Make Rails the default Elef app'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
baseline_commit: '012e6c1ec7993a2341596076b93896c91646c525'
context:
  - '{project-root}/_bmad-output/specs/spec-make-rails-default/.memlog.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-markdown-renderer.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-live-markdown-editor.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-domain-inspired-editor-architecture.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-intuitive-slide-editing.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef's root runtime is a Vite/React/Tauri desktop app, but the approved direction is a conventional Rails monolith that owns persistence, routing, Markdown presentation behavior, editing, preview, and browser presentation mode.

**Approach:** Replace the root app with Rails, port the strict source-first Markdown presentation domain into Ruby, store one user's presentations in SQLite, and implement Rails views with Hotwire/Stimulus plus Selenium-backed Rails system tests.

## Boundaries & Constraints

**Always:** Raw Markdown is canonical; `---` standalone slide delimiters, initial front matter, fenced code handling, empty slide preservation, layout/theme metadata, and current supported Markdown rendering remain behavior references. Editing is source-first with explicit Save; dirty state warns before losing unsaved changes. The app provides create/list/open/edit/save/reopen, derived preview, and keyboard browser presentation mode.

**Ask First:** Introducing React, autosave, Tauri runtime, a component DSL, export/import, filesystem projects, Python/AI execution, or freeform canvas.

**Never:** Persist slide geometry as authoritative state, duplicate a second source of truth, hide the Markdown delimiter contract, or keep the old Node/Tauri runtime as the default app in this branch.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CREATE_SAVE_REOPEN | User creates Markdown, saves, returns to library, reopens | Database record stores raw Markdown; preview and editor reflect saved source | Validation errors stay on form without losing source |
| SLIDE_SPLIT | Markdown contains standalone `---` | Ordered slides render with empty slides preserved | No crash on leading/trailing/consecutive separators |
| FENCE_FRONTMATTER | `---` appears in initial front matter or fenced code | Front matter excluded from slides; fenced separator remains content | Malformed front matter becomes ordinary Markdown |
| DIRTY_NAVIGATION | Edited source differs from saved baseline | Save enables and leaving/replacing prompts before loss | Cancel keeps edited source |
| PRESENT_MODE | Saved presentation opened in present mode | Browser displays one clean 16:9 slide at a time with keyboard navigation | Empty presentations show a stable empty slide |

</frozen-after-approval>

## Code Map

- `src/domain/presentation/markdown.ts` -- source behavior to port: front matter detection, fenced-code-aware slide splitting, layout/theme metadata, empty slide preservation, title extraction, slide budget.
- `tests/unit/presentation.test.ts` -- primary parity cases; focused run passed 48/48 before migration.
- `tests/integration/presentation-preview.test.tsx` -- browser interaction reference; pre-migration run had 11 existing failures but documents current presentation/editor expectations.
- `_bmad-output/specs/spec-make-rails-default/.memlog.md` -- approved migration choices, including Rails monolith, explicit save, no autosave/Tauri/React, Selenium system tests.
- `package.json`, `src/`, `src-tauri/`, `vite.config.*`, `tsconfig*`, `wdio.conf.ts` -- old runtime files to remove/replace; preserve behavior via tests, not runtime.
- Environment -- Ruby 3.4.3, Rails gems 8.1.3/8.0.2.x, Bundler available, SQLite 3.51.0; choose Rails 8.1.3 + SQLite + Redcarpet/Rouge to avoid Node/React and preserve Markdown/math/code behavior server-side.

## Tasks & Acceptance

**Execution:**
- [x] Root Rails files -- scaffold a conventional Rails app in place using Rails 8.1.3, SQLite, importmap, Turbo, Stimulus, system tests, and no React/Tauri/Node runtime -- make Rails the default product.
- [x] `app/models/presentation.rb` and migration -- add single-user database-backed Presentation with title/source validations and Markdown-derived helpers -- keep source canonical.
- [x] `app/lib/presentations/*` -- port parser/rendering/domain behavior from TypeScript into Ruby with unit coverage -- preserve strict Markdown semantics.
- [x] `app/controllers`, `config/routes.rb`, and Rails views -- implement library, create/edit/show, explicit Save, derived preview, and presentation mode -- cover product workflow.
- [x] `app/javascript/controllers/*` -- add Stimulus dirty-state and presentation keyboard behavior -- use Hotwire/Stimulus by default.
- [x] `test/models`, `test/controllers`, `test/system` -- add unit/request/system tests including Selenium headless Chrome configuration -- verify behavior end-to-end.
- [x] `README.md` -- document Rails/Ruby/database/Markdown choices and validation commands -- make migration decisions explicit.

**Acceptance Criteria:**
- Given a saved Markdown presentation, when it is reopened, then the source editor and preview match the saved database source.
- Given separators, front matter, fenced code, empty slides, layout/theme metadata, and malformed Markdown, when Rails parses/renders, then behavior matches the characterized source contract.
- Given unsaved editor changes, when the user navigates away or starts another presentation, then the browser warns and cancellation preserves edits.
- Given presentation mode, when ArrowRight/ArrowLeft or Space is pressed, then slides advance/reverse without leaving the clean presentation surface.
- Given validation runs, when targeted and full Rails tests execute, then unit, request, and Selenium system coverage pass or blockers are documented.

## Spec Change Log

## Design Notes

The old integration suite's failing assertions are characterization evidence, not blockers to Rails migration. Preserve strict model-layer Markdown semantics from the passing unit suite and implement browser workflows directly in Rails rather than reproducing CodeMirror internals.

## Verification

**Commands:**
- `bin/rails test test/models test/controllers` -- expected: model/domain/request tests pass.
- `bin/rails test:system` -- expected: Selenium-backed browser workflows pass in headless Chrome where Chrome is available.
- `bin/rails test` -- expected: full Rails test suite passes.
- `git diff --check` -- expected: no whitespace errors.

## Suggested Review Order

**Rails product entry points**

- Routes expose library, editing, preview, and browser presentation mode.
  [`routes.rb:4`](../../config/routes.rb#L4)

- Controller keeps persistence explicit and preview derived from saved source.
  [`presentations_controller.rb:1`](../../app/controllers/presentations_controller.rb#L1)

- Active Record model stores canonical Markdown and memoizes derived presentation data safely.
  [`presentation.rb:1`](../../app/models/presentation.rb#L1)

**Markdown presentation domain**

- Parser ports strict delimiter, front-matter, fenced-code, empty-slide, and metadata behavior.
  [`document.rb:10`](../../app/lib/presentations/document.rb#L10)

- Front-matter detection mirrors the previous source contract without treating malformed metadata specially.
  [`document.rb:109`](../../app/lib/presentations/document.rb#L109)

- Renderer combines Redcarpet, Rouge, and KaTeX while preserving code-block source.
  [`markdown_renderer.rb:21`](../../app/lib/presentations/markdown_renderer.rb#L21)

**Rails UI and Hotwire behavior**

- Source-first form gives explicit Save, dirty status, and saved-source preview.
  [`_form.html.erb:1`](../../app/views/presentations/_form.html.erb#L1)

- Dirty Stimulus controller blocks accidental navigation without autosave.
  [`dirty_controller.js:3`](../../app/javascript/controllers/dirty_controller.js#L3)

- Presentation Stimulus controller provides clean keyboard-driven browser slides.
  [`presentation_controller.js:3`](../../app/javascript/controllers/presentation_controller.js#L3)

**Verification and documented choices**

- Unit tests lock down parser and Markdown rendering parity cases.
  [`presentation_test.rb:3`](../../test/models/presentation_test.rb#L3)

- Request tests cover create, explicit update, preview, and presentation routes.
  [`presentations_controller_test.rb:3`](../../test/controllers/presentations_controller_test.rb#L3)

- Selenium system tests cover create/save/reopen, dirty cancellation, and keyboard presenting.
  [`presentations_test.rb:3`](../../test/system/presentations_test.rb#L3)

- README records Rails, SQLite, Hotwire, and Markdown library decisions.
  [`README.md:7`](../../README.md#L7)

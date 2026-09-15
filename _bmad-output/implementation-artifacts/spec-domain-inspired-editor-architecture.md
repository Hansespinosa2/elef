---
title: 'Refactor the editor toward domain-inspired architecture'
type: 'refactor'
created: '2026-08-17'
status: 'done'
baseline_commit: 'e87e76e2dca8e6f5f4f85f584b41f1c2f595751f'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef's current editor works, but `App.tsx` combines domain rules, editor workflow state, browser/Tauri file access, async replacement protection, and UI composition. That coupling will make future Rails hosting and feature growth harder to test and maintain.

**Approach:** Refactor the existing editor into a domain-inspired layered design without changing user-visible behavior. Keep presentation concepts and Markdown rules platform-independent, move editor workflows behind an application-level session/controller, and isolate browser/Tauri access behind ports and adapters so Rails can become a future host.

## Boundaries & Constraints

**Always:** Preserve the Markdown parser contract, existing slide rendering, New Markdown behavior, dirty replacement confirmation, failed-load source preservation, browser/Tauri support, and current public user workflow. Keep the domain free of React, Tauri, browser APIs, Rails, and filesystem concerns. Keep tests organized by layer, with domain tests separate from application and adapter tests.

**Ask First:** Introducing a Rails application, persistence, save operations, HTTP APIs, collaborative editing, a state-management dependency, or moving the renderer to Ruby.

**Never:** Change the Markdown syntax or presentation output, add speculative repositories/entities/events, duplicate rendering rules in another language, or turn this refactor into a visual/editor feature expansion.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| NEW_DOCUMENT | Clean or confirmed active session | Application session exposes an untitled blank source and one empty slide | Preserve existing confirmation behavior |
| LIVE_EDIT | New Markdown source text | Session updates source and derived presentation together | Source remains editable if parsing fails |
| OPEN_DOCUMENT | Platform adapter returns a UTF-8 Markdown document | Session hydrates source, baseline, name, and presentation | Failed reads preserve the active session |
| STALE_OPEN | Open resolves after a newer replacement | Older result is ignored | Do not overwrite the newer session |

</frozen-after-approval>

## Code Map

- `src/App.tsx:14-119` -- current composition root and coupled editor workflow to thin; preserve UI behavior while delegating state and platform operations.
- `src/core/presentation.ts:1-10` -- existing framework-independent `Presentation` and `Slide` data types; domain foundation to retain or refine without adding unnecessary abstractions.
- `src/core/markdown.ts:8-43` -- pure Markdown-to-presentation parser; move under the domain layer or expose through a domain module without changing its contract.
- `src/core/document.ts:1-3` -- existing dirty-state rule; reuse from the application session.
- `src/core/file.ts:1-4` -- UTF-8 decoding primitive; keep platform-neutral and move behind an adapter-facing boundary if needed.
- `src/components/MarkdownEditor.tsx:3-21` -- controlled UI component; keep presentational and free of workflow state.
- `src/components/PresentationPreview.tsx:1-24` -- React rendering projection; keep React-specific Markdown rendering outside the domain.
- `src-tauri/src/main.rs:3-7` -- Tauri bootstrap only; do not add domain logic here.
- `src/core/markdown.test.ts:6-58` -- current domain-focused tests; reorganize by layer while preserving coverage.

## Tasks & Acceptance

**Execution:**
- [x] `src/domain/presentation/` -- establish domain modules for presentation types, Markdown parsing, and document rules -- isolate framework-independent behavior.
- [x] `src/application/presentation-editor/` -- add an editor session/controller for source, baseline, derived presentation, replacement, errors, and stale-open protection -- remove workflow state from `App.tsx`.
- [x] `src/application/ports/` -- define platform-neutral document reading, file selection, and replacement-confirmation contracts -- enable Tauri now and Rails later.
- [x] `src/infrastructure/browser/` and `src/infrastructure/tauri/` -- implement current browser and Tauri adapters -- preserve existing file-open behavior without platform checks in domain code.
- [x] `src/App.tsx` and `src/components/` -- reduce the app to composition and keep UI components presentational -- preserve the current interface.
- [x] `tests/unit/` and `tests/integration/` -- mirror domain, application, and adapter boundaries with focused tests -- protect behavior while making ownership clear.

**Acceptance Criteria:**
- Given the application starts in the browser or Tauri, when the user opens or creates Markdown, then the same application workflow works through the selected platform adapter.
- Given source is edited, when the application session updates, then the source, dirty state, and derived presentation remain synchronized.
- Given an older asynchronous open completes after a newer document action, then the older result does not replace the active document.
- Given a failed open occurs, when the adapter reports an error, then the current source and preview remain intact and the error remains actionable.
- Given the React UI is rendered, when domain and application modules are inspected, then they contain no React, Tauri, browser, Rails, or filesystem dependencies.
- Given the refactor is complete, when existing tests and build commands run, then all pass without changing rendered presentation behavior.

## Spec Change Log

## Design Notes

The target is domain-inspired layering, not full tactical DDD. Prefer plain types, functions, and one application session/controller over entities, repositories, domain events, or a state-management package until the product requires them. Rails should later implement ports at the host boundary rather than duplicate the TypeScript renderer.

## Verification

**Commands:**
- `npm test -- --run` -- expected: all domain, application, and integration tests pass.
- `npm run build` -- expected: TypeScript and production build complete successfully.
- `git diff --check` -- expected: no whitespace errors.

**Manual checks:**
- Start the app in browser mode and Tauri mode; create, edit, open, cancel replacement, and trigger a failed load. Expected: behavior matches the current editor.

## Suggested Review Order

**Application composition**

- The composition root selects adapters while delegating workflow state to one session.
  [`App.tsx:9`](../../src/App.tsx#L9)

- The session owns synchronized source, presentation, replacement, errors, and stale-open protection.
  [`session.ts:23`](../../src/application/presentation-editor/session.ts#L23)

**Platform boundaries**

- These ports keep document selection, reading, and confirmation independent of host APIs.
  [`documents.ts:1`](../../src/application/ports/documents.ts#L1)

- Browser file input cancellation and UTF-8 decoding stay isolated in the browser adapter.
  [`documents.ts:4`](../../src/infrastructure/browser/documents.ts#L4)

- Tauri dialog and filesystem access stay isolated in the Tauri adapter.
  [`documents.ts:6`](../../src/infrastructure/tauri/documents.ts#L6)

**Domain and verification**

- Markdown splitting remains a framework-independent domain function with the existing contract.
  [`markdown.ts:9`](../../src/domain/presentation/markdown.ts#L9)

- Shared UTF-8 decoding remains a domain utility reused by both platform adapters.
  [`utf8.ts:1`](../../src/domain/presentation/utf8.ts#L1)

- Application tests cover synchronization, failures, and stale opens across the new session boundary.
  [`editor-session.test.ts:14`](../../tests/unit/editor-session.test.ts#L14)

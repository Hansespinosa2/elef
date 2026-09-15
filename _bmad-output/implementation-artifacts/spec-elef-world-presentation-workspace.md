---
title: 'Build the Elef World presentation workspace'
type: 'feature'
created: '2026-08-17'
status: 'done'
review_loop_iteration: 0
baseline_commit: '9db3391a894af66aa8500af5853db9f4da316482'
context:
  - '{project-root}/_bmad-output/brainstorming/brainstorm-presentation-workspace-save-model-2026-08-17/.memlog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef currently edits one in-memory Markdown document and opens individual files. It does not provide a durable home for presentations, seamless persistence, or a way to return to work without remembering file paths.

**Approach:** Add a Tauri-first Elef World workspace. A World is a user-selected root folder containing explicitly Elef-created presentation folders, each with `presentation.md`. New drafts are created and autosaved immediately; a dashboard resumes the last presentation with a rendered preview and recent navigation.

## Boundaries & Constraints

**Always:** Target Tauri desktop persistence first; preserve browser single-file behavior for now. Ask once for the Elef World folder, then remember it. Create a presentation folder and `presentation.md` immediately for every new draft. Autosave edits quietly in the background without blocking editing. Use the first Markdown H1 as the human title and folder name when available. Never overwrite a colliding folder. Keep the domain free of Tauri and filesystem APIs. Preserve current Markdown parsing and slide rendering. Keep missing or moved recent presentations recoverable with clear actions.

**Ask First:** Adding browser File System Access support, Rails persistence, supporting-file folders, references, generic Markdown discovery/conversion, or fork/clone implementation.

**Never:** Require a first-save ceremony for a new draft, silently discard edits, scan arbitrary folders as presentations, overwrite an existing presentation during rename, or add a backend.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| WORLD_SETUP | First Tauri launch | User selects a World folder once and sees the workspace dashboard | Setup cancellation remains recoverable |
| NEW_DRAFT | User clicks New Presentation | Elef creates a presentation folder with `presentation.md`, opens an empty editable presentation, and begins autosaving | Surface a recoverable filesystem error without losing in-memory edits |
| AUTO_SAVE | Active draft source changes | `presentation.md` is updated quietly after edits settle | Continue editing and retry; do not block the editor |
| TITLE_RENAME | First H1 is added or changed | Folder title follows the sanitized H1 when safe | On collision, preserve the current folder and offer a clear resolution |
| RESUME | World contains recent presentations | Dashboard shows sidebar navigation, recent work, and a rendered preview of the last presentation | Missing targets show Locate/Remove actions instead of broken content |
| WORLD_RESCAN | Presentation moves within the World | Recursive scan can rematch an explicitly created presentation by stable identity | Unmatched entries remain visibly recoverable |

</frozen-after-approval>

## Code Map

- `src/App.tsx:9-50` -- editor-only composition root; branch on Tauri capability to add World setup, dashboard, and editor navigation while preserving browser file opening.
- `src/application/presentation-editor/session.ts:5-98` -- cached external-store editor state and source replacement workflow; retain its platform-neutral API and coordinate autosave outside the domain.
- `src/application/ports/documents.ts:1-16` -- existing selector/reader/confirmation ports; extend with narrow World selection and persistence contracts so application code has no Tauri imports.
- `src/domain/presentation/markdown.ts:9-43` -- deterministic `---` slide parser; add pure first-H1 extraction and safe folder-name normalization without changing parsing behavior.
- `src/domain/presentation/presentation.ts:1-10` and `index.ts` -- presentation/slide types and public exports; add a stable draft identity helper only if the World record requires it.
- `src/infrastructure/tauri/documents.ts:1-25` -- current Tauri v1 dialog/filesystem adapter; add folder selection, recursive `readDir`, UTF-8 read/write, create, rename, and missing-path normalization here.
- `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` -- current Tauri v1 allowlist/features; enable only the filesystem operations and scopes required by the adapter.
- `src/components/PresentationPreview.tsx:10-25` and `src/components/MarkdownEditor.tsx:8-21` -- reusable preview/editor surfaces; do not duplicate Markdown rendering or editor state in the dashboard.
- `src/app.css:1-24` -- current editor layout; extend it for sidebar/dashboard/resume, setup, missing-target, and quiet persistence-error states.
- `tests/unit/presentation.test.ts`, `tests/unit/editor-session.test.ts`, `tests/integration/editor-workflow.test.ts` -- existing layered coverage and mocks; extend these patterns and add focused World domain/application/adapter tests.
- `package.json` -- existing `test`, `build`, and `tauri` scripts; no dependency or script changes are expected.
- `_bmad-output/brainstorming/brainstorm-presentation-workspace-save-model-2026-08-17/.memlog.md` -- approved product direction and explicit deferred scope.

## Tasks & Acceptance

**Execution:**
- [x] `src/domain/presentation/markdown.ts` and related exports -- add pure H1 extraction and filesystem-safe title normalization, preserving the existing slide parser -- keep naming rules testable without platform APIs.
- [x] `src/application/ports/` and `src/application/world/` -- define World records and orchestrate setup, draft creation, recent state, debounced autosave, title-driven rename, rescan, and missing-target recovery -- centralize workflow policy.
- [x] `src/infrastructure/tauri/documents.ts`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` -- implement the Tauri v1 filesystem adapter and minimum permissions -- isolate desktop I/O and normalize failures.
- [x] `src/App.tsx`, `src/components/`, and `src/app.css` -- add setup/dashboard/editor views with sidebar, resume preview, new-presentation action, and recoverable missing states -- preserve the current browser single-file experience.
- [x] `tests/unit/` and `tests/integration/` -- cover every matrix row, collision behavior, failed writes, moved/deleted entries, stable rematching, and browser regression -- protect the workflow at each layer.

**Acceptance Criteria:**
- Given first launch in Tauri, when the user chooses a World folder, then Elef remembers it and opens the workspace dashboard on later launches.
- Given a World is configured, when the user creates a presentation, then an editable draft and `presentation.md` exist immediately without a naming dialog.
- Given a saved or new presentation is edited, when typing settles, then Elef autosaves without interrupting editing or requiring a Save action.
- Given the first H1 changes, when the derived folder name is available, then Elef renames the folder safely; collisions never overwrite another presentation.
- Given a recent presentation was moved or deleted, when the dashboard refreshes, then Elef shows a recoverable missing state with Locate or Remove actions.
- Given browser mode is used, when the user opens Markdown, then the current single-file workflow remains available and unchanged.

## Spec Change Log

## Design Notes

New drafts need a temporary stable identity so they can be written before a title exists. The visible folder title can follow the first H1 later, while identity remains stable across rename and World rescans. Autosave should be debounced and quiet; only persistent failures should become visible.

## Verification

**Commands:**
- `npm test -- --run` -- expected: all domain, application, and integration tests pass.
- `npm run build` -- expected: TypeScript and production build complete successfully.
- `git diff --check` -- expected: no whitespace errors.
- `npm run tauri build` -- expected: Tauri permissions and desktop compilation succeed.

**Manual checks:**
- In Tauri, configure a World, create a draft, type a first H1, close/reopen it, rename it, and simulate a moved/deleted presentation. Expected: edits persist quietly and missing entries remain recoverable.

## Suggested Review Order

**Workspace entry point**

- Tauri routing keeps desktop World behavior separate from browser single-file editing.
  [`App.tsx:19`](../../src/App.tsx#L19)

- The dashboard and editor share the same workspace state and reusable preview.
  [`App.tsx:35`](../../src/App.tsx#L35)

**Persistence workflow**

- World state coordinates durable records, autosave, safe renames, rescans, and recovery.
  [`workspace.ts:25`](../../src/application/world/workspace.ts#L25)

- Collision suffixes prevent title changes from overwriting another presentation.
  [`workspace.ts:178`](../../src/application/world/workspace.ts#L178)

- Stable IDs embedded in Markdown enable moved-folder rematching.
  [`documents.ts:48`](../../src/infrastructure/tauri/documents.ts#L48)

**Domain and platform boundaries**

- Pure H1 extraction and folder normalization preserve renderer behavior without filesystem dependencies.
  [`markdown.ts:45`](../../src/domain/presentation/markdown.ts#L45)

- Narrow ports keep Tauri APIs isolated from application policy.
  [`documents.ts:18`](../../src/application/ports/documents.ts#L18)

**Verification and configuration**

- Workspace tests cover immediate creation, autosave, persistence, recovery, and collisions.
  [`world-workspace.test.ts:18`](../../tests/unit/world-workspace.test.ts#L18)

- Tauri permissions enable the filesystem operations required by the adapter.
  [`tauri.conf.json:14`](../../src-tauri/tauri.conf.json#L14)

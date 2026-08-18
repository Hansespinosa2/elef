---
title: 'Build the Elef World presentation workspace'
type: 'feature'
created: '2026-08-17'
status: 'draft'
review_loop_iteration: 0
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

- `src/App.tsx:9-50` -- current editor-only composition root; evolve into Tauri workspace/dashboard routing while preserving editor components.
- `src/application/presentation-editor/session.ts:5-98` -- current source/presentation session; extend or coordinate with workspace persistence without leaking filesystem APIs into the domain.
- `src/application/ports/documents.ts:1-16` -- existing platform-neutral document ports; add narrow World/persistence contracts here.
- `src/infrastructure/tauri/documents.ts:1-25` -- current Tauri file adapter; add World folder, read/write, rename, and recursive-discovery operations in a focused adapter/module.
- `src-tauri/src/main.rs:3-7` -- Tauri bootstrap; preserve the shell and add only narrowly scoped commands/permissions required for workspace persistence.
- `src-tauri/tauri.conf.json` -- current Tauri v1 allowlist and filesystem scope; update for the minimum required desktop operations.
- `src/domain/presentation/markdown.ts:9-43` -- stable parser contract to reuse for previews and title extraction context.
- `src/domain/presentation/presentation.ts:1-10` -- presentation/slide types; extend with stable identity only if required by the World model.
- `src/components/PresentationPreview.tsx:10-25` -- reusable rendered preview for the dashboard resume card and editor.
- `src/components/MarkdownEditor.tsx:8-21` -- controlled editor to preserve as the editing surface.
- `src/app.css:4-24` -- current application layout; extend for sidebar, dashboard, missing-target, and editor states.
- `tests/unit/` and `tests/integration/` -- current layered test locations; add domain naming, application persistence, Tauri adapter, collision, autosave, and missing-target coverage.
- `_bmad-output/brainstorming/brainstorm-presentation-workspace-save-model-2026-08-17/.memlog.md` -- approved product direction and explicit deferred scope.

## Tasks & Acceptance

**Execution:**
- [ ] `src/domain/presentation/` -- add pure title extraction, filename sanitization, stable presentation identity, and collision-safe naming rules -- keep workspace policy framework-independent.
- [ ] `src/application/world/` and `src/application/ports/` -- add World setup, presentation lifecycle, recent records, autosave coordination, resume state, and missing-target actions -- centralize workflow state.
- [ ] `src/infrastructure/tauri/` and `src-tauri/` -- implement World folder selection, presentation file creation/read/write/rename, persistence, and recursive rematching -- isolate desktop APIs and permissions.
- [ ] `src/App.tsx`, `src/components/`, and `src/app.css` -- add the split dashboard/sidebar/resume-preview experience and connect the editor -- make persistence invisible during normal use.
- [ ] `tests/unit/` and `tests/integration/` -- cover every matrix row plus collisions, failed writes, moved/deleted entries, and draft recovery -- protect the filesystem workflow.

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

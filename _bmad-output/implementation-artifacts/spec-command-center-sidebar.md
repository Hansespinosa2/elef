---
title: 'Command center sidebar actions'
type: 'feature'
created: '2026-08-18'
status: 'done'
review_loop_iteration: 0
baseline_commit: '714f4d2488021b50d3181b9ff982fb5488e06cb7'
context:
  - '/Users/andresespinosa/Documents/GitHub/copilot-worktrees/elef/hansespinosa2-expert-succotash/_bmad-output/planning-artifacts/ux-elef-2026-08-18/EXPERIENCE.md'
  - '/Users/andresespinosa/Documents/GitHub/copilot-worktrees/elef/hansespinosa2-expert-succotash/_bmad-output/planning-artifacts/ux-elef-2026-08-18/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current Elef World sidebar exposes Rename and Delete as inline actions whenever a presentation row is hovered or focused. These are infrequent, consequential actions and should not compete with the primary navigation path.

**Approach:** Adopt the selected Command center direction: a compact workspace sidebar with Open editors, All files, keyboard-oriented search, a visible workspace footer, and a slide count on each presentation row. Move Rename and Delete into a VS Code-style contextual menu opened from the presentation row's overflow button, with Delete remaining behind the existing confirmation.

## Boundaries & Constraints

**Always:** Preserve existing presentation opening, missing-file locating, renaming, deleting, autosave, theme controls, keyboard sidebar toggle, accessible names, and dark/light tokens. Keep the active presentation visually distinct. Show the current slide count for each presentation without opening it. The overflow menu must be keyboard reachable and must not depend on hover alone.

**Ask First:** None.

**Never:** Do not change filesystem semantics, add a new dependency, remove delete confirmation, make destructive actions permanently visible, or replace the existing browser Markdown workflow.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Open action menu | Focus or hover a non-missing presentation | Show an overflow button; activating it opens Rename and Delete menu items | Menu remains usable by keyboard |
| Rename | Menu > Rename | Enter inline rename mode with the current title; save/escape behavior remains intact | Empty title does not rename |
| Delete | Menu > Delete | Show existing irreversible-action confirmation, then delete only after confirmation | Cancel leaves the presentation untouched |
| Missing file | Missing presentation entry | Keep Locate/open behavior; do not show rename/delete menu | Existing locate flow is unchanged |
| Menu dismissal | Menu open, click elsewhere or press Escape | Close menu without changing the presentation | No state is lost |
| Slide count | Presentation has one or more parsed slides | Show a compact count beside the title | If parsing fails, omit the count rather than blocking navigation |

</frozen-after-approval>

## Code Map

- `src/App.tsx` -- Tauri world sidebar rendering, presentation actions, rename state, delete confirmation, and sidebar open state.
- `src/app.css` -- World sidebar layout, presentation rows, hidden inline actions, focus styling, and theme tokens.
- `src/application/world/workspace.ts` -- Existing `renamePresentation` and `deletePresentation` persistence APIs; read-only for this feature.
- `tests/unit/world-workspace.test.ts` -- Existing persistence coverage for rename/delete; no domain changes are expected.
- `mockups/sidebar-directions.html` -- selected Command center visual reference, especially the Open editors, search, workspace status, and Focus rail slide-count treatment.

## Tasks & Acceptance

**Execution:**
- [x] `src/App.tsx` -- add Command center sidebar structure and a VS Code-style per-row overflow menu while preserving existing action handlers -- make routine navigation primary and destructive actions contextual.
- [x] `src/App.tsx` -- derive and render a compact slide count for each presentation row from the existing presentation data -- carry the useful Focus rail affordance into the selected direction.
- [x] `src/app.css` -- style the Command center sections, search affordance, status footer, overflow trigger, and anchored menu across light/dark themes -- match existing tokens and focus behavior.
- [x] `src/App.tsx` -- close the contextual menu on outside interaction and Escape, and expose explicit accessible labels -- prevent stale menus and hover-only access.
- [x] `package.json` -- use the existing build and unit test scripts for verification -- avoid new tooling.

**Acceptance Criteria:**
- Given the Tauri workspace sidebar is open, when a presentation is listed, then its primary row opens the presentation and Rename/Delete are not persistently visible.
- Given a presentation can be parsed, when it is listed, then its row shows a compact slide count without requiring the presentation to be opened.
- Given a presentation row is focused or hovered, when its overflow control is activated, then a contextual menu exposes Rename and Delete with accessible names.
- Given the contextual menu is open, when Escape or an outside pointer interaction occurs, then the menu closes without changing presentation data.
- Given Rename is chosen, when the current title is edited and saved or cancelled, then the existing rename behavior is preserved.
- Given Delete is chosen, when the existing confirmation is cancelled, then the presentation remains; when confirmed, then the existing delete behavior runs.
- Given an entry is marked missing, then its locate behavior remains available and Rename/Delete are not offered.

## Design Notes

The Command center is a behavior and chrome refinement, not a second design system. Use the existing `--chrome-bg`, `--panel-bg`, `--panel-muted`, `--border`, `--text-muted`, and `--danger` tokens. The menu should feel like a native editor context menu: compact, anchored to the row, with Rename neutral and Delete visually destructive.

## Verification

**Commands:**
- `npm test -- --runInBand` -- expected: existing unit and integration tests pass.
- `npm run build` -- expected: TypeScript and Vite build succeed.

**Manual checks (if no CLI):**
- In the Tauri world sidebar, verify the selected Command center hierarchy, keyboard focus, menu dismissal, rename flow, missing-file behavior, and delete confirmation in both themes.

## Suggested Review Order

**Command center sidebar**

- Review the new sidebar hierarchy, contextual actions, and slide-count derivation.
  [`App.tsx:189`](../../src/App.tsx#L189)

- Review menu dismissal listeners and keyboard behavior.
  [`App.tsx:148`](../../src/App.tsx#L148)

**Visual treatment**

- Review light/dark token usage for sections, rows, footer, and anchored menu.
  [`app.css:64`](../../src/app.css#L64)

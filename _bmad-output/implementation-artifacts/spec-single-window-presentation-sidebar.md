---
title: 'Single-window presentation sidebar'
type: 'feature'
created: '2026-08-18'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'd6e0230581fc4f43abca73684e8da94c757c5351'
context:
  - '../../planning-artifacts/ux-elef-2026-08-18/EXPERIENCE.md'
  - '../../planning-artifacts/ux-elef-2026-08-18/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef currently presents an “Open editors” section even though one presentation is open per window. The presentation rows also expose a visible overflow menu for Rename/Delete, which is more direct than the file-management interaction users expect from VS Code or Obsidian.

**Approach:** Replace “Open editors” with a single “Current presentation” section that reflects the one-window model. Make presentation rows directly renameable through double-click, Enter, and F2, while keeping Delete out of the persistent row chrome and available through a deliberate keyboard/context interaction.

## Boundaries & Constraints

**Always:** Preserve one active presentation per window, current presentation opening, missing-file locating, slide counts, Quick Open filtering, autosave, delete confirmation, accessible labels, and light/dark tokens. Rename must work with keyboard and pointer input. The active presentation must remain visually distinct.

**Ask First:** None.

**Never:** Do not add multi-editor behavior, tabs, multiple active presentations, a new dependency, filesystem changes, or an always-visible Delete control.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Current presentation | One active presentation | Show one “Current presentation” entry with the active title and slide count | Empty state remains clear when none is active |
| Double-click rename | Double-click a non-missing row | Enter inline rename with the current title selected | Missing entries do not enter rename mode |
| Keyboard rename | Focus a non-missing row and press Enter or F2 | Enter inline rename without opening the file | Missing entries keep locate behavior |
| Rename cancel | Inline rename and press Escape or submit blank | Keep the original title and exit rename mode | No persistence call for blank input |
| Delete | Use the deliberate row context/keyboard action | Show existing confirmation before deleting | Cancel leaves the presentation untouched |
| Single-window navigation | Open another presentation | Replace the current presentation; do not create an editor tab | Existing open behavior is preserved |

</frozen-after-approval>

## Code Map

- `src/App.tsx` -- Tauri sidebar structure, active presentation rendering, rename state, keyboard handlers, and delete confirmation.
- `src/app.css` -- Current presentation section, presentation rows, inline rename state, focus styling, and theme tokens.
- `src/application/world/workspace.ts` -- Existing open, rename, locate, and delete persistence APIs; read-only for this change.
- `mockups/sidebar-directions.html` -- Existing visual reference for the Command center direction and slide-count treatment.

## Tasks & Acceptance

**Execution:**
- [x] `src/App.tsx` -- replace Open editors with a single Current presentation section and remove the inactive close affordance -- align the UI with one presentation per window.
- [x] `src/App.tsx` -- support double-click, Enter, and F2 rename entry on non-missing presentation rows -- match VS Code/Obsidian file interactions.
- [x] `src/App.tsx` -- retain a deliberate, non-persistent Delete path and existing confirmation -- keep destructive actions difficult to trigger accidentally.
- [x] `src/app.css` -- update labels, row affordances, focus states, and inline rename styling -- preserve the selected Command center visual language.

**Acceptance Criteria:**
- Given one presentation is active, when the sidebar renders, then it shows one Current presentation entry and no Open editors list or close button.
- Given a non-missing presentation row is focused, when Enter or F2 is pressed, then inline rename begins instead of opening the presentation.
- Given a non-missing presentation row is double-clicked, when the interaction completes, then inline rename begins.
- Given a missing presentation row is focused or activated, then locate behavior remains available and rename does not begin.
- Given inline rename is active, when Escape or a blank submission occurs, then the original title remains unchanged.
- Given a presentation is opened, when the active presentation changes, then the current entry is replaced rather than adding another editor.

## Design Notes

The sidebar should communicate “file navigator + one current document,” not an IDE tab strip. Rename is a direct file interaction; Delete should remain secondary and confirmation-protected. Keep the slide counter visible because it provides useful orientation without implying multiple editors.

## Verification

**Commands:**
- `npm test` -- expected: existing unit and integration tests pass.
- `npm run build` -- expected: TypeScript and Vite build succeed.

**Manual checks (if no CLI):**
- In Tauri, verify Current presentation, single-window switching, double-click rename, Enter/F2 rename, missing-file behavior, delete confirmation, and both themes.

## Suggested Review Order

**Single-window navigation**

- Review the one-current-presentation structure and file-row interaction handlers.
  [`App.tsx:232`](../../src/App.tsx#L232)

- Review the single Current presentation section replacing editor tabs.
  [`App.tsx:279`](../../src/App.tsx#L279)

**Visual treatment**

- Review the current-presentation grouping and inline rename styling.
  [`app.css:78`](../../src/app.css#L78)

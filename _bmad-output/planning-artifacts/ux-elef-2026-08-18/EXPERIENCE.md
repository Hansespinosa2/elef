---
name: Elef Slide Editing
status: final
sources:
  - _bmad-output/implementation-artifacts/spec-elef-world-presentation-workspace.md
updated: 2026-08-18
---

# Elef Slide Editing — Experience Spine

## Foundation

Desktop-first Tauri workspace with the existing browser Markdown workflow preserved. Markdown is the canonical source; a line containing `---` separates slides. `DESIGN.md` owns visual identity; this document owns behavior, states, accessibility, and journeys.

## Information Architecture

The existing stacked slide view remains the primary editing surface.

| Surface | Reached from | Purpose |
|---|---|---|
| Slide stack | Open or create a presentation | Edit source and see rendered slides |
| Slide insertion point | Between two slides | Add one blank slide at a known location |
| Active-slide controls | Focused slide | Delete the current slide |
| Undo notice | After deletion | Restore the deleted slide and return focus |

## Voice and Tone

Use concise, literal microcopy:

| Do | Don't |
|---|---|
| “Add slide” | “Create magic” |
| “Delete slide” | “Remove content” |
| “Slide deleted. Undo” | “Success!” |
| “Use `---` on its own line to create a new slide.” | “Separate your ideas with syntax.” |

## Component Patterns

| Component | Use | Behavioral rules |
|---|---|---|
| Add slide | Between slides | Inserts one blank slide immediately after the preceding slide and focuses it. |
| Delete slide | Active slide | Deletes immediately, preserves the deleted source for Undo, and focuses the slide that takes its place. |
| Undo notice | After deletion | Remains visible long enough to act; Undo restores the exact Markdown and focus. |
| Markdown editor | Source editing | A typed `---` on its own line remains visible in source and creates a slide boundary. |
| Active slide | Context | Shows which slide receives Add/Delete actions and keyboard boundary behavior. |

## State Patterns

| State | Treatment |
|---|---|
| Empty new slide | Keep one editable blank slide with a clear insertion caret. |
| Only slide | Delete clears its content but never leaves zero slides. |
| Deleted slide | Remove immediately; show Undo; do not open a confirmation dialog. |
| Undo used | Restore the prior slide order, source, selection, and scroll position. |
| Persistence failure | Keep edits in memory and surface the existing recoverable error state; never discard source. |
| Keyboard focus | Visible focus indicator; controls must be reachable without a pointer. |

## Interaction Primitives

- Add is contextual: the between-slide button inserts after the slide above it.
- Delete is contextual: the active slide exposes Delete.
- Typing `---` on its own line creates a boundary while keeping the separator in Markdown.
- At the first line of a slide, `Up` moves the caret to the end of the previous slide.
- At the last line of a slide, `Down` moves the caret to the start of the next slide.
- Away from those boundaries, arrow keys retain normal text-cursor behavior.
- Undo is the recovery path for accidental deletion; no routine confirmation dialog.
- Preserve existing autosave and browser/Tauri source behavior.

## Accessibility Floor

- All controls have visible text labels and accessible names.
- Add, Delete, and Undo are keyboard reachable with a logical reading order.
- Focus moves to the new slide after Add and to the replacement slide after Delete.
- Do not rely on hover alone to expose controls; touch and keyboard users need an equivalent path.
- Announce deletion and restoration through the existing status/error announcement pattern.
- Maintain visible focus styling and minimum pointer target sizes.
- Respect reduced-motion settings for Undo notices and focus transitions.

## Key Flows

### Flow 1 — Add a slide from the stack (Andres, drafting a talk)

1. Andres finishes the opening slide and moves down the stack.
2. He sees “Add slide” between the opening slide and the next slide.
3. He activates it.
4. Elef inserts a blank slide in that exact position and places focus in it.
5. He types a heading and body content.
6. **Climax:** the new content is immediately rendered as its own slide while the Markdown source gains a visible `---` boundary.

### Flow 2 — Split with Markdown (Andres, working from the keyboard)

1. Andres places the caret at the end of a slide.
2. He types `---` on its own line, then starts the next heading.
3. Elef recognizes the separator without a separate dialog or mode switch.
4. **Climax:** the source remains portable Markdown and the preview now shows two independently navigable slides.

### Flow 3 — Delete and recover (Andres, removing a wrong slide)

1. Andres focuses slide 2 of 3.
2. He activates Delete slide on that active slide.
3. Slide 2 disappears immediately; former slide 3 takes its place and receives focus.
4. Elef shows “Slide deleted. Undo.”
5. If the deletion was accidental, Andres activates Undo.
6. **Climax:** the original slide order, Markdown source, focus, and scroll position return.

### Flow 4 — Cross a slide boundary with the keyboard (Andres, editing long source)

1. Andres is at the first line of slide 2.
2. He presses Up.
3. The caret moves to the end of slide 1 and the editor scrolls to keep it visible.
4. He presses Down at the last line of slide 1.
5. The caret moves to the start of slide 2.
6. **Climax:** the slide boundary feels like a continuation of one document rather than a trapped editing region.

## Responsive & Platform

On desktop, contextual controls sit between full-width slides. On narrower browser windows, controls remain visible and stack without relying on hover. Tauri remains the primary persistence surface; browser mode keeps the same Markdown semantics.

## Open Questions

- Exact visual placement of Delete on a slide is an implementation detail to validate against the existing inline editing layout.
- The temporary Undo duration should follow the existing notification convention once one is established.

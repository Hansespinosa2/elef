# Editor UX recovery behavior matrix

This matrix is the red-test backlog. Each item must become a deterministic unit,
integration, or browser smoke test before the corresponding implementation is
considered recovered.

## Editing authority and selection

- [ ] One CodeMirror document contains the exact canonical Markdown source.
- [ ] React rendering never mutates the CodeMirror-owned editable DOM.
- [ ] Clicking a rendered slide focuses the nearest source position without
  revealing the entire slide.
- [ ] Rendered clicks map to the nearest source character when measurable.
- [ ] Rendered clicks use deterministic line or structured-unit boundaries when
  character mapping is unavailable.
- [ ] Clicking a rendered paragraph reveals only the line under the pointer.
- [ ] Clicking a rendered heading reveals only that heading line.
- [ ] Clicking a rendered list item reveals only the selected list line.
- [ ] Clicking a rendered quote reveals only the selected quote line.
- [ ] Clicking a rendered code block reveals the complete fenced block as one
  editing unit.
- [ ] Clicking a task checkbox toggles only its Markdown marker without revealing
  the surrounding source line.
- [ ] Clicking outside the active source line returns the previous line to
  rendered form.
- [ ] Moving the caret into a line does not reveal neighboring lines.
- [ ] Moving the caret to the beginning of a heading reveals its `#` markers.
- [ ] Moving the caret away from a heading hides its `#` markers again.
- [ ] Moving through ordinary paragraph text preserves the native caret position.
- [ ] Selection ranges remain stable when inactive content re-renders.
- [ ] Drag selection across rendered and source-revealed content preserves the
  exact Markdown range.
- [ ] Paste inserts source at the CodeMirror selection without duplicating or
  deleting surrounding content.
- [ ] Cut removes exactly the selected source and rerenders the affected region.
- [ ] Backspace at a source-line boundary joins adjacent content predictably.
- [ ] Delete at a source-line boundary joins adjacent content predictably.
- [ ] Tab and Shift-Tab preserve CodeMirror indentation behavior.
- [ ] Command/Ctrl-Z restores the exact previous source.
- [ ] Command/Ctrl-Shift-Z or Ctrl-Y reapplies the exact undone source.
- [ ] Undo remains coherent after rendered/source transitions.

## Slide surfaces and navigation

- [ ] Every parsed slide renders as one coherent visual surface.
- [ ] Slide surfaces use the active light/dark presentation theme consistently.
- [ ] Slide surfaces do not contain nested scrollbars.
- [ ] Slide surfaces preserve the established 16:9 visual treatment in edit mode.
- [ ] Overflow adds an inline scrollbar without leaving edit mode or hiding source.
- [ ] The overflow warning is small, non-blocking, and does not steal editor focus.
- [ ] Slide labels and boundaries remain stable while source changes.
- [ ] Clicking a slide boundary focuses the adjacent editable position.
- [ ] ArrowDown at the true last visual line of a slide moves to the beginning of
  the next slide.
- [ ] ArrowUp at the true first visual line of a slide moves to the end of the
  previous slide.
- [ ] ArrowUp/Down inside a slide remain native vertical movement.
- [ ] Wrapped visual lines do not trigger slide transitions prematurely.
- [ ] Empty slides remain focusable.
- [ ] Add creates a blank slide at the requested boundary.
- [ ] Add focuses the new slide.
- [ ] Delete removes the requested slide and focuses a sensible neighbor.
- [ ] Deleting the only slide leaves one blank slide.
- [ ] Deleting an empty slide does not delete an adjacent non-empty slide.
- [ ] Boundary controls do not become part of the Markdown source.
- [ ] Standalone `---` remains in canonical source after all boundary actions.
- [ ] `---` inside fenced code never creates a slide.
- [ ] `---` inside front matter never creates a slide.
- [ ] Typing the third dash on an otherwise empty line creates a slide.
- [ ] An incomplete `--` remains editable text.
- [ ] Backspace after a newly inserted boundary follows the documented invariant.

## Markdown rendering and source preservation

- [ ] Headings render with the established slide typography.
- [ ] Paragraphs render with the established slide spacing.
- [ ] Strong, emphasis, and deletion preserve exact source on edit.
- [ ] Inline code renders without losing backticks on source reveal.
- [ ] Fenced code preserves fence marker, language, and body exactly.
- [ ] Block quotes render consistently and preserve `>` markers on reveal.
- [ ] Ordered lists preserve numbering and indentation.
- [ ] Unordered lists preserve marker style and indentation.
- [ ] Empty list items can become normal paragraphs.
- [ ] Task checkboxes render interactively.
- [ ] Toggling a task checkbox changes only its Markdown marker.
- [ ] Tables render correctly.
- [ ] Editing a table preserves pipes and alignment markers.
- [ ] Links render correctly and remain source-editable.
- [ ] Images render correctly without becoming editable DOM.
- [ ] Horizontal rules render only when they are not structural slide delimiters.
- [ ] Front matter never renders as slide content.
- [ ] Front matter remains source-preserving and locally editable.
- [ ] Presentation theme metadata remains valid after editing.
- [ ] Malformed Markdown remains editable and does not crash rendering.

## TeX behavior

- [ ] Inline TeX renders with KaTeX when the source is valid.
- [ ] Display TeX renders with KaTeX when the source is valid.
- [ ] Clicking TeX reveals only that formula's exact source.
- [ ] Double-clicking TeX selects the exact delimiter-inclusive source range.
- [ ] Moving away from TeX restores its rendered form.
- [ ] Editing TeX preserves surrounding Markdown.
- [ ] Invalid TeX remains visible as editable source.
- [ ] Incomplete TeX remains visible as editable source.
- [ ] Invalid TeX shows a non-blocking error state.
- [ ] Invalid TeX never throws during CodeMirror decoration updates.
- [ ] Repeated TeX click/edit/re-render cycles do not duplicate or delete source.
- [ ] Display-math line breaks remain exact across reveal and rerender.

## Overflow and splitting

- [ ] Overflow is detected without requiring a slow Tauri E2E run.
- [ ] Overflow warning does not automatically modify source.
- [ ] Split preview shows the proposed canonical Markdown.
- [ ] Canceling split leaves source, selection, and undo history unchanged.
- [ ] Confirming split inserts structural delimiters only at valid boundaries.
- [ ] Confirming split preserves all original content.
- [ ] Confirming split focuses the newly created slide.
- [ ] Split supports top-level heading boundaries.
- [ ] Split refuses or explains when no safe split point exists.
- [ ] Split can be undone once with exact source restoration.
- [ ] Split preview remains usable while the editor is scrolled.

## Persistence and recovery

- [ ] Source changes are persisted in the background after the debounce.
- [ ] Rapid typing coalesces into one persistence sequence.
- [ ] A failed save retries without blocking editing.
- [ ] A failed save never replaces current in-memory source with stale source.
- [ ] Recovery snapshots are written silently.
- [ ] Normal editing never displays a recovery banner.
- [ ] A crash before persistence can recover the latest settled snapshot.
- [ ] Successful persistence does not create an intrusive UI state.
- [ ] Switching presentations flushes or safely queues pending persistence.
- [ ] Closing a presentation flushes the pending source.
- [ ] Renaming a presentation does not lose a pending source edit.
- [ ] Browser and Tauri persistence share the same editor behavior.

## Resilience and accessibility

- [ ] Repeated click, type, undo, preview, and slide navigation never causes a
  React placement/reconciliation crash.
- [ ] Editor focus remains visible without a full-slide outline flash.
- [ ] Buttons are keyboard reachable and have stable accessible names.
- [ ] Slide controls do not intercept ordinary text selection.
- [ ] Reduced-motion preferences disable decorative transitions.
- [ ] Light mode has no dark source surfaces unless actively editing source.
- [ ] Dark mode has no light source surfaces unless actively editing source.
- [ ] Empty documents render a usable blank first slide.
- [ ] Very long slides remain navigable without trapping the caret.
- [ ] The editor remains usable when KaTeX or Markdown rendering fails.

## Presentation mode

- [ ] Present mode is separate from edit mode.
- [ ] Present mode renders fixed 16:9 pages without editor controls.
- [ ] Present mode supports previous/next navigation.
- [ ] Present mode can enter fullscreen when supported.
- [ ] Returning from Present mode restores the prior editor selection.
- [ ] Present mode never changes canonical Markdown.

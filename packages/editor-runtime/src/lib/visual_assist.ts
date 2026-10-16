// Shared bridge between assist controllers (snippet/link/math/mermaid/
// metadata palettes) and the visual projection host. Every assist reads the
// engine and commits through it in both modes; only anchoring, key routing,
// insertion follow-up, and popup announcements differ in visual mode.
export function assistsInMode(editor: { editingMode?: string } | null | undefined): boolean {
  return !!editor && (editor.editingMode === "source" || editor.editingMode === "visual")
}

export interface VisualAssistHost {
  applyVisualAssistInsert?: (edit: { from: number; to: number; insert: string; caret: number }) => boolean;
  restoreCaret?: (sourceOffset: number, preferredBlockId: string | null) => boolean;
}

// The document editor exposes its Stimulus adapter on the form while the
// presentation editor exposes its instance directly; both surfaces carry
// the assist pipeline methods.
export function projectionHostFor(element: Element): VisualAssistHost | null {
  const form = element.closest("form") as unknown as {
    presentationEditorController?: VisualAssistHost;
    visualEditorController?: VisualAssistHost;
  } | null;
  return form?.presentationEditorController || form?.visualEditorController || null;
}

export function placeVisualCaret(element: Element, sourceOffset: number): void {
  projectionHostFor(element)?.restoreCaret?.(sourceOffset, null);
}

// Native caret rect for fixed-position palettes in visual mode. Null when
// no usable caret exists; callers keep their last position then.
export function visualCaretRect(): { left: number; top: number; bottom: number } | null {
  const selection = window.getSelection()
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  const rect = range?.getBoundingClientRect()
  if (!rect || (rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0)) return null
  return rect
}

// In visual mode the native caret lives in the projection block, so mirror
// the popup state there for assistive technology.
export function mirrorPopupAccessibility(fieldElement: Element, params: { open: boolean; selectedId: string | null }): void {
  const active = document.activeElement
  if (!active || active === document.body || !fieldElement.closest("form")?.contains(active)) return
  active.setAttribute("aria-expanded", String(params.open))
  if (params.selectedId) active.setAttribute("aria-activedescendant", params.selectedId)
  else active.removeAttribute("aria-activedescendant")
}

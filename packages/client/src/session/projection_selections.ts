export interface ProjectionSelectionRange { anchor: number; head: number }
export interface ProjectionSelectionPoint { node: Node; offset: number }

// Paint outside the projection tree so selections never affect pagination
// or enter clipboard contents. The native selection owns the primary input.
export function paintProjectionSelections(
  root: Element,
  selections: readonly ProjectionSelectionRange[],
  point: (sourceOffset: number) => ProjectionSelectionPoint | null,
): void {
  root.querySelector(":scope > .elef-projection-selections")?.remove()
  if (selections.length < 2) return
  const document = root.ownerDocument
  if (!document?.createRange) return
  const layer = document.createElement("div")
  layer.className = "elef-projection-selections"
  layer.setAttribute("aria-hidden", "true")
  layer.style.cssText = "pointer-events:none;position:fixed;inset:0;z-index:19"
  for (const selection of selections) {
    const anchor = point(selection.anchor)
    const head = point(selection.head)
    if (!anchor || !head) continue
    const from = selection.anchor <= selection.head ? anchor : head
    const to = selection.anchor <= selection.head ? head : anchor
    const range = document.createRange()
    try {
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.height <= 0) continue
        const mark = document.createElement("div")
        mark.className = "elef-projection-selection"
        const collapsed = selection.anchor === selection.head
        mark.style.cssText = `position:fixed;pointer-events:none;left:${rect.left}px;top:${rect.top}px;width:${collapsed ? 2 : rect.width}px;height:${rect.height}px;background:var(--oradia-vim-selection,rgba(110,160,200,.35))`
        layer.append(mark)
      }
    } catch {
      // Pending projections can lack an endpoint; fresh revisions repaint.
    }
  }
  root.append(layer)
}

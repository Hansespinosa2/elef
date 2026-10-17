// Visual assist insertion shared by the document and presentation editors.
//
// A suggestion accept commits to the engine while a projection block holds
// focus, so the preview reinstall defers (by design) and the block DOM would
// show pre-insert text until blur. This pipeline keeps the session coherent
// immediately: shift the source map over the committed edit, patch the caret
// text node in place, and place the native caret after the insertion.
//
// The patch exploits one exact fact: the replaced query is literal text
// around the pre-commit caret, so its visible length equals its source
// length and it sits in the focus text node around the focus offset. The
// caret can sit inside the replaced range (promote and backspace replace
// a pair around it), so the DOM extent centers on the pre-commit
// selection, not the range end. When callers pass the replaced source it
// is verified (nbsp-tolerant) before anything is deleted: a mismatch
// means whitespace lag shifted the extent, and skipping the patch is
// always safer than deleting the wrong characters. Multiline inserts
// split across <br> elements (raw newlines inside <pre>), matching the
// newline-invisible DOM/map convention. Pure inserts (pairing, fences) also
// land in empty blocks: with no text node at focus, the text is created at
// the focus position instead of patched. Skipped patches still shift the
// map and stage the caret restore, and the reinstall heals the display.
// Callers place the native caret through the bridge after this returns;
// the in-patch placement is an after-insert fallback only.
export interface AssistInsertHost {
  projectionTarget: Element | null | undefined;
  allRegions(): Array<{ content_range: { start: number; end: number }; block_id?: string | null }>;
  shiftMapAfterEdit(from: number, to: number, replacementLength: number, editedBlockId?: string | null): void;
  stageCaretRestore(restore: { sourceOffset: number; preferredBlockId: string | null }): void;
}

export interface AssistInsertEdit {
  from: number;
  to: number;
  insert: string;
  caret: number;
  // Pre-commit caret centering the DOM extent (defaults to the range end,
  // the palette-accept shape). Outside [from, to] the patch cannot land.
  selectionBefore?: number;
  // Source text the range held before the commit; when present the DOM
  // extent must match it (nbsp-tolerant) or the patch is skipped.
  replaced?: string;
}

export function applyVisualAssistInsert(
  host: AssistInsertHost,
  edit: AssistInsertEdit,
  selection: Selection | null | undefined = globalThis.window?.getSelection?.() ?? null
): boolean {
  const { from, to, insert, caret, selectionBefore, replaced } = edit
  const anchor = selectionBefore ?? to
  const beforeLength = anchor - from
  const afterLength = to - anchor
  const candidates = host.allRegions().filter((region) =>
    from >= region.content_range.start && from <= region.content_range.end)
  // Most specific containing range first (a caret inside nested regions
  // belongs to the innermost block).
  candidates.sort((left, right) =>
    (left.content_range.end - left.content_range.start) - (right.content_range.end - right.content_range.start))
  const region = candidates[0]
  if (!region) {
    host.stageCaretRestore({ sourceOffset: caret, preferredBlockId: null })
    return false
  }
  const blockId = region.block_id ?? null
  host.shiftMapAfterEdit(from, to, insert.length, blockId)
  host.stageCaretRestore({ sourceOffset: caret, preferredBlockId: blockId })

  if (beforeLength < 0 || afterLength < 0) return false
  const focusNode = selection?.focusNode ?? null
  const focusOffset = selection?.focusOffset ?? 0
  if (!focusNode) return false
  if (focusNode.nodeType !== Node.TEXT_NODE) {
    // Element-anchored focus (empty blocks, boundaries): only pure
    // inserts can land without existing text to replace.
    if (from !== to || insert.length === 0) return false
    const container = focusNode as Element
    const block = container.closest?.("[data-editor-block-id]")
    if (!block || !host.projectionTarget?.contains(block)) return false
    try {
      const owner = container.ownerDocument
      const textNode = owner.createTextNode("")
      const before = container.childNodes[Math.min(focusOffset, container.childNodes.length)] ?? null
      container.insertBefore(textNode, before)
      if (!insertAssistText(textNode, 0, insert)) {
        textNode.remove()
        return false
      }
      // No caret placement here: the caller positions through the
      // bridge once the text exists (middle-of-pair included).
      return true
    } catch {
      return false
    }
  }
  if (focusOffset < beforeLength) return false
  const block = (focusNode.parentElement as Element | null)?.closest?.("[data-editor-block-id]")
  if (!block || !host.projectionTarget?.contains(block)) return false

  try {
    const textNode = focusNode as Text
    const domFrom = focusOffset - beforeLength
    const domTo = focusOffset + afterLength
    if (domTo > (textNode.data?.length ?? 0)) return false
    if (replaced !== undefined) {
      const actual = (textNode.data ?? "").slice(domFrom, domTo).replace(/\u00a0/g, " ")
      if (actual !== replaced.replace(/\u00a0/g, " ")) return false
    }
    textNode.deleteData(domFrom, beforeLength + afterLength)
    const placed = insertAssistText(textNode, domFrom, insert)
    if (!placed) return false
    selection?.setPosition?.(placed[0], placed[1])
    return true
  } catch {
    return false
  }
}

function insertAssistText(textNode: Text, at: number, insert: string): [Node, number] | null {
  const parent = textNode.parentNode
  if (!parent) return null
  if ((textNode.parentElement as Element | null)?.closest?.("pre")) {
    textNode.insertData(at, insert)
    return [textNode, at + insert.length]
  }
  const lines = insert.split("\n")
  if (lines.length === 1) {
    textNode.insertData(at, insert)
    return [textNode, at + insert.length]
  }
  // Manual splitText (identical semantics): linkedom lacks splitText, and
  // the explicit form works in every DOM.
  const owner = textNode.ownerDocument
  const right = owner.createTextNode(textNode.data.slice(at))
  textNode.deleteData(at, textNode.data.length - at)
  parent.insertBefore(right, textNode.nextSibling)
  let node: Node = right
  let offset = 0
  lines.forEach((line, index) => {
    if (index > 0) parent.insertBefore(owner.createElement("br"), right)
    if (line.length === 0) {
      node = right
      offset = 0
      return
    }
    const text = owner.createTextNode(line)
    parent.insertBefore(text, right)
    node = text
    offset = line.length
  })
  return [node, offset]
}

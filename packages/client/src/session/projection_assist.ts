// Visual assist insertion shared by the document and presentation editors.
//
// A suggestion accept commits to the engine while a projection block holds
// focus, so the preview reinstall defers (by design) and the block DOM would
// show pre-insert text until blur. This pipeline keeps the session coherent
// immediately: shift the source map over the committed edit, patch the caret
// text node in place, and place the native caret after the insertion.
//
// The patch exploits one exact fact: the accepted query is literal typed text
// ending at the caret, so its visible length equals its source length and it
// sits in the focus text node ending at the focus offset. Multiline inserts
// split across <br> elements (raw newlines inside <pre>), matching the
// newline-invisible DOM/map convention. When the caret is not in a text node
// the DOM patch is skipped: the map shift and pending caret restore still
// land, and the blur reinstall heals the display.
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
}

export function applyVisualAssistInsert(
  host: AssistInsertHost,
  edit: AssistInsertEdit,
  selection: Selection | null | undefined = globalThis.window?.getSelection?.() ?? null
): boolean {
  const { from, to, insert, caret } = edit
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

  const queryLength = to - from
  const focusNode = selection?.focusNode ?? null
  const focusOffset = selection?.focusOffset ?? 0
  if (!focusNode || focusNode.nodeType !== Node.TEXT_NODE || focusOffset < queryLength) return false
  const block = (focusNode.parentElement as Element | null)?.closest?.("[data-editor-block-id]")
  if (!block || !host.projectionTarget?.contains(block)) return false

  try {
    const textNode = focusNode as Text
    textNode.deleteData(focusOffset - queryLength, queryLength)
    const placed = insertAssistText(textNode, focusOffset - queryLength, insert)
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

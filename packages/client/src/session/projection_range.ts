// Native selections can span independent contenteditable hosts (or page
// fragments). Browsers cannot reliably edit that range as one operation.
// Resolve both endpoints before mutation and commit the same source range
// the editing engine would replace in source mode.
export interface ProjectionRangeInput {
  readonly inputType: string
  readonly data?: string | null | undefined
  readonly cancelable?: boolean | undefined
  readonly isComposing?: boolean | undefined
  preventDefault?(): void
  readonly dataTransfer?: {
    getData(type: string): string
  } | null | undefined
}

export interface ProjectionRangeEdit {
  from: number
  to: number
  insert: string
}

export function projectionWrapSelection(
  event: ProjectionRangeInput,
  root: Element,
  selection: Selection | null,
  sourceOffset: (block: HTMLElement, node: Node, offset: number) => number | null,
): { from: number; to: number; anchor: number; head: number; marker: "*" | "`" } | null {
  if (event.cancelable === false || event.isComposing || !event.preventDefault || event.inputType !== "insertText"
      || (event.data !== "*" && event.data !== "`") || !selection || selection.isCollapsed
      || !selection.anchorNode || !selection.focusNode) return null
  const elFor = (node: Node): Element | null => node.nodeType === 1 ? (node as Element) : node.parentElement
  const blockFor = (node: Node): HTMLElement | null =>
    elFor(node)?.closest<HTMLElement>("[data-editor-block-id][contenteditable='true']") ?? null
  const anchorEl = elFor(selection.anchorNode)
  const focusEl = elFor(selection.focusNode)
  const protectedSelector = "pre, [data-editor-math-source], [data-editor-math-active], .editor-math-active, [data-elef-math-source], .editor-reveal-math, .katex"
  if (anchorEl?.closest(protectedSelector) || focusEl?.closest(protectedSelector)) return null
  const first = blockFor(selection.anchorNode)
  const last = blockFor(selection.focusNode)
  if (!first || !last || !root.contains(first) || !root.contains(last)) return null
  const anchorCell = anchorEl?.closest("th, td") ?? null
  const focusCell = focusEl?.closest("th, td") ?? null
  if ((anchorCell || focusCell || first.querySelector("table") || last.querySelector("table"))
      && (!anchorCell || anchorCell !== focusCell)) return null
  const anchor = sourceOffset(first, selection.anchorNode, selection.anchorOffset)
  const head = sourceOffset(last, selection.focusNode, selection.focusOffset)
  if (anchor === null || head === null || anchor === head) return null
  return { from: Math.min(anchor, head), to: Math.max(anchor, head), anchor, head, marker: event.data }
}

export function projectionRangeEdit(
  event: ProjectionRangeInput,
  root: Element,
  selection: Selection | null,
  sourceOffset: (block: HTMLElement, node: Node, offset: number) => number | null,
): ProjectionRangeEdit | null {
  if (event.cancelable === false || !event.preventDefault || !selection || selection.isCollapsed
      || !selection.anchorNode || !selection.focusNode) return null
  const blockFor = (node: Node): HTMLElement | null => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement
    return element?.closest<HTMLElement>("[data-editor-block-id][contenteditable='true']") ?? null
  }
  const anchorBlock = blockFor(selection.anchorNode)
  const focusBlock = blockFor(selection.focusNode)
  if (!anchorBlock || !focusBlock || anchorBlock === focusBlock
      || !root.contains(anchorBlock) || !root.contains(focusBlock)) return null
  let insert: string
  switch (event.inputType) {
    case "deleteContentBackward":
    case "deleteContentForward":
    case "deleteByCut":
    case "deleteByDrag":
      insert = ""
      break
    case "insertText":
      if (typeof event.data !== "string") return null
      insert = event.data
      break
    case "insertFromPaste":
    case "insertFromDrop":
      if (!event.dataTransfer) return null
      try { insert = event.dataTransfer.getData("text/plain") } catch { return null }
      break
    default:
      return null
  }
  const anchor = sourceOffset(anchorBlock, selection.anchorNode, selection.anchorOffset)
  const head = sourceOffset(focusBlock, selection.focusNode, selection.focusOffset)
  if (anchor === null || head === null || anchor === head) return null
  return { from: Math.min(anchor, head), to: Math.max(anchor, head), insert }
}

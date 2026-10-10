const MARKDOWN_MATH = /^\$\$[\s\S]+?\$\$|^\$(?!\$)[^$\r\n]+?\$(?!\$)/

export function visibleOffsetAtPoint(root: Node, target: Node, offset: number): number | null {
  let visibleOffset = 0
  let result: number | null = null

  const visit = (node: Node): void => {
    if (result !== null || isHiddenText(node, root)) return
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        result = visibleOffset + Math.max(0, Math.min(offset, (node.textContent ?? "").length))
      } else {
        const childOffset = Math.max(0, Math.min(offset, node.childNodes.length))
        for (let index = 0; index < childOffset; index += 1) visibleOffset += visibleLength(node.childNodes[index] as Node, root)
        result = visibleOffset
      }
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      visibleOffset += (node.textContent ?? "").length
      return
    }
    for (const child of node.childNodes || []) visit(child)
  }

  visit(root)
  return result
}

export function pointAtVisibleOffset(root: Node, requestedOffset: number): [Node, number] {
  const target = Math.max(0, requestedOffset)
  let visibleOffset = 0
  let lastText: Node | null = null
  let result: [Node, number] | null = null

  const visit = (node: Node): void => {
    if (result || isHiddenText(node, root)) return
    if (node.nodeType === Node.TEXT_NODE) {
      lastText = node
      const end = visibleOffset + (node.textContent ?? "").length
      if (target <= end) {
        result = [node, Math.max(0, target - visibleOffset)]
        return
      }
      visibleOffset = end
      return
    }
    for (const child of node.childNodes || []) visit(child)
  }

  visit(root)
  if (result) return result
  if (lastText) {
    const tail: Node = lastText
    return [tail, (tail.textContent ?? "").length]
  }
  return [root, 0]
}

export function sourceOffsetForVisibleOffset(source: string, requestedOffset: number): number {
  const mapping = markdownPositionMap(source)
  const visibleOffset = Math.max(0, Math.min(requestedOffset, mapping.visibleToSource.length - 1))
  return mapping.visibleToSource[visibleOffset] ?? source.length
}

export function visibleOffsetForSourceOffset(source: string, requestedOffset: number): number {
  const mapping = markdownPositionMap(source)
  const sourceOffset = Math.max(0, Math.min(requestedOffset, source.length))
  return mapping.sourceToVisible[sourceOffset] ?? mapping.visibleToSource.length - 1
}

export function moveCaretBetweenBlocks(event: KeyboardEvent, projection: Element | null): boolean {
  if (!projection || !["ArrowUp", "ArrowDown"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false

  const selection = window.getSelection()
  if (!selection?.isCollapsed || !selection.focusNode) return false
  const focusNode = selection.focusNode
  const focusElement = focusNode.nodeType === Node.ELEMENT_NODE ? focusNode as Element : focusNode.parentElement
  const block = focusElement?.closest?.("[data-editor-block-id][contenteditable='true']")
  if (!block || !projection.contains(block)) return false

  const direction = event.key === "ArrowDown" ? 1 : -1
  const lineRects = textRects(block)
  if (lineRects.length === 0) return moveToNeighbor(event, projection, block, selection, direction, null)

  const caretRect = caretBounds(selection.focusNode, selection.focusOffset)
  if (!caretRect) return false
  const currentEdge = (direction > 0 ? lineRects.at(-1) : lineRects[0]) as DOMRect
  const lineHeight = Math.max(1, currentEdge.height || parseFloat(getComputedStyle(block).lineHeight) || 18)
  const atEdge = direction > 0
    ? caretRect.bottom >= currentEdge.bottom - lineHeight * 0.45
    : caretRect.top <= currentEdge.top + lineHeight * 0.45
  if (!atEdge) return false

  const x = selection.focusNode.nodeType === Node.TEXT_NODE && selection.focusOffset > 0 && caretRect.width > 0
    ? caretRect.right
    : caretRect.left
  return moveToNeighbor(event, projection, block, selection, direction, x)
}

export function removeEmptyBlockSource(source: string, from: number, to: number): string {
  const start = Math.max(0, Math.min(from, source.length))
  let end = Math.max(start, Math.min(to, source.length))
  const leading = source.slice(0, start)
  const following = source.slice(end)
  const newline = following.match(/^\r?\n/)?.[0]

  if (!leading && newline) {
    end += newline.length
  } else if (/\r?\n\r?\n$/.test(leading) && newline) {
    end += newline.length
  }

  return `${leading}${source.slice(end)}`
}

function moveToNeighbor(event: KeyboardEvent, projection: Element, block: Element, selection: Selection, direction: number, preferredX: number | null): boolean {
  const blocks = [...projection.querySelectorAll("[data-editor-block-id][contenteditable='true']")]
  const index = blocks.indexOf(block)
  const target = blocks[index + direction]
  if (!target) return false

  const targetLines = textRects(target)
  const targetEdge = direction > 0 ? targetLines[0] : targetLines.at(-1)
  const fallbackRect = target.getBoundingClientRect()
  const x = typeof preferredX === "number" && Number.isFinite(preferredX) ? preferredX : fallbackRect.left + 1
  const y = targetEdge
    ? targetEdge.top + targetEdge.height / 2
    : fallbackRect.top + (direction > 0 ? 1 : Math.max(1, fallbackRect.height - 1))
  const point = pointFromViewport(x, y, target)

  if (!point) return false
  event.preventDefault()
  ;(target as HTMLElement).focus({ preventScroll: true })
  selection.setPosition(point[0], point[1])
  target.scrollIntoView({ block: "nearest", inline: "nearest" })
  return true
}

function pointFromViewport(x: number, y: number, target: Element): [Node, number] {
  const caret = document.caretPositionFromPoint?.(x, y)
  if (caret && target.contains(caret.offsetNode)) return [caret.offsetNode, caret.offset]

  const range = document.caretRangeFromPoint?.(x, y)
  if (range && target.contains(range.startContainer)) return [range.startContainer, range.startOffset]

  return pointAtVisibleOffset(target, y < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2 ? 0 : Number.MAX_SAFE_INTEGER)
}

function caretBounds(node: Node, offset: number): DOMRect | null {
  const range = document.createRange()
  try {
    range.setStart(node, offset)
    range.collapse(true)
    let rect = range.getBoundingClientRect()
    if (rect.height > 0) return rect

    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").length > 0) {
      const text = node as Text
      const from = Math.max(0, Math.min(offset > 0 ? offset - 1 : offset, text.textContent.length - 1))
      range.setStart(node, from)
      range.setEnd(node, Math.min(text.textContent.length, from + 1))
      rect = range.getBoundingClientRect()
      if (rect.height > 0) return rect
    }
  } catch (_error) {
    return null
  }
  return null
}

function textRects(element: Element): DOMRect[] {
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (isHiddenText(node, element) || !(node.textContent ?? "").trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    rects.push(...[...range.getClientRects()].filter((rect) => rect.height > 0))
  }
  return rects.sort((left, right) => left.top - right.top || left.left - right.left)
}

function visibleLength(node: Node, root: Node): number {
  if (isHiddenText(node, root)) return 0
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").length
  return [...(node.childNodes || [])].reduce((sum, child) => sum + visibleLength(child, root), 0)
}

function isHiddenText(node: Node, root: Node): boolean {
  if (node === root) return false
  if (node.nodeType === Node.TEXT_NODE && node.parentNode === root && (node.textContent ?? "").trim() === "") return true
  let element: Element | null = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  while (element && element !== root) {
    if (element.getAttribute("contenteditable") === "false" || element.getAttribute("aria-hidden") === "true" || element.classList?.contains("katex-mathml")) return true
    element = element.parentElement
  }
  return false
}

function markdownPositionMap(source: string): { sourceToVisible: number[]; visibleToSource: number[] } {
  const sourceToVisible = new Array<number>(source.length + 1).fill(0)
  const visibleToSource = [0]
  let sourceIndex = 0
  let visibleIndex = 0

  const skip = (end: number): void => {
    for (let index = sourceIndex; index < end; index += 1) sourceToVisible[index] = visibleIndex
    sourceIndex = end
    sourceToVisible[sourceIndex] = visibleIndex
    visibleToSource[visibleIndex] = sourceIndex
  }
  const emit = (from: number, to: number): void => {
    skip(from)
    for (let index = from; index < to; index += 1) {
      sourceToVisible[index] = visibleIndex
      visibleIndex += 1
      sourceToVisible[index + 1] = visibleIndex
      visibleToSource[visibleIndex] = index + 1
    }
    sourceIndex = to
  }

  while (sourceIndex < source.length) {
    const rest = source.slice(sourceIndex)
    const linePrefix = rest.match(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)/)
    if (linePrefix) {
      skip(sourceIndex + (linePrefix[0] ?? "").length)
      continue
    }

    const image = rest.match(/^!\[([^\]]*)\]\((?:\\.|[^)])*\)/)
    if (image) {
      const matchStart = sourceIndex
      const altStart = matchStart + 2
      emit(altStart, altStart + (image[1] ?? "").length)
      skip(matchStart + (image[0] ?? "").length)
      continue
    }

    const link = rest.match(/^\[([^\]]+)\]\((?:\\.|[^)])*\)/)
    if (link) {
      const matchStart = sourceIndex
      const textStart = matchStart + 1
      emit(textStart, textStart + (link[1] ?? "").length)
      skip(matchStart + (link[0] ?? "").length)
      continue
    }

    const documentLink = rest.match(/^\[\[([^\]]+)\]\]/)
    if (documentLink) {
      const matchStart = sourceIndex
      const textStart = matchStart + 2
      emit(textStart, textStart + (documentLink[1] ?? "").length)
      skip(matchStart + (documentLink[0] ?? "").length)
      continue
    }

    const math = rest.match(MARKDOWN_MATH)
    if (math) {
      skip(sourceIndex + (math[0] ?? "").length)
      continue
    }

    const tableDivider = rest.match(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*(?=\r?$)/m)
    if (tableDivider && (sourceIndex === 0 || source[sourceIndex - 1] === "\n")) {
      skip(sourceIndex + (tableDivider[0] ?? "").length)
      continue
    }

    if (rest.startsWith("\\") && rest.length > 1 && /[\\`*_{}\[\]()#+.!|>~-]/.test(rest[1] ?? "")) {
      emit(sourceIndex + 1, sourceIndex + 2)
      continue
    }

    if (rest.startsWith("\r\n")) {
      skip(sourceIndex + 2)
      continue
    }
    if (rest[0] === "\n" || rest[0] === "\r" || rest[0] === "|") {
      skip(sourceIndex + 1)
      continue
    }

    const delimiter = rest.match(/^(?:\*\*|__|~~|`+|\*|_)/)
    if (delimiter) {
      skip(sourceIndex + (delimiter[0] ?? "").length)
      continue
    }

    emit(sourceIndex, sourceIndex + 1)
  }

  sourceToVisible[source.length] = visibleIndex
  visibleToSource[visibleIndex] = source.length
  return { sourceToVisible, visibleToSource }
}

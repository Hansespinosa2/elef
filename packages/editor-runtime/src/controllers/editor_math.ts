import { cachedKatex, loadKatex } from "../lib/katex_loader.js"
import type { KatexApi } from "../lib/katex_loader.js"

export interface MathCaretOptions {
  caret?: string;
  clickEvent?: MouseEvent | null;
}

export function deRenderMath(mathElement: Element | null | undefined, { caret = "end", clickEvent = null }: MathCaretOptions = {}): HTMLSpanElement | null {
  if (!mathElement?.parentNode) return null

  const math = mathElement as HTMLElement
  const source = math.dataset.editorMathSource ?? ""
  const isDisplay = mathElement.classList.contains("editor-live-math-display") || mathElement.classList.contains("katex-display")
  const open = math.dataset.editorMathOpen || (isDisplay ? "$$" : "$")
  const close = math.dataset.editorMathClose || open
  const fullText = `${open}${source}${close}`

  const activeSpan = createActiveMathSpan(fullText, { source, open, close, display: isDisplay })
  const textNode = activeSpan.firstChild as Node

  mathElement.parentNode.replaceChild(activeSpan, mathElement)

  const selection = window.getSelection()
  if (caret === "end") {
    const offset = Math.max(open.length, fullText.length - close.length)
    selection?.setBaseAndExtent(textNode, offset, textNode, offset)
  } else if (caret === "start") {
    const openingLineBreak = source.match(/^(?:\r\n|\r|\n)/)?.[0].length || 0
    const offset = open.length + (isDisplay ? openingLineBreak : 0)
    selection?.setBaseAndExtent(textNode, offset, textNode, offset)
  } else if (caret === "click" && clickEvent) {
    let offset: number | null | undefined = null
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY)
      if (pos && activeSpan.contains(pos.offsetNode)) {
        offset = pos.offset
      }
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY)
      if (range && activeSpan.contains(range.startContainer)) {
        offset = range.startOffset
      }
    }
    if (offset === null || offset === undefined) {
      offset = fullText.length - close.length
    }
    offset = Math.max(open.length, Math.min(offset, fullText.length - close.length))
    selection?.setBaseAndExtent(textNode, offset, textNode, offset)
  }

  return activeSpan
}

export interface ActiveMathSpanOptions {
  source?: string;
  open?: string;
  close?: string;
  display?: boolean;
}

function renderMathElement(katex: KatexApi, expression: string, open: string, close: string, isDisplay: boolean): ChildNode {
  try {
    const wrapper = document.createElement("span")
    wrapper.innerHTML = katex.renderToString(expression, { displayMode: isDisplay, throwOnError: true, output: "mathml" })
    const math = wrapper.firstElementChild as HTMLElement | null
    if (!math) throw new Error("KaTeX produced no output")
    math.dataset.editorMathSource = expression
    math.dataset.editorMathOpen = open
    math.dataset.editorMathClose = close
    // Same katex-display restoration as the inline renderer: the
    // class marks display math while editor CSS keeps inline layout.
    if (isDisplay) math.classList.add("editor-live-math-display", "katex-display")
    math.contentEditable = "false"
    return math
  } catch (_error) {
    const mathError = document.createElement("span")
    mathError.className = "math-error"
    mathError.dataset.editorMathSource = expression
    mathError.dataset.editorMathOpen = open
    mathError.dataset.editorMathClose = close
    mathError.contentEditable = "false"
    mathError.title = "Invalid TeX"
    mathError.textContent = expression
    return mathError
  }
}

export function createActiveMathSpan(fullText: string, { source = "", open = "$", close = open, display = false }: ActiveMathSpanOptions = {}): HTMLSpanElement {
  const activeSpan = document.createElement("span")
  activeSpan.className = "editor-math-active"
  activeSpan.dataset.editorMathActive = "true"
  activeSpan.dataset.editorMathOpen = open
  activeSpan.dataset.editorMathClose = close
  activeSpan.dataset.editorMathSource = source
  if (display) activeSpan.classList.add("editor-live-math-display")
  activeSpan.contentEditable = "true"
  activeSpan.spellcheck = false
  activeSpan.appendChild(document.createTextNode(fullText))
  return activeSpan
}

export function reRenderMath(activeSpan: Element | null, { caret = null }: { caret?: string | null } = {}, onFlush: (() => void) | null = null): Node | null {
  if (!activeSpan?.parentNode) return null

  if (typeof onFlush === "function") {
    onFlush()
  }

  const span = activeSpan as HTMLElement
  const fullText = span.textContent || ""
  const open = span.dataset.editorMathOpen || (span.classList.contains("editor-live-math-display") ? "$$" : "$")
  const close = span.dataset.editorMathClose || open

  let replacement: ChildNode
  const isDisplay = open === "$$" || open === "\\["
  const hasDelimiters = fullText.startsWith(open) && fullText.endsWith(close) && fullText.length >= (open.length + close.length)

  if (hasDelimiters) {
    const expression = fullText.slice(open.length, fullText.length - close.length)
    const katex = cachedKatex()
    if (katex?.renderToString && expression.trim().length > 0) {
      replacement = renderMathElement(katex, expression, open, close, isDisplay)
    } else if (!katex && expression.trim().length > 0) {
      // KaTeX not yet loaded (interaction outran the post-settle
      // preload): flush synchronously with a quacking placeholder so
      // caret and editing flow keep today's exact timing, then swap in
      // the identical render on arrival. The swap only touches the
      // placeholder node, so sibling-placed carets survive it.
      const pending = document.createElement("span")
      pending.className = "editor-math-pending"
      pending.dataset.editorMathSource = expression
      pending.dataset.editorMathOpen = open
      pending.dataset.editorMathClose = close
      if (isDisplay) pending.classList.add("editor-live-math-display")
      pending.contentEditable = "false"
      pending.textContent = fullText
      replacement = pending
      loadKatex().then(
        (api) => {
          if (!pending.isConnected || !pending.parentNode) return
          pending.parentNode.replaceChild(renderMathElement(api, expression, open, close, isDisplay), pending)
        },
        () => {
          // Load failure renders like today's missing-KaTeX path: plain
          // source text with no math datasets.
          if (!pending.isConnected || !pending.parentNode) return
          pending.parentNode.replaceChild(document.createTextNode(fullText), pending)
        }
      )
    } else {
      replacement = document.createTextNode(fullText)
    }
  } else {
    replacement = document.createTextNode(fullText)
  }

  const parent = activeSpan.parentNode
  parent.replaceChild(replacement, activeSpan)

  if (caret === "after") {
    let afterNode = replacement.nextSibling
    if (!afterNode || afterNode.nodeType !== Node.TEXT_NODE) {
      afterNode = document.createTextNode("")
      replacement.after(afterNode)
    }
    const selection = window.getSelection()
    selection?.setBaseAndExtent(afterNode, 0, afterNode, 0)
  } else if (caret === "before") {
    let beforeNode = replacement.previousSibling
    if (!beforeNode || beforeNode.nodeType !== Node.TEXT_NODE) {
      beforeNode = document.createTextNode("")
      replacement.before(beforeNode)
    }
    const selection = window.getSelection()
    selection?.setBaseAndExtent(beforeNode, (beforeNode.textContent ?? "").length, beforeNode, (beforeNode.textContent ?? "").length)
  }

  if (typeof onFlush === "function") {
    onFlush()
  }

  return replacement
}

export function handleMathKeydown(event: KeyboardEvent, rootElement: Element | null, onFlush: (() => void) | null = null): boolean {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false
  if (!["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) return false

  const selection = window.getSelection()
  if (!selection?.isCollapsed) return false

  if (event.key === "Escape") {
    const info = getActiveMathInfo(selection, rootElement)
    if (info) {
      event.preventDefault()
      reRenderMath(info.activeSpan, {}, onFlush)
      return true
    }
    return false
  }

  if (event.key === "ArrowLeft") {
    const info = getActiveMathInfo(selection, rootElement)
    if (info) {
      if (info.offset <= info.open.length) {
        event.preventDefault()
        reRenderMath(info.activeSpan, { caret: "before" }, onFlush)
        return true
      }
      return false
    }

    const math = renderedMathImmediatelyBeforeCaret(selection, rootElement)
    if (math) {
      event.preventDefault()
      deRenderMath(math, { caret: "end" })
      return true
    }
    return false
  }

  if (event.key === "ArrowRight") {
    const info = getActiveMathInfo(selection, rootElement)
    if (info) {
      if (info.offset >= info.fullText.length - info.close.length) {
        event.preventDefault()
        reRenderMath(info.activeSpan, { caret: "after" }, onFlush)
        return true
      }
      return false
    }

    const math = renderedMathImmediatelyAfterCaret(selection, rootElement)
    if (math) {
      event.preventDefault()
      deRenderMath(math, { caret: "start" })
      return true
    }
    return false
  }

  return false
}

export function finishMathBeforeEnter(event: KeyboardEvent, rootElement: Element | null, onFlush: (() => void) | null = null): boolean {
  if (event.key !== "Enter" || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false

  const selection = window.getSelection()
  if (!selection?.isCollapsed) return false

  const info = getActiveMathInfo(selection, rootElement)
  if (!info || info.offset < info.fullText.length - info.close.length) return false

  reRenderMath(info.activeSpan, { caret: "after" }, onFlush)
  return true
}

interface PendingMathPress {
  math: Element;
  x: number;
  y: number;
}

let pendingMathPress: PendingMathPress | null = null

// Clicks retarget when a focus-triggered reflow moves the math between
// mousedown and click (the press lands in math, the release lands on
// an ancestor). Recording the press lets the click fall back to the
// math the user actually pressed. Drags are excluded by movement, so
// press-and-drag selection across math never derenders.
const CLICK_DRAG_PX = 6

export function recordMathMousedown(event: MouseEvent, rootElement: Element | null): void {
  pendingMathPress = null
  const math = (event.target as Element | null)?.closest?.("[data-editor-math-source]:not([data-editor-math-active])")
  if (math && rootElement?.contains(math)) {
    pendingMathPress = { math, x: event.clientX, y: event.clientY }
  }
}

export function handleMathClick(event: MouseEvent, rootElement: Element | null): boolean {
  const math = (event.target as Element | null)?.closest?.("[data-editor-math-source]:not([data-editor-math-active])")
  if (math && rootElement?.contains(math)) {
    pendingMathPress = null
    event.preventDefault()
    deRenderMath(math, { caret: "click", clickEvent: event })
    return true
  }
  const pending = pendingMathPress
  pendingMathPress = null
  if (pending && rootElement?.contains(pending.math) &&
    Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < CLICK_DRAG_PX) {
    event.preventDefault()
    deRenderMath(pending.math, { caret: "click", clickEvent: event })
    return true
  }
  return false
}

export function syncActiveMath(rootElement: Element | null, onFlush: (() => void) | null = null): void {
  if (!rootElement) return
  const activeSpans = rootElement.querySelectorAll(".editor-math-active")
  if (!activeSpans.length) return

  const selection = window.getSelection()
  activeSpans.forEach((span) => {
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      if (span.contains(range.startContainer) || span.contains(range.endContainer)) {
        return
      }
    }
    // The swap re-resolves element-offset carets adjacent to the span,
    // so preserve the side explicitly (a following text caret also keeps
    // subsequent keystrokes ordinary text). Far carets keep the default:
    // the swap cannot disturb a position outside its subtree.
    const side = caretSideOfSpan(span, selection?.focusNode ?? null, selection?.focusOffset ?? 0)
    reRenderMath(span, side ? { caret: side } : {}, onFlush)
  })
}

// Which side of the span a caret sits on ("before" | "after"), or null
// when the caret is inside the span or outside its parent subtree. The
// caller deactivates only outside carets; inside positions refuse here
// as a defensive second gate.
export function caretSideOfSpan(span: Element, node: Node | null, offset: number): "before" | "after" | null {
  if (!node) return null
  const parent = span.parentNode
  if (!parent) return null
  const spanIndex = Array.prototype.indexOf.call(parent.childNodes, span)
  if (spanIndex === -1) return null
  if (node === parent) {
    return offset > spanIndex ? "after" : "before"
  }
  let current: Node | null = node
  while (current && current.parentNode !== parent) current = current.parentNode
  if (!current || current === span) return null
  const childIndex = Array.prototype.indexOf.call(parent.childNodes, current)
  if (childIndex === -1) return null
  return childIndex > spanIndex ? "after" : "before"
}

interface ActiveMathInfo {
  activeSpan: Element;
  offset: number;
  fullText: string;
  open: string;
  close: string;
}

function getActiveMathInfo(selection: Selection, rootElement: Element | null): ActiveMathInfo | null {
  const node = selection.focusNode
  if (!node) return null

  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  const activeSpan = element?.closest?.(".editor-math-active")
  if (!activeSpan || !rootElement?.contains(activeSpan)) return null

  let offset = 0
  const walker = document.createTreeWalker(activeSpan, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const textNode = walker.currentNode
    if (textNode === node) {
      offset += selection.focusOffset
      break
    }
    offset += (textNode.textContent ?? "").length
  }
  if (!walker.currentNode && node === activeSpan) {
    for (let index = 0; index < selection.focusOffset; index += 1) {
      offset += activeSpan.childNodes[index]?.textContent?.length || 0
    }
  }

  const fullText = activeSpan.textContent || ""
  const span = activeSpan as HTMLElement
  const open = span.dataset.editorMathOpen || (span.classList.contains("editor-live-math-display") ? "$$" : "$")
  const close = span.dataset.editorMathClose || open

  return { activeSpan, offset, fullText, open, close }
}

function renderedMathImmediatelyBeforeCaret(selection: Selection, rootElement: Element | null): Element | null {
  const node = selection.focusNode
  const offset = selection.focusOffset
  if (!node) return null

  if (node.nodeType === Node.TEXT_NODE) {
    if (offset === 0) {
      let prev: ChildNode | null | undefined = node.previousSibling
      while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent === "") {
        prev = prev.previousSibling
      }
      if (prev && prev.nodeType === Node.ELEMENT_NODE && (prev as Element).matches?.("[data-editor-math-source]:not([data-editor-math-active])")) {
        return rootElement?.contains(prev) ? (prev as Element) : null
      }
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset > 0) {
      let prev: ChildNode | null | undefined = node.childNodes[offset - 1]
      while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent === "") {
        prev = prev.previousSibling
      }
      if (prev && prev.nodeType === Node.ELEMENT_NODE && (prev as Element).matches?.("[data-editor-math-source]:not([data-editor-math-active])")) {
        return rootElement?.contains(prev) ? (prev as Element) : null
      }
    }
  }
  return null
}

function renderedMathImmediatelyAfterCaret(selection: Selection, rootElement: Element | null): Element | null {
  const node = selection.focusNode
  const offset = selection.focusOffset
  if (!node) return null

  if (node.nodeType === Node.TEXT_NODE) {
    if (offset === (node.textContent ?? "").length) {
      let next: ChildNode | null | undefined = node.nextSibling
      while (next && next.nodeType === Node.TEXT_NODE && next.textContent === "") {
        next = next.nextSibling
      }
      if (next && next.nodeType === Node.ELEMENT_NODE && (next as Element).matches?.("[data-editor-math-source]:not([data-editor-math-active])")) {
        return rootElement?.contains(next) ? (next as Element) : null
      }
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset < node.childNodes.length) {
      let next: ChildNode | null | undefined = node.childNodes[offset]
      while (next && next.nodeType === Node.TEXT_NODE && next.textContent === "") {
        next = next.nextSibling
      }
      if (next && next.nodeType === Node.ELEMENT_NODE && (next as Element).matches?.("[data-editor-math-source]:not([data-editor-math-active])")) {
        return rootElement?.contains(next) ? (next as Element) : null
      }
    }
  }
  return null
}

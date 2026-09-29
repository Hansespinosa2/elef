import "katex"

export function deRenderMath(mathElement, { caret = "end", clickEvent = null } = {}) {
  if (!mathElement?.parentNode) return null

  const source = mathElement.dataset.editorMathSource ?? ""
  const isDisplay = mathElement.classList.contains("editor-live-math-display") || mathElement.classList.contains("katex-display")
  const open = mathElement.dataset.editorMathOpen || (isDisplay ? "$$" : "$")
  const close = mathElement.dataset.editorMathClose || open
  const fullText = `${open}${source}${close}`

  const activeSpan = document.createElement("span")
  activeSpan.className = "editor-math-active"
  activeSpan.dataset.editorMathActive = "true"
  activeSpan.dataset.editorMathOpen = open
  activeSpan.dataset.editorMathClose = close
  activeSpan.dataset.editorMathSource = source
  if (isDisplay) activeSpan.classList.add("editor-live-math-display")
  activeSpan.contentEditable = "true"
  activeSpan.spellcheck = false

  const textNode = document.createTextNode(fullText)
  activeSpan.appendChild(textNode)

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
    let offset = null
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

export function reRenderMath(activeSpan, { caret = null } = {}, onFlush = null) {
  if (!activeSpan?.parentNode) return null

  if (typeof onFlush === "function") {
    onFlush()
  }

  const fullText = activeSpan.textContent || ""
  const open = activeSpan.dataset.editorMathOpen || (activeSpan.classList.contains("editor-live-math-display") ? "$$" : "$")
  const close = activeSpan.dataset.editorMathClose || open

  let replacement
  const isDisplay = open === "$$" || open === "\\["
  const hasDelimiters = fullText.startsWith(open) && fullText.endsWith(close) && fullText.length >= (open.length + close.length)

  if (hasDelimiters) {
    const expression = fullText.slice(open.length, fullText.length - close.length)
    const katex = globalThis.katex
    if (katex?.renderToString && expression.trim().length > 0) {
      try {
        const wrapper = document.createElement("span")
        wrapper.innerHTML = katex.renderToString(expression, { displayMode: isDisplay, throwOnError: true })
        const math = wrapper.firstElementChild
        if (!math) throw new Error("KaTeX produced no output")
        math.dataset.editorMathSource = expression
        math.dataset.editorMathOpen = open
        math.dataset.editorMathClose = close
        if (isDisplay) math.classList.add("editor-live-math-display")
        math.contentEditable = "false"
        replacement = math
      } catch (_error) {
        const mathError = document.createElement("span")
        mathError.className = "math-error"
        mathError.dataset.editorMathSource = expression
        mathError.dataset.editorMathOpen = open
        mathError.dataset.editorMathClose = close
        mathError.contentEditable = "false"
        mathError.title = "Invalid TeX"
        mathError.textContent = expression
        replacement = mathError
      }
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
    selection?.setBaseAndExtent(beforeNode, beforeNode.textContent.length, beforeNode, beforeNode.textContent.length)
  }

  if (typeof onFlush === "function") {
    onFlush()
  }

  return replacement
}

export function handleMathKeydown(event, rootElement, onFlush = null) {
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

export function handleMathClick(event, rootElement) {
  const math = event.target.closest?.("[data-editor-math-source]:not([data-editor-math-active])")
  if (math && rootElement?.contains(math)) {
    event.preventDefault()
    deRenderMath(math, { caret: "click", clickEvent: event })
    return true
  }
  return false
}

export function syncActiveMath(rootElement, onFlush = null) {
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
    reRenderMath(span, {}, onFlush)
  })
}

function getActiveMathInfo(selection, rootElement) {
  const node = selection.focusNode
  if (!node) return null

  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
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
    offset += textNode.textContent.length
  }
  if (!walker.currentNode && node === activeSpan) {
    for (let index = 0; index < selection.focusOffset; index += 1) {
      offset += activeSpan.childNodes[index]?.textContent?.length || 0
    }
  }

  const fullText = activeSpan.textContent || ""
  const open = activeSpan.dataset.editorMathOpen || (activeSpan.classList.contains("editor-live-math-display") ? "$$" : "$")
  const close = activeSpan.dataset.editorMathClose || open

  return { activeSpan, offset, fullText, open, close }
}

function renderedMathImmediatelyBeforeCaret(selection, rootElement) {
  const node = selection.focusNode
  const offset = selection.focusOffset
  if (!node) return null

  if (node.nodeType === Node.TEXT_NODE) {
    if (offset === 0) {
      let prev = node.previousSibling
      while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent === "") {
        prev = prev.previousSibling
      }
      if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.matches?.("[data-editor-math-source]:not([data-editor-math-active])")) {
        return rootElement?.contains(prev) ? prev : null
      }
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset > 0) {
      let prev = node.childNodes[offset - 1]
      while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent === "") {
        prev = prev.previousSibling
      }
      if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.matches?.("[data-editor-math-source]:not([data-editor-math-active])")) {
        return rootElement?.contains(prev) ? prev : null
      }
    }
  }
  return null
}

function renderedMathImmediatelyAfterCaret(selection, rootElement) {
  const node = selection.focusNode
  const offset = selection.focusOffset
  if (!node) return null

  if (node.nodeType === Node.TEXT_NODE) {
    if (offset === node.textContent.length) {
      let next = node.nextSibling
      while (next && next.nodeType === Node.TEXT_NODE && next.textContent === "") {
        next = next.nextSibling
      }
      if (next && next.nodeType === Node.ELEMENT_NODE && next.matches?.("[data-editor-math-source]:not([data-editor-math-active])")) {
        return rootElement?.contains(next) ? next : null
      }
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset < node.childNodes.length) {
      let next = node.childNodes[offset]
      while (next && next.nodeType === Node.TEXT_NODE && next.textContent === "") {
        next = next.nextSibling
      }
      if (next && next.nodeType === Node.ELEMENT_NODE && next.matches?.("[data-editor-math-source]:not([data-editor-math-active])")) {
        return rootElement?.contains(next) ? next : null
      }
    }
  }
  return null
}

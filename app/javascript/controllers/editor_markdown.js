import "katex"

const INLINE_MATH = /(?<!\\)\\\[([\s\S]+?)\\\]|(?<!\\)\$\$([\s\S]+?)\$\$(?!\$)|(?<!\\)\\\(([^\r\n]+?)\\\)|(?<![\\$])\$(?!\$|\s)([^$\r\n]+?)(?<!\s)\$(?!\$)/g

export function markdownForVisibleText(markdown, text, kind, element = null, { documentMode = false } = {}) {
  const source = markdown || ""
  const rawValue = rawVisibleText(text)

  if (kind === "table") return markdownForTable(source, element)
  if (kind === "image") return markdownForImage(source, element, visibleText(text))
  if (kind === "code") return markdownForCode(source, rawValue)

  const protectedElements = protectedElementsFor(element)
  const sourceAtoms = sourceAtomCounts(source)
  if (element?.querySelectorAll && sourceAtoms.total !== protectedElements.length) return source
  const structured = kind === "list" || kind === "quote"
  const sourceText = documentMode && structured ? String(text || "").replace(/\u00a0/g, " ") : rawValue
  const atomText = protectedElements.length ? visibleTextWithProtectedAtoms(element, protectedElements.length) : sourceText
  const normalizedText = atomText.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ")
  const renderedText = documentMode && structured ? normalizedText : visibleText(normalizedText)
  const value = structured ? renderedText : normalizeInlineRenderedText(renderedText)
  const formatBudget = inlineFormatBudget(element)

  if (kind === "list" || kind === "quote") {
    const projection = structuredBlockProjection(source, kind, protectedElements, formatBudget, { preserveEmptyLines: documentMode })
    const structuredValue = documentMode ? addStructuredMarkers(source, value, kind) : value
    const preserved = preserveProjectedMarkdown(source, structuredValue, projection, { preserveLineBreaks: documentMode })
    if (preserved !== null) return preserved
  }

  if (source === "" && documentMode) return value

  const preserved = preserveInlineMarkdown(source, value, protectedElements, formatBudget)
  // A failed source projection must never serialize display-only atoms or
  // lossy rendered text into canonical Markdown.
  return preserved === null ? source : preserved
}

export function sourceOffsetForVisiblePosition(source, element, visiblePosition) {
  const protectedElements = protectedElementsFor(element)
  if (sourceAtomCounts(source).total !== protectedElements.length) return null

  const projection = inlineProjection(source, 0, protectedElements, 0, inlineFormatBudget(element))
  return projection.boundaries[visiblePosition] ?? null
}

// Server-rendered math is held while its contenteditable block has focus so
// that its HTML and source map stay atomic. Project completed expressions into
// the active block locally, keeping their Markdown delimiters in the source.
export function renderInlineMath(element) {
  const katex = globalThis.katex
  if (!element || typeof katex?.renderToString !== "function") return 0

  const textNodes = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.parentElement?.closest("pre, code, [data-editor-math-source]")) textNodes.push(node)
  }

  let renderedCount = 0
  textNodes.forEach((node) => {
    const matches = [...node.textContent.matchAll(new RegExp(INLINE_MATH.source, "g"))]
    if (matches.length === 0) return

    const selection = window.getSelection()
    const anchorOffset = selection?.anchorNode === node ? selection.anchorOffset : null
    const focusOffset = selection?.focusNode === node ? selection.focusOffset : null
    const fragment = document.createDocumentFragment()
    const segments = []
    let cursor = 0

    const appendText = (from, to) => {
      const textNode = document.createTextNode(node.textContent.slice(from, to))
      fragment.append(textNode)
      segments.push({ from, to, node: textNode, type: "text" })
    }

    matches.forEach((match) => {
      const from = match.index
      const to = from + match[0].length
      appendText(cursor, from)

      const expression = match[1] ?? match[2] ?? match[3] ?? match[4]
      const displayMode = match[1] !== undefined || match[2] !== undefined
      const rendered = document.createElement("span")
      try {
        rendered.innerHTML = katex.renderToString(expression, { displayMode, throwOnError: true })
        const math = rendered.firstElementChild
        if (!math) throw new Error("KaTeX produced no output")
        math.dataset.editorMathSource = expression
        if (displayMode) math.classList.add("editor-live-math-display")
        math.contentEditable = "false"
        fragment.append(math)
        segments.push({ from, to, node: math, type: "math", displayMode })
        renderedCount += 1
      } catch (_error) {
        const mathError = document.createElement("span")
        mathError.className = "math-error"
        mathError.dataset.editorMathSource = expression
        mathError.contentEditable = "false"
        mathError.title = "Invalid TeX"
        mathError.textContent = expression
        fragment.append(mathError)
        segments.push({ from, to, node: mathError, type: "math" })
      }
      cursor = to
    })

    // Preserve an empty trailing text node so the caret can sit just after a
    // completed expression and subsequent keystrokes remain ordinary text.
    appendText(cursor, node.textContent.length)
    node.replaceWith(fragment)

    const pointFor = (offset) => {
      if (offset === null) return null
      const displayMathAtEnd = segments.find((candidate) => candidate.type === "math" && candidate.displayMode && candidate.to === offset)
      if (displayMathAtEnd) {
        const parent = displayMathAtEnd.node.parentNode
        return [parent, [...parent.childNodes].indexOf(displayMathAtEnd.node) + 1]
      }

      const segment = segments.find((candidate) => candidate.type === "text" && offset >= candidate.from && offset <= candidate.to)
      if (segment) return [segment.node, offset - segment.from]

      const math = segments.find((candidate) => candidate.type === "math" && offset > candidate.from && offset < candidate.to)
      if (!math) return null
      const after = segments.find((candidate) => candidate.type === "text" && candidate.from === math.to)
      return after ? [after.node, 0] : [math.node.parentNode, [...math.node.parentNode.childNodes].indexOf(math.node) + 1]
    }

    const anchor = pointFor(anchorOffset)
    const focus = pointFor(focusOffset)
    if (selection && (anchor || focus)) {
      const [nextAnchor, nextAnchorOffset] = anchor || [selection.anchorNode, selection.anchorOffset]
      const [nextFocus, nextFocusOffset] = focus || [selection.focusNode, selection.focusOffset]
      selection.setBaseAndExtent(nextAnchor, nextAnchorOffset, nextFocus, nextFocusOffset)
    }
  })

  return renderedCount
}

function visibleText(text) {
  return (text || "").replace(/\u00a0/g, " ").replace(/\n+$/, "").trim()
}

function rawVisibleText(text) {
  return (text || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")
}

function normalizeInlineRenderedText(text) {
  // Inline projection treats Markdown soft line breaks as ordinary spaces,
  // while a blank line inserted in a contenteditable block starts a new
  // paragraph and must remain structural Markdown.
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").replace(/[ \t]+/g, " "))
    .join("\n\n")
}

function markdownForCode(source, value) {
  const fencedCode = source.match(/^([ \t]*)(`{3,}|~{3,})([^\r\n]*?)(\r\n|\n|\r)([\s\S]*?)(\r\n|\n|\r)([`~]{3,})([ \t]*)$/)
  if (!fencedCode) return value

  const [, indentation, openingFence, info, openingLineEnding, originalCode, closingLineEnding, closingFence, closingWhitespace] = fencedCode
  const marker = openingFence[0]
  if (closingFence[0] !== marker || ![...closingFence].every((character) => character === marker)) return value
  if (closingFence.length < openingFence.length) return value

  const sourceContent = originalCode.replace(/\r\n?/g, "\n")
  const sourceBoundaries = normalizedLineBoundaries(originalCode)
  const { prefix, suffix } = commonEditBounds(sourceContent, value)
  const from = sourceBoundaries[prefix]
  const to = sourceBoundaries[sourceContent.length - suffix]
  const insertion = value.slice(prefix, value.length - suffix).replace(/\n/g, openingLineEnding)
  const updatedCode = `${originalCode.slice(0, from)}${insertion}${originalCode.slice(to)}`

  const longestContentFence = longestFenceRun(updatedCode, marker)
  const openingLength = Math.max(openingFence.length, longestContentFence + 1)
  const closingLength = Math.max(closingFence.length, openingLength)
  const nextOpeningFence = marker.repeat(openingLength)
  const nextClosingFence = marker.repeat(closingLength)

  return `${indentation}${nextOpeningFence}${info}${openingLineEnding}${updatedCode}${closingLineEnding}${nextClosingFence}${closingWhitespace}`
}

function normalizedLineBoundaries(source) {
  const boundaries = [0]
  for (let offset = 0; offset < source.length;) {
    if (source[offset] === "\r" && source[offset + 1] === "\n") {
      offset += 2
      boundaries.push(offset)
    } else {
      offset += 1
      boundaries.push(offset)
    }
  }
  return boundaries
}

function longestFenceRun(source, marker) {
  const expression = marker === "`" ? /`+/g : /~+/g
  return Math.max(0, ...[...source.matchAll(expression)].map((match) => match[0].length))
}

function markdownForTable(source, element) {
  const rows = [...(element?.querySelectorAll?.("tr") || [])]
  if (rows.length < 2) return source
  const sourceRows = source.split(/\r?\n/)
  if (sourceRows.length !== rows.length + 1) return source

  const outputRows = [...sourceRows]
  let changed = false
  rows.forEach((row, rowIndex) => {
    const sourceRowIndex = rowIndex === 0 ? 0 : rowIndex + 1
    const sourceRow = sourceRows[sourceRowIndex]
    const sourceCells = tableCells(sourceRow)
    const visibleCells = [...row.querySelectorAll("th, td")]
    if (sourceCells.length !== visibleCells.length) return

    let updatedRow = sourceRow
    for (let cellIndex = visibleCells.length - 1; cellIndex >= 0; cellIndex -= 1) {
      const range = sourceCells[cellIndex]
      const original = sourceRow.slice(range.start, range.end)
      const edgeWhitespace = original.match(/^(\s*)([\s\S]*?)(\s*)$/)
      const before = edgeWhitespace[1]
      const content = edgeWhitespace[2]
      const after = edgeWhitespace[3]
      const cell = visibleCells[cellIndex]
      const value = visibleText(cell.innerText || cell.textContent)
      const replacement = markdownForVisibleText(content, value, "paragraph", cell)
      if (replacement !== content) changed = true
      updatedRow = `${updatedRow.slice(0, range.start)}${before}${replacement}${after}${updatedRow.slice(range.end)}`
    }
    outputRows[sourceRowIndex] = updatedRow
  })

  return changed ? outputRows.join("\n") : source
}

function tableCells(line) {
  const ranges = []
  let start = /^\s*\|/.test(line) ? line.indexOf("|") + 1 : 0
  let escaped = false
  for (let index = start; index < line.length; index += 1) {
    const character = line[index]
    if (character === "\\" && !escaped) {
      escaped = true
      continue
    }
    if (character === "|" && !escaped) {
      ranges.push({ start, end: index })
      start = index + 1
    }
    escaped = false
  }
  const end = /\|\s*$/.test(line) ? line.lastIndexOf("|") : line.length
  if (start <= end) ranges.push({ start, end })
  return ranges
}

function markdownForImage(source, element, fallback) {
  const image = source.match(/^([ \t]*)!\[([^\]]*)\]\(([^)\s]+)(?:\s+([^)]*?))?\)([ \t]*)$/)
  if (!image) return fallback

  const caption = element?.querySelector?.(".editor-media-caption")
  const alt = visibleText(caption?.innerText || caption?.textContent || fallback)
  const title = image[4] ? ` ${image[4]}` : ""
  return `${image[1]}![${alt}](${image[3]}${title})${image[5]}`
}

function preserveInlineMarkdown(source, value, protectedElements, formatBudget) {
  return preserveProjectedMarkdown(source, value, inlineProjection(source, 0, protectedElements, 0, formatBudget))
}

function preserveProjectedMarkdown(source, value, projection, { preserveLineBreaks = false } = {}) {
  const leading = preserveLineBreaks ? 0 : projection.text.match(/^\s*/)?.[0].length || 0
  const trailing = preserveLineBreaks ? 0 : projection.text.match(/\s*$/)?.[0].length || 0
  const end = projection.text.length - trailing
  const previous = projection.text.slice(leading, end)
  const boundaries = projection.boundaries.slice(leading, end + 1)
  if (previous === value) return source

  const { prefix, suffix } = commonEditBounds(previous, value)
  const from = boundaries[prefix]
  const to = boundaries[previous.length - suffix]
  if (from === undefined || to === undefined || from > to) return null

  const insertion = value.slice(prefix, value.length - suffix)
  const result = `${source.slice(0, from)}${insertion}${source.slice(to)}`
  return result
}

function commonEditBounds(previous, next) {
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1

  let suffix = 0
  while (suffix < previous.length - prefix && suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1

  return { prefix, suffix }
}

function inlineProjection(source, sourceOffset = 0, protectedElements = [], protectedStartIndex = 0, formatBudget = null) {
  let text = ""
  const boundaries = []
  let hasSyntax = false
  let protectedIndex = 0

  const appendPlain = (value, sourceStart) => {
    if (!value) return
    if (boundaries.length === 0) boundaries[0] = sourceStart
    for (let offset = 0; offset < value.length;) {
      if (/[\t\n\f\r \u00a0]/.test(value[offset])) {
        while (offset < value.length && /[\t\n\f\r \u00a0]/.test(value[offset])) offset += 1
        if (text.endsWith(" ")) {
          boundaries[text.length] = sourceStart + offset
        } else {
          text += " "
          boundaries[text.length] = sourceStart + offset
        }
        continue
      }
      const codePoint = value.codePointAt(offset)
      const width = codePoint > 0xffff ? 2 : 1
      text += value.slice(offset, offset + width)
      boundaries[text.length] = sourceStart + offset + width
      offset += width
    }
  }

  const appendProjection = (projection) => {
    if (!projection.text) return
    boundaries[text.length] = projection.boundaries[0]
    for (let offset = 0; offset < projection.text.length;) {
      const codePoint = projection.text.codePointAt(offset)
      const width = codePoint > 0xffff ? 2 : 1
      text += projection.text.slice(offset, offset + width)
      boundaries[text.length] = projection.boundaries[offset + width]
      offset += width
    }
  }

  const appendProtected = (value, sourceStart, sourceEnd) => {
    if (!value) return
    if (boundaries.length === 0) boundaries[0] = sourceStart
    const start = text.length
    text += value
    for (let offset = 1; offset < value.length; offset += 1) boundaries[start + offset] = sourceStart
    boundaries[text.length] = sourceEnd
  }

  for (let index = 0; index < source.length;) {
    const token = inlineTokenAt(source.slice(index), formatBudget, source[index - 1])
    if (!token) {
      const codePoint = source.codePointAt(index)
      const width = codePoint > 0xffff ? 2 : 1
      appendPlain(source.slice(index, index + width), sourceOffset + index)
      index += width
      continue
    }

    hasSyntax = true
    if (token.formatType && formatBudget) formatBudget[token.formatType] = Math.max(0, formatBudget[token.formatType] - 1)
    if (token.kind === "math" || token.kind === "image") {
      const protectedElement = protectedElements[protectedIndex]
      appendProtected(protectedElement ? atomMarker(protectedStartIndex + protectedIndex) : token.content, sourceOffset + index, sourceOffset + index + token.length)
      protectedIndex += 1
    } else if (["code", "document_link", "escape"].includes(token.kind)) {
      appendPlain(token.content, sourceOffset + index + token.contentOffset)
    } else {
      const content = inlineProjection(token.content, sourceOffset + index + token.contentOffset, protectedElements.slice(protectedIndex), protectedStartIndex + protectedIndex, formatBudget)
      appendProjection(content)
      protectedIndex += content.atomCount
    }
    index += token.length
  }

  return { text, boundaries, hasSyntax, atomCount: protectedIndex }
}

function structuredBlockProjection(source, kind, protectedElements, formatBudget = null, { preserveEmptyLines = false } = {}) {
  const lines = source.split("\n")
  const boundaries = []
  let text = ""
  let hasSyntax = false
  let sourceOffset = 0
  let protectedIndex = 0

  lines.forEach((line, lineIndex) => {
    const prefix = kind === "quote"
      ? line.match(/^[ \t]*>[ \t]?/)
      : line.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/)
    const prefixLength = prefix?.[0].length || 0
    hasSyntax ||= prefixLength > 0
    const projection = inlineProjection(line.slice(prefixLength), sourceOffset + prefixLength, protectedElements.slice(protectedIndex), protectedIndex, formatBudget)
    protectedIndex += projection.atomCount
    hasSyntax ||= projection.hasSyntax

    if (projection.text) {
      boundaries[text.length] = projection.boundaries[0]
      for (let offset = 0; offset < projection.text.length;) {
        const codePoint = projection.text.codePointAt(offset)
        const width = codePoint > 0xffff ? 2 : 1
        text += projection.text.slice(offset, offset + width)
        boundaries[text.length] = projection.boundaries[offset + width]
        offset += width
      }
    } else if (preserveEmptyLines && prefixLength) {
      boundaries[text.length] = sourceOffset + prefixLength
    }

    if (lineIndex < lines.length - 1) {
      if (boundaries.length === 0) boundaries[0] = sourceOffset + line.length
      text += "\n"
      boundaries[text.length] = sourceOffset + line.length + 1
    }
    sourceOffset += line.length + 1
  })

  return { text, boundaries, hasSyntax, atomCount: protectedIndex }
}

function addStructuredMarkers(source, value, kind) {
  const sourceLines = source.split("\n")
  const lines = value.split("\n")
  if (lines.length <= sourceLines.length) return value

  const lastLine = sourceLines.at(-1) || ""
  const marker = kind === "quote"
    ? lastLine.match(/^[ \t]*>[ \t]?/)?.[0] || "> "
    : lastLine.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/)?.[0] || "- "
  for (let index = sourceLines.length; index < lines.length; index += 1) lines[index] = `${marker}${lines[index]}`
  return lines.join("\n")
}

function inlineTokenAt(source, formatBudget = null, previousCharacter = "") {
  let match = source.match(/^\\\$/)
  if (match) return { length: match[0].length, content: "$", contentOffset: 1, kind: "escape" }

  match = source.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/)
  if (match) return { length: match[0].length, content: match[1], contentOffset: 2, kind: "image" }

  match = source.match(/^(\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\))/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: 1, kind: "link" }

  match = source.match(/^(\[\[([^\]|]+)(?:\|([^\]]*))?\]\])/)
  if (match) {
    const content = match[3] === undefined ? match[2] : match[3]
    const contentOffset = match[3] === undefined ? 2 : 2 + match[2].length + 1
    return { length: match[0].length, content, contentOffset, kind: "document_link" }
  }

  match = source.match(/^(`+)([^`\r\n]+?)\1/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: match[1].length, kind: "code" }

  match = source.match(/^(\*\*|__)(?=\S)(.+?)(?<=\S)\1/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: match[1].length, kind: "format", formatType: "strong" }

  match = source.match(/^(~~)(?=\S)(.+?)(?<=\S)\1/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: match[1].length, kind: "format", formatType: "strike" }

  match = source.match(/^(?<!\*)(\*)(?!\s)(.+?)(?<!\s)\1(?!\*)/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: 1, kind: "format", formatType: "emphasis" }

  match = source.match(/^(?<!_)(_)(?!\s)(.+?)(?<!\s)\1(?!_)/)
  if (match) return { length: match[0].length, content: match[2], contentOffset: 1, kind: "format", formatType: "emphasis" }

  // While the server projection is queued, the active DOM still contains its
  // semantic formatting elements. Keep paired delimiters mapped through
  // transient Markdown-invalid keystrokes (for example, a trailing space in
  // an italic span) instead of deleting the author's formatting on that key.
  if (formatBudget?.strong > 0) {
    match = source.match(/^(\*\*|__)([\s\S]+?)\1/)
    if (match) return { length: match[0].length, content: match[2], contentOffset: match[1].length, kind: "format", formatType: "strong" }
  }
  if (formatBudget?.strike > 0) {
    match = source.match(/^(~~)([\s\S]+?)\1/)
    if (match) return { length: match[0].length, content: match[2], contentOffset: match[1].length, kind: "format", formatType: "strike" }
  }
  if (formatBudget?.emphasis > 0) {
    match = source.match(/^(?<!\*)(\*)([\s\S]+?)\1(?!\*)/)
    if (match) return { length: match[0].length, content: match[2], contentOffset: 1, kind: "format", formatType: "emphasis" }

    match = source.match(/^(?<!_)(_)([\s\S]+?)\1(?!_)/)
    if (match) return { length: match[0].length, content: match[2], contentOffset: 1, kind: "format", formatType: "emphasis" }
  }

  match = source.match(/^\\\[([\s\S]+?)\\\]/)
  if (match) return { length: match[0].length, content: match[1], kind: "math" }

  match = source.match(/^\\\(([^\r\n]+?)\\\)/)
  if (match) return { length: match[0].length, content: match[1], kind: "math" }

  match = source.match(/^\$\$([\s\S]+?)\$\$(?!\$)/)
  if (match) return { length: match[0].length, content: match[1], kind: "math" }

  if (previousCharacter !== "$") {
    match = source.match(/^\$(?!\$)(?!\s)([^$\r\n]+?)(?<!\s)\$(?!\$)/)
    if (match) return { length: match[0].length, content: match[1], kind: "math" }
  }

  return null
}

function inlineFormatBudget(element) {
  if (!element?.querySelectorAll) return null

  return {
    strong: element.querySelectorAll("strong, b").length,
    emphasis: element.querySelectorAll("em, i").length,
    strike: element.querySelectorAll("del, s, strike").length
  }
}

function protectedElementsFor(element) {
  return [...(element?.querySelectorAll?.("[data-editor-math-source], [data-editor-image-source]") || [])]
}

function atomMarker(index) {
  return `\uE000${index.toString(36)}\uE001`
}

function visibleTextWithProtectedAtoms(element, count) {
  const clone = element.cloneNode(true)
  const nodes = protectedElementsFor(clone)
  if (nodes.length !== count) return element.innerText || element.textContent || ""

  nodes.forEach((node, index) => node.replaceWith(document.createTextNode(atomMarker(index))))
  clone.setAttribute("aria-hidden", "true")
  clone.contentEditable = "false"
  clone.style.cssText += ";position:fixed!important;left:-100000px!important;top:0!important;pointer-events:none!important;z-index:-1!important"
  const parent = element.parentElement || document.body
  parent.append(clone)
  try {
    return clone.innerText || clone.textContent || ""
  } finally {
    clone.remove()
  }
}

function sourceAtomCounts(source) {
  const counts = { math: 0, image: 0 }
  for (let index = 0; index < source.length;) {
    const token = inlineTokenAt(source.slice(index), null, source[index - 1])
    if (!token) {
      const codePoint = source.codePointAt(index)
      index += codePoint > 0xffff ? 2 : 1
      continue
    }
    if (token.kind === "math") counts.math += 1
    else if (token.kind === "image") counts.image += 1
    else if (token.kind === "link" || token.kind === "format") {
      const nested = sourceAtomCounts(token.content)
      counts.math += nested.math
      counts.image += nested.image
    }
    index += token.length
  }
  return { ...counts, total: counts.math + counts.image }
}

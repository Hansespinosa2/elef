import katex from "katex"

const INLINE_MATH = /(?<!\\)\\\[([\s\S]+?)\\\]|(?<!\\)\$\$([\s\S]+?)\$\$(?!\$)|(?<!\\)\\\(([^\r\n]+?)\\\)|(?<![\\$])\$(?!\$|\s)([^$\r\n]+?)(?<!\s)\$(?!\$)/g

export interface InlineToken {
  length: number;
  content: string;
  contentOffset?: number;
  kind: string;
  formatType?: "strong" | "emphasis" | "strike";
}

export interface InlineProjection {
  text: string;
  boundaries: number[];
  hasSyntax: boolean;
  atomCount: number;
  mathCount?: number;
}

export interface FormatBudget {
  strong: number;
  emphasis: number;
  strike: number;
}

export function markdownForVisibleText(markdown: string, text: string, kind: string, element: Element | null = null, { documentMode = false }: { documentMode?: boolean } = {}): string {
  const source = markdown || ""
  const rawValue = rawVisibleText(text)

  if (kind === "table") return markdownForTable(source, element)
  if (kind === "image") return markdownForImage(source, element, visibleText(text))
  if (kind === "code") return markdownForCode(source, rawValue)

  const protectedElements = protectedElementsFor(element)
  const allMathElements = allMathElementsFor(element)
  const activeCount = allMathElements.filter((candidate) => candidate.dataset.editorMathActive === "true").length
  const activeDisplayMath = activeDisplayMathBlock(source, allMathElements)
  if (activeDisplayMath !== null) return activeDisplayMath
  const sourceAtoms = sourceAtomCounts(source)
  const expectedAtoms = protectedElements.length + activeCount
  if (element?.querySelectorAll && sourceAtoms.total !== expectedAtoms &&
    !hasMatchingActiveMathDelimiter(source, allMathElements, sourceAtoms.total, protectedElements.length, expectedAtoms)) return source
  const structured = kind === "list" || kind === "quote"
  const sourceText = documentMode && structured ? String(text || "").replace(/\u00a0/g, " ") : rawValue
  const atomText = protectedElements.length ? visibleTextWithProtectedAtoms(element as Element, protectedElements.length) : sourceText
  const normalizedText = atomText.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ")
  const valueTrimmed = !(documentMode && structured)
  const renderedText = valueTrimmed ? visibleText(normalizedText) : normalizedText
  // The trim hides just-typed trailing whitespace from the differ (a flush
  // can re-read the DOM while the typed space is still trailing); keep the
  // trimmed run as evidence so the alignment cannot mistake a hidden
  // insertion for a whitespace deletion.
  const trailingExtra = valueTrimmed ? (normalizedText.match(/[ \t]*$/)?.[0] ?? "") : ""
  const value = structured ? renderedText : normalizeInlineRenderedText(renderedText)
  const formatBudget = inlineFormatBudget(element)

  if (kind === "list" || kind === "quote") {
    const projection = structuredBlockProjection(source, kind, protectedElements, formatBudget, { preserveEmptyLines: documentMode }, allMathElements)
    const structuredValue = documentMode ? addStructuredMarkers(source, value, kind) : value
    const preserved = preserveProjectedMarkdown(source, structuredValue, projection, { preserveLineBreaks: documentMode, trailingExtra })
    if (preserved !== null) return preserved
  }

  if (source === "" && documentMode) return value

  const preserved = preserveInlineMarkdown(source, value, protectedElements, formatBudget, allMathElements, trailingExtra)
  // A failed source projection must never serialize display-only atoms or
  // lossy rendered text into canonical Markdown.
  return preserved === null ? source : preserved
}

export function sourceOffsetForVisiblePosition(source: string, element: Element | null, visiblePosition: number): number | null {
  const protectedElements = protectedElementsFor(element)
  const allMathElements = allMathElementsFor(element)
  const activeCount = allMathElements.filter((candidate) => candidate.dataset.editorMathActive === "true").length
  const sourceAtoms = sourceAtomCounts(source).total
  const expectedAtoms = protectedElements.length + activeCount
  if (sourceAtoms !== expectedAtoms &&
    !hasMatchingActiveMathDelimiter(source, allMathElements, sourceAtoms, protectedElements.length, expectedAtoms)) return null

  const projection = inlineProjection(source, 0, protectedElements, 0, inlineFormatBudget(element), allMathElements)
  return projection.boundaries[visiblePosition] ?? null
}

// Server-rendered math is held while its contenteditable block has focus so
// that its HTML and source map stay atomic. Project completed expressions into
// the active block locally, keeping their Markdown delimiters in the source.
interface MathSegment {
  from: number;
  to: number;
  node: ChildNode;
  textNode?: Text;
  type: string;
  displayMode?: boolean;
}

export function renderInlineMath(element: Element | null): number {
  if (!element || typeof katex?.renderToString !== "function") return 0

  const textNodes: Text[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.parentElement?.closest("pre, code, [data-editor-math-source], [data-editor-math-active]")) textNodes.push(node as Text)
  }

  let renderedCount = 0
  textNodes.forEach((node) => {
    const matches = [...(node.textContent ?? "").matchAll(new RegExp(INLINE_MATH.source, "g"))]
    if (matches.length === 0) return

    const selection = window.getSelection()
    const anchorOffset = selection?.anchorNode === node ? selection.anchorOffset : null
    const focusOffset = selection?.focusNode === node ? selection.focusOffset : null
    const fragment = document.createDocumentFragment()
    const segments: MathSegment[] = []
    let cursor = 0

    const appendText = (from: number, to: number): void => {
      const textNode = document.createTextNode((node.textContent ?? "").slice(from, to))
      fragment.append(textNode)
      segments.push({ from, to, node: textNode, type: "text" })
    }

    matches.forEach((match) => {
      const from = match.index ?? 0
      const to = from + (match[0] ?? "").length
      appendText(cursor, from)

      const expression = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""
      const displayMode = match[1] !== undefined || match[2] !== undefined
      const openDelimiter = match[1] !== undefined ? "\\[" : match[2] !== undefined ? "$$" : match[3] !== undefined ? "\\(" : "$"
      const closeDelimiter = match[1] !== undefined ? "\\]" : match[2] !== undefined ? "$$" : match[3] !== undefined ? "\\)" : "$"

      if (selection?.isCollapsed && selection.anchorNode === node && typeof anchorOffset === "number" &&
        anchorOffset >= from + openDelimiter.length && anchorOffset <= to - closeDelimiter.length) {
        const activeMath = document.createElement("span")
        activeMath.className = "editor-math-active"
        activeMath.dataset.editorMathActive = "true"
        activeMath.dataset.editorMathOpen = openDelimiter
        activeMath.dataset.editorMathClose = closeDelimiter
        activeMath.dataset.editorMathSource = expression
        if (displayMode) activeMath.classList.add("editor-live-math-display")
        activeMath.contentEditable = "true"
        activeMath.spellcheck = false

        const activeText = document.createTextNode(match[0])
        activeMath.append(activeText)
        fragment.append(activeMath)
        segments.push({ from, to, node: activeMath, textNode: activeText, type: "active-math" })
        cursor = to
        return
      }

      const rendered = document.createElement("span")
      try {
        rendered.innerHTML = katex.renderToString(expression, { displayMode, throwOnError: true })
        const math = rendered.firstElementChild as HTMLElement | null
        if (!math) throw new Error("KaTeX produced no output")
        math.dataset.editorMathSource = expression
        math.dataset.editorMathOpen = openDelimiter
        math.dataset.editorMathClose = closeDelimiter
        if (displayMode) math.classList.add("editor-live-math-display")
        math.contentEditable = "false"
        fragment.append(math)
        segments.push({ from, to, node: math, type: "math", displayMode })
        renderedCount += 1
      } catch (_error) {
        const mathError = document.createElement("span")
        mathError.className = "math-error"
        mathError.dataset.editorMathSource = expression
        mathError.dataset.editorMathOpen = openDelimiter
        mathError.dataset.editorMathClose = closeDelimiter
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
    appendText(cursor, (node.textContent ?? "").length)
    node.replaceWith(fragment)

    const pointFor = (offset: number | null): [Node, number] | null => {
      if (offset === null) return null
      const displayMathAtEnd = segments.find((candidate) => candidate.type === "math" && candidate.displayMode && candidate.to === offset)
      if (displayMathAtEnd) {
        const parent = displayMathAtEnd.node.parentNode as Node
        return [parent, [...parent.childNodes].indexOf(displayMathAtEnd.node) + 1]
      }

      const segment = segments.find((candidate) => candidate.type === "text" && offset >= candidate.from && offset <= candidate.to)
      if (segment) return [segment.node, offset - segment.from]

      const activeMath = segments.find((candidate) => candidate.type === "active-math" && offset >= candidate.from && offset <= candidate.to)
      if (activeMath) return [activeMath.textNode as Text, offset - activeMath.from]

      const math = segments.find((candidate) => candidate.type === "math" && offset > candidate.from && offset < candidate.to)
      if (!math) return null
      const after = segments.find((candidate) => candidate.type === "text" && candidate.from === math.to)
      const mathParent = math.node.parentNode as Node
      return after ? [after.node, 0] : [mathParent, [...mathParent.childNodes].indexOf(math.node) + 1]
    }

    const anchor = pointFor(anchorOffset)
    const focus = pointFor(focusOffset)
    if (selection && (anchor || focus)) {
      const [nextAnchor, nextAnchorOffset] = anchor || [selection.anchorNode, selection.anchorOffset]
      const [nextFocus, nextFocusOffset] = focus || [selection.focusNode, selection.focusOffset]
      selection.setBaseAndExtent(nextAnchor as Node, nextAnchorOffset, nextFocus as Node, nextFocusOffset)
    }
  })

  return renderedCount
}

function visibleText(text: string): string {
  return (text || "").replace(/\u00a0/g, " ").replace(/\n+$/, "").trim()
}

function rawVisibleText(text: string): string {
  return (text || "").replace(/\u00a0/g, " ").replace(/\n+$/, "")
}

function normalizeInlineRenderedText(text: string): string {
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

function markdownForCode(source: string, value: string): string {
  const fencedCode = source.match(/^([ \t]*)(`{3,}|~{3,})([^\r\n]*?)(\r\n|\n|\r)([\s\S]*?)(\r\n|\n|\r)([`~]{3,})([ \t]*)$/)
  if (!fencedCode) return value

  const [, indentation = "", openingFence = "", info = "", openingLineEnding = "", originalCode = "", closingLineEnding = "", closingFence = "", closingWhitespace = ""] = fencedCode
  const marker = openingFence[0] ?? ""
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

function normalizedLineBoundaries(source: string): number[] {
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

function longestFenceRun(source: string, marker: string): number {
  const expression = marker === "`" ? /`+/g : /~+/g
  return Math.max(0, ...[...source.matchAll(expression)].map((match) => (match[0] ?? "").length))
}

function markdownForTable(source: string, element: Element | null): string {
  const rows = [...(element?.querySelectorAll?.("tr") || [])]
  if (rows.length < 2) return source
  const sourceRows = source.split(/\r?\n/)
  if (sourceRows.length !== rows.length + 1) return source

  const outputRows = [...sourceRows]
  let changed = false
  rows.forEach((row, rowIndex) => {
    const sourceRowIndex = rowIndex === 0 ? 0 : rowIndex + 1
    const sourceRow = sourceRows[sourceRowIndex] ?? ""
    const sourceCells = tableCells(sourceRow)
    const visibleCells = [...row.querySelectorAll<HTMLElement>("th, td")]
    if (sourceCells.length !== visibleCells.length) return

    let updatedRow = sourceRow
    for (let cellIndex = visibleCells.length - 1; cellIndex >= 0; cellIndex -= 1) {
      const range = sourceCells[cellIndex]
      if (!range) continue
      const original = sourceRow.slice(range.start, range.end)
      const [, before = "", content = "", after = ""] = original.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? []
      const cell = visibleCells[cellIndex] as HTMLElement
      const value = visibleText(cell.innerText || cell.textContent)
      const replacement = markdownForVisibleText(content, value, "paragraph", cell)
      if (replacement !== content) changed = true
      updatedRow = `${updatedRow.slice(0, range.start)}${before}${replacement}${after}${updatedRow.slice(range.end)}`
    }
    outputRows[sourceRowIndex] = updatedRow
  })

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n"
  return changed ? outputRows.join(lineEnding) : source
}

function tableCells(line: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
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

function markdownForImage(source: string, element: Element | null, fallback: string): string {
  const image = source.match(/^([ \t]*)!\[([^\]]*)\]\(([^)\s]+)(?:\s+([^)]*?))?\)([ \t]*)$/)
  if (!image) return fallback

  const caption = element?.querySelector?.(".editor-media-caption") as HTMLElement | null | undefined
  const alt = visibleText(caption?.innerText || caption?.textContent || fallback)
  const title = image[4] ? ` ${image[4]}` : ""
  return `${image[1]}![${alt}](${image[3]}${title})${image[5]}`
}

function activeDisplayMathBlock(source: string, allMathElements: HTMLElement[]): string | null {
  const activeMath = allMathElements.find((candidate) => candidate.dataset.editorMathActive === "true")
  if (!activeMath) return null

  const opening = activeMath.dataset.editorMathOpen || "$"
  const closing = activeMath.dataset.editorMathClose || opening
  if (!["$$", "\\["].includes(opening)) return null

  const fullText = activeMath.textContent || ""
  if (!fullText.startsWith(opening) || !fullText.endsWith(closing)) return null

  const openingIndex = source.indexOf(opening)
  const closingIndex = source.lastIndexOf(closing)
  if (openingIndex < 0 || closingIndex < openingIndex + opening.length) return null

  const before = source.slice(0, openingIndex)
  const after = source.slice(closingIndex + closing.length)
  if (!/^[ \t]{0,3}$/.test(before) || !/^[ \t]*$/.test(after)) return null

  return before + fullText + after
}

function preserveInlineMarkdown(source: string, value: string, protectedElements: HTMLElement[], formatBudget: FormatBudget | null, allMathElements: HTMLElement[] = [], trailingExtra = ""): string | null {
  return preserveProjectedMarkdown(source, value, inlineProjection(source, 0, protectedElements, 0, formatBudget, allMathElements), { trailingExtra })
}

function preserveProjectedMarkdown(source: string, value: string, projection: InlineProjection, { preserveLineBreaks = false, trailingExtra = "" }: { preserveLineBreaks?: boolean; trailingExtra?: string } = {}): string | null {
  // Projections never contain carriage returns (structured lines are stripped
  // before projection; inline whitespace is collapsed), so normalize the
  // edited value the same way before diffing — otherwise every CRLF line
  // break reads as a phantom edit and the splice deletes structure.
  const normalizedValue = value.replace(/\r\n?/g, "\n")
  const leading = preserveLineBreaks ? 0 : projection.text.match(/^\s*/)?.[0]?.length || 0
  const trailing = preserveLineBreaks ? 0 : projection.text.match(/\s*$/)?.[0]?.length || 0
  const end = projection.text.length - trailing
  const previous = projection.text.slice(leading, end)
  const boundaries = projection.boundaries.slice(leading, end + 1)
  // The trimmed trailing run is invisible in the DOM; its true end boundary
  // sits past it at end-of-source.
  const endBoundary = trailing > 0 ? projection.boundaries[projection.text.length] : undefined
  if (previous === normalizedValue) return source

  // The DOM can lag the engine by whitespace it never rendered: the
  // projection strips trailing runs, and precise commits preserve source
  // whitespace the editable DOM never contained. Once such a space sits
  // inside the base (e.g. "See [[Research" typed after "See "), a naive
  // diff against the lagging DOM ("See[[Research ta") reads the inherited
  // gap as a user deletion. Align first, skipping previous-whitespace the
  // value lacks; the walks stop at real divergence, so skipped runs always
  // sit outside the edit and are preserved. Only an empty diff with skips
  // (a genuine whitespace deletion) falls back to the unaligned diff so
  // user deletions are still honored.
  const aligned = alignedEditBounds(previous, normalizedValue, trailingExtra)
  const fallback = aligned === null
  const { prefix, suffix, prefixValue, suffixValue } = fallback
    ? { ...commonEditBounds(previous, normalizedValue), prefixValue: 0, suffixValue: 0 }
    : aligned
  const valuePrefix = fallback ? prefix : prefixValue
  const valueSuffix = fallback ? suffix : suffixValue
  // Pure end-insertions land past the invisible trailing run (matching the
  // caret map's end affinity); every other edit keeps the original
  // boundaries so range operations never swallow unselected whitespace.
  const endInsertion = prefix === previous.length && endBoundary !== undefined
  const from = endInsertion ? endBoundary : boundaries[prefix]
  const to = endInsertion ? endBoundary : boundaries[previous.length - suffix]
  if (from === undefined || to === undefined || from > to) return null

  // New line breaks introduced by the edit adopt the block's own convention
  // so a CRLF block is never silently rewritten to mixed endings.
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n"
  let insertion = normalizedValue.slice(valuePrefix, normalizedValue.length - valueSuffix).replace(/\n/g, lineEnding)
  // A trimmed trailing run is user-typed content, not round-trip noise:
  // fold it into end-site insertions (end-insertions always land here),
  // or re-append it after middle-site edits. Round-trips early-return
  // before reaching here, and deletions fall back (which implies no
  // trailing run), so any run seen here was typed during this batch.
  if (trailingExtra) {
    if (suffix === 0 && valueSuffix === 0) insertion += trailingExtra
    else return `${source.slice(0, from)}${insertion}${source.slice(to)}${trailingExtra}`
  }
  const result = `${source.slice(0, from)}${insertion}${source.slice(to)}`
  return result
}

function isLagWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t"
}

// Aligns previous (projection) against next (DOM), skipping horizontal
// whitespace the DOM lacks. Returns null when the skipped runs intersect
// the edit (or the diff is empty with skips), signalling the caller to
// use the unaligned diff instead. Separate previous/value cursors track
// both sides across skips.
function alignedEditBounds(previous: string, next: string, trailingExtra = ""): { prefix: number; suffix: number; prefixValue: number; suffixValue: number } | null {
  let prefix = 0
  let prefixValue = 0
  let skipped = 0
  while (prefixValue < next.length) {
    if (prefix >= previous.length) break
    if (previous[prefix] === next[prefixValue]) {
      prefix += 1
      prefixValue += 1
      continue
    }
    if (!isLagWhitespace(previous[prefix])) break
    prefix += 1
    skipped += 1
  }
  let suffix = 0
  let suffixValue = 0
  while (suffixValue < next.length - prefixValue) {
    const prevIndex = previous.length - suffix - 1
    if (prevIndex < prefix) break
    if (previous[prevIndex] === next[next.length - suffixValue - 1]) {
      suffix += 1
      suffixValue += 1
      continue
    }
    if (!isLagWhitespace(previous[prevIndex])) break
    suffix += 1
    skipped += 1
  }
  // The loops bound both cursors so ranges cannot overlap; the only
  // fallback is an empty diff with skips (a genuine whitespace deletion),
  // which the unaligned diff owns. A trimmed trailing run proves the
  // "empty" verdict is an artifact of the trim (the user typed trailing
  // whitespace the trimmed value hides), so it stays aligned and the
  // caller folds the run into the end-site insertion.
  const empty = prefix + suffix >= previous.length && prefixValue + suffixValue >= next.length
  if (empty && skipped > 0 && !trailingExtra) return null
  return { prefix, suffix, prefixValue, suffixValue }
}

function commonEditBounds(previous: string, next: string): { prefix: number; suffix: number } {
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1

  let suffix = 0
  while (suffix < previous.length - prefix && suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1

  return { prefix, suffix }
}

function inlineProjection(source: string, sourceOffset = 0, protectedElements: HTMLElement[] = [], protectedStartIndex = 0, formatBudget: FormatBudget | null = null, allMathElements: HTMLElement[] = []): InlineProjection {
  let text = ""
  const boundaries: number[] = []
  let hasSyntax = false
  let protectedIndex = 0
  let mathIndex = 0

  const appendPlain = (value: string, sourceStart: number): void => {
    if (!value) return
    if (boundaries.length === 0) boundaries[0] = sourceStart
    for (let offset = 0; offset < value.length;) {
      if (/[\t\n\f\r \u00a0]/.test(value[offset] ?? "")) {
        while (offset < value.length && /[\t\n\f\r \u00a0]/.test(value[offset] ?? "")) offset += 1
        if (text.endsWith(" ")) {
          boundaries[text.length] = sourceStart + offset
        } else {
          text += " "
          boundaries[text.length] = sourceStart + offset
        }
        continue
      }
      const codePoint = value.codePointAt(offset) ?? 0
      const width = codePoint > 0xffff ? 2 : 1
      text += value.slice(offset, offset + width)
      boundaries[text.length] = sourceStart + offset + width
      offset += width
    }
  }

  const appendProjection = (projection: InlineProjection): void => {
    if (!projection.text) return
    boundaries[text.length] = projection.boundaries[0] as number
    for (let offset = 0; offset < projection.text.length;) {
      const codePoint = projection.text.codePointAt(offset) ?? 0
      const width = codePoint > 0xffff ? 2 : 1
      text += projection.text.slice(offset, offset + width)
      boundaries[text.length] = projection.boundaries[offset + width] as number
      offset += width
    }
  }

  const appendProtected = (value: string, sourceStart: number, sourceEnd: number): void => {
    if (!value) return
    if (boundaries.length === 0) boundaries[0] = sourceStart
    const start = text.length
    text += value
    for (let offset = 1; offset < value.length; offset += 1) boundaries[start + offset] = sourceStart
    boundaries[text.length] = sourceEnd
  }

  for (let index = 0; index < source.length;) {
    const token = inlineTokenAt(source.slice(index), formatBudget, source[index - 1]) ||
      activeEmptyMathTokenAt(source, index, allMathElements[mathIndex])
    if (!token) {
      const codePoint = source.codePointAt(index) ?? 0
      const width = codePoint > 0xffff ? 2 : 1
      appendPlain(source.slice(index, index + width), sourceOffset + index)
      index += width
      continue
    }

    hasSyntax = true
    if (token.formatType && formatBudget) formatBudget[token.formatType] = Math.max(0, formatBudget[token.formatType] - 1)
    if (token.kind === "math") {
      const mathElement = allMathElements[mathIndex]
      const isActive = mathElement?.dataset?.editorMathActive === "true"
      if (isActive) {
        appendPlain(source.slice(index, index + token.length), sourceOffset + index)
      } else {
        const protectedElement = protectedElements[protectedIndex]
        appendProtected(protectedElement ? atomMarker(protectedStartIndex + protectedIndex) : token.content, sourceOffset + index, sourceOffset + index + token.length)
        protectedIndex += 1
      }
      mathIndex += 1
    } else if (token.kind === "image") {
      const protectedElement = protectedElements[protectedIndex]
      appendProtected(protectedElement ? atomMarker(protectedStartIndex + protectedIndex) : token.content, sourceOffset + index, sourceOffset + index + token.length)
      protectedIndex += 1
    } else if (["code", "document_link", "escape"].includes(token.kind)) {
      appendPlain(token.content, sourceOffset + index + (token.contentOffset ?? 0))
    } else {
      const content = inlineProjection(
        token.content,
        sourceOffset + index + (token.contentOffset ?? 0),
        protectedElements.slice(protectedIndex),
        protectedStartIndex + protectedIndex,
        formatBudget,
        allMathElements.slice(mathIndex)
      )
      appendProjection(content)
      protectedIndex += content.atomCount
      mathIndex += content.mathCount || 0
    }
    index += token.length
  }

  return { text, boundaries, hasSyntax, atomCount: protectedIndex, mathCount: mathIndex }
}

function structuredBlockProjection(source: string, kind: string, protectedElements: HTMLElement[], formatBudget: FormatBudget | null = null, { preserveEmptyLines = false }: { preserveEmptyLines?: boolean } = {}, allMathElements: HTMLElement[] = []): InlineProjection {
  const lines = source.split("\n")
  const boundaries: number[] = []
  let text = ""
  let hasSyntax = false
  let sourceOffset = 0
  let protectedIndex = 0
  let mathIndex = 0

  lines.forEach((line, lineIndex) => {
    // Strip a CRLF carriage return for projection: the editable DOM never
    // contains it, so projecting it would misalign every later boundary and
    // read each line break as an edit. Offset accounting below deliberately
    // keeps using the raw line length so source offsets stay exact.
    const content = line.endsWith("\r") ? line.slice(0, -1) : line
    const prefix = kind === "quote"
      ? content.match(/^[ \t]*>[ \t]?/)
      : content.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/)
    const prefixLength = (prefix?.[0] ?? "").length || 0
    hasSyntax ||= prefixLength > 0
    const projection = inlineProjection(
      content.slice(prefixLength),
      sourceOffset + prefixLength,
      protectedElements.slice(protectedIndex),
      protectedIndex,
      formatBudget,
      allMathElements.slice(mathIndex)
    )
    protectedIndex += projection.atomCount
    mathIndex += projection.mathCount || 0
    hasSyntax ||= projection.hasSyntax

    if (projection.text) {
      boundaries[text.length] = projection.boundaries[0] as number
      for (let offset = 0; offset < projection.text.length;) {
        const codePoint = projection.text.codePointAt(offset) ?? 0
        const width = codePoint > 0xffff ? 2 : 1
        text += projection.text.slice(offset, offset + width)
        boundaries[text.length] = projection.boundaries[offset + width] as number
        offset += width
      }
    } else if (preserveEmptyLines && prefixLength) {
      boundaries[text.length] = sourceOffset + prefixLength
    }

    if (lineIndex < lines.length - 1) {
      // The stripped length: position 0 must map before the carriage return,
      // not between it and the newline (which would strand a lone \r).
      if (boundaries.length === 0) boundaries[0] = sourceOffset + content.length
      text += "\n"
      boundaries[text.length] = sourceOffset + line.length + 1
    }
    sourceOffset += line.length + 1
  })

  return { text, boundaries, hasSyntax, atomCount: protectedIndex }
}

function addStructuredMarkers(source: string, value: string, kind: string): string {
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

function inlineTokenAt(source: string, formatBudget: FormatBudget | null = null, previousCharacter = ""): InlineToken | null {
  let match = source.match(/^\\\$/)
  if (match) return { length: (match[0] ?? "").length, content: "$", contentOffset: 1, kind: "escape" }

  match = source.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/)
  if (match) return { length: (match[0] ?? "").length, content: match[1] ?? "", contentOffset: 2, kind: "image" }

  match = source.match(/^(\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\))/)
  if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: 1, kind: "link" }

  match = source.match(/^(\[\[([^\]|]+)(?:\|([^\]]*))?\]\])/)
  if (match) {
    const content = match[3] ?? match[2] ?? ""
    const contentOffset = match[3] === undefined ? 2 : 2 + (match[2] ?? "").length + 1
    return { length: (match[0] ?? "").length, content, contentOffset, kind: "document_link" }
  }

  match = source.match(/^(`+)([^`\r\n]+?)\1/)
  if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: (match[1] ?? "").length, kind: "code" }

  match = source.match(/^(\*\*|__)(?=\S)(.+?)(?<=\S)\1/)
  if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: (match[1] ?? "").length, kind: "format", formatType: "strong" }

  match = source.match(/^(~~)(?=\S)(.+?)(?<=\S)\1/)
  if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: (match[1] ?? "").length, kind: "format", formatType: "strike" }

  match = source.match(/^(?<!\*)(\*)(?!\s)(.+?)(?<!\s)\1(?!\*)/)
  if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: 1, kind: "format", formatType: "emphasis" }

  match = source.match(/^(?<!_)(_)(?!\s)(.+?)(?<!\s)\1(?!_)/)
  if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: 1, kind: "format", formatType: "emphasis" }

  // While the server projection is queued, the active DOM still contains its
  // semantic formatting elements. Keep paired delimiters mapped through
  // transient Markdown-invalid keystrokes (for example, a trailing space in
  // an italic span) instead of deleting the author's formatting on that key.
  if (formatBudget?.strong && formatBudget.strong > 0) {
    match = source.match(/^(\*\*|__)([\s\S]+?)\1/)
    if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: (match[1] ?? "").length, kind: "format", formatType: "strong" }
  }
  if (formatBudget?.strike && formatBudget.strike > 0) {
    match = source.match(/^(~~)([\s\S]+?)\1/)
    if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: (match[1] ?? "").length, kind: "format", formatType: "strike" }
  }
  if (formatBudget?.emphasis && formatBudget.emphasis > 0) {
    match = source.match(/^(?<!\*)(\*)([\s\S]+?)\1(?!\*)/)
    if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: 1, kind: "format", formatType: "emphasis" }

    match = source.match(/^(?<!_)(_)([\s\S]+?)\1(?!_)/)
    if (match) return { length: (match[0] ?? "").length, content: match[2] ?? "", contentOffset: 1, kind: "format", formatType: "emphasis" }
  }

  match = source.match(/^\\\[([\s\S]+?)\\\]/)
  if (match) return { length: (match[0] ?? "").length, content: match[1] ?? "", kind: "math" }

  match = source.match(/^\\\(([^\r\n]+?)\\\)/)
  if (match) return { length: (match[0] ?? "").length, content: match[1] ?? "", kind: "math" }

  match = source.match(/^\$\$([\s\S]+?)\$\$(?!\$)/)
  if (match) return { length: (match[0] ?? "").length, content: match[1] ?? "", kind: "math" }

  if (previousCharacter !== "$") {
    match = source.match(/^\$(?!\$)(?!\s)([^$\r\n]+?)(?<!\s)\$(?!\$)/)
    if (match) return { length: (match[0] ?? "").length, content: match[1] ?? "", kind: "math" }
  }

  return null
}

function inlineFormatBudget(element: Element | null): FormatBudget | null {
  if (!element?.querySelectorAll) return null

  return {
    strong: element.querySelectorAll("strong, b").length,
    emphasis: element.querySelectorAll("em, i").length,
    strike: element.querySelectorAll("del, s, strike").length
  }
}

export function protectedElementsFor(element: Element | null): HTMLElement[] {
  return [...(element?.querySelectorAll<HTMLElement>("[data-editor-math-source]:not([data-editor-math-active]), [data-editor-image-source]") || [])]
}

export function allMathElementsFor(element: Element | null): HTMLElement[] {
  return [...(element?.querySelectorAll<HTMLElement>("[data-editor-math-source], [data-editor-math-active]") || [])]
}

function hasMatchingActiveMathDelimiter(source: string, allMathElements: HTMLElement[], sourceAtoms: number, protectedAtomCount: number, expectedAtoms: number): boolean {
  const missingAtoms = expectedAtoms - sourceAtoms
  if (missingAtoms <= 0 || sourceAtoms < protectedAtomCount) return false

  // An active span can outlive the source token while its empty delimiters
  // are being edited. Count that mismatch only when a delimiter pair appears
  // at the same math position in the source and DOM.
  return matchingEmptyActiveMathCount(source, allMathElements) === missingAtoms
}

function matchingEmptyActiveMathCount(source: string, allMathElements: HTMLElement[], state: { mathIndex: number; count: number } = { mathIndex: 0, count: 0 }): number {
  for (let index = 0; index < source.length;) {
    const token = inlineTokenAt(source.slice(index), null, source[index - 1])
    if (token) {
      if (token.kind === "math") state.mathIndex += 1
      else if (token.kind === "link" || token.kind === "format") {
        matchingEmptyActiveMathCount(token.content, allMathElements, state)
      }
      index += token.length
      continue
    }

    const emptyMath = activeEmptyMathTokenAt(source, index, allMathElements[state.mathIndex])
    if (emptyMath) {
      state.mathIndex += 1
      state.count += 1
      index += emptyMath.length
      continue
    }

    const codePoint = source.codePointAt(index) ?? 0
    index += codePoint > 0xffff ? 2 : 1
  }

  return state.count
}

function activeEmptyMathTokenAt(source: string, index: number, element: HTMLElement | undefined): InlineToken | null {
  if (element?.dataset?.editorMathActive !== "true") return null

  const open = element.dataset.editorMathOpen || "$"
  const close = element.dataset.editorMathClose || open
  const delimiter = `${open}${close}`
  if (!source.startsWith(delimiter, index)) return null

  if (open.startsWith("$") && close.startsWith("$")) {
    if (source[index - 1] === "$" || source[index + delimiter.length] === "$") return null
  } else if (isEscapedAt(source, index)) {
    return null
  }

  return { length: delimiter.length, content: "", kind: "math" }
}

function isEscapedAt(source: string, index: number): boolean {
  let backslashes = 0
  for (let offset = index - 1; offset >= 0 && source[offset] === "\\"; offset -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function atomMarker(index: number): string {
  return `\uE000${index.toString(36)}\uE001`
}

function visibleTextWithProtectedAtoms(element: Element, count: number): string {
  const clone = element.cloneNode(true) as HTMLElement
  const nodes = protectedElementsFor(clone)
  if (nodes.length !== count) return (element as HTMLElement).innerText || element.textContent || ""

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

function sourceAtomCounts(source: string): { math: number; image: number; total: number } {
  const counts = { math: 0, image: 0 }
  for (let index = 0; index < source.length;) {
    const token = inlineTokenAt(source.slice(index), null, source[index - 1])
    if (!token) {
      const codePoint = source.codePointAt(index) ?? 0
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

import MarkdownIt from "markdown-it"

const listParser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false
})

const LIST_OPEN_TYPES = new Set(["bullet_list_open", "ordered_list_open"])
const UNSUPPORTED_BLOCK_TYPES = new Set([
  "blockquote_open",
  "code_block",
  "fence",
  "heading_open",
  "hr",
  "html_block",
  "table_open"
])

export const ART_DIAGNOSTICS = Object.freeze({
  NO_LIST_TARGET: "ART_NO_LIST_TARGET",
  INVALID_SYNTAX: "ART_INVALID_SYNTAX",
  UNSUPPORTED_CONTENT: "ART_UNSUPPORTED_CONTENT",
  REVEAL_BOUNDARY: "ART_REVEAL_BOUNDARY",
  NO_FIT: "ART_NO_FIT",
  ITEM_TOO_TALL: "ART_ITEM_TOO_TALL",
  INTERNAL_ERROR: "ART_INTERNAL_ERROR"
})

export function analyzeArtList(source) {
  if (typeof source !== "string") return null

  let tokens
  try {
    tokens = listParser.parse(source, {})
  } catch (_error) {
    return null
  }

  const firstBlock = tokens.find(token => token.level === 0 && token.nesting !== 0)
  if (!firstBlock || !LIST_OPEN_TYPES.has(firstBlock.type) || firstBlock.map?.[0] !== 0) return null

  const rootList = rootListRecords(tokens).find(record => record.token === firstBlock)
  return rootList ? analyzeArtListTokens(tokens, rootList) : null
}

function analyzeArtListTokens(tokens, rootList) {
  const { token: firstBlock, openIndex, closeIndex } = rootList
  if (closeIndex < 0) return null
  const rootLevel = firstBlock.level

  const rootItems = []
  let unsupported = false
  for (let index = openIndex + 1; index < closeIndex; index += 1) {
    const token = tokens[index]
    if (UNSUPPORTED_BLOCK_TYPES.has(token.type)) unsupported = true
    if (token.type === "inline" && token.children?.some(child => child.type === "image")) unsupported = true

    if (token.type !== "list_item_open" || token.level !== rootLevel + 1) continue
    const itemClose = findItemClose(tokens, index + 1, closeIndex, token.level)
    if (itemClose < 0) {
      unsupported = true
      continue
    }

    let directParagraphs = 0
    let hasNestedList = false
    for (let itemIndex = index + 1; itemIndex < itemClose; itemIndex += 1) {
      const child = tokens[itemIndex]
      if (UNSUPPORTED_BLOCK_TYPES.has(child.type)) unsupported = true
      if (child.type === "inline" && child.children?.some(inline => inline.type === "image")) unsupported = true
      if (child.level !== token.level + 1) continue
      if (child.type === "paragraph_open") directParagraphs += 1
      else if (child.type === "bullet_list_open" || child.type === "ordered_list_open") hasNestedList = true
    }
    rootItems.push({ directParagraphs, hasNestedList })
    index = itemClose
  }

  const mode = firstBlock.type === "ordered_list_open" ? "sequence" : "peers"
  const density = rootItems.some(item => item.hasNestedList || item.directParagraphs > 1) ? "rich" : "compact"
  const rootStart = firstBlock.attrs?.find(([name]) => name === "start")?.[1]

  return {
    mode,
    density,
    itemCount: rootItems.length,
    orderedStart: mode === "sequence" ? (rootStart === undefined ? 1 : Number(rootStart)) : null,
    supported: !unsupported,
    listRange: { startLine: firstBlock.map?.[0] ?? 0, endLine: firstBlock.map?.[1] ?? 0 }
  }
}

function rootListRecords(tokens) {
  const records = []
  let active = null
  tokens.forEach((token, index) => {
    if (active) {
      if (token.type === active.closeType && token.level === active.token.level) {
        active.closeIndex = index
        active = null
      }
      return
    }
    if (token.level !== 0 || !LIST_OPEN_TYPES.has(token.type) || !token.map) return
    active = {
      token,
      openIndex: index,
      closeIndex: -1,
      closeType: token.type.replace("_open", "_close")
    }
    records.push(active)
  })
  return records
}

function markdownBoundaryContext(source) {
  const lines = source.split(/\r\n|\r|\n/)
  const sourceTokens = listParser.parse(source, {})
  const codeProtectedLines = new Uint8Array(lines.length)
  const markdownProtectedLines = new Uint8Array(lines.length)
  const listLines = new Uint8Array(lines.length)
  const codeTypes = new Set(["code_block", "fence", "html_block"])
  const markdownProtectedTypes = new Set([
    "bullet_list_open", "ordered_list_open", "blockquote_open", "code_block", "fence", "html_block", "table_open"
  ])
  const listTypes = new Set(["bullet_list_open", "ordered_list_open"])
  for (const token of sourceTokens) {
    if (!token.map) continue
    if (codeTypes.has(token.type)) markLines(codeProtectedLines, token.map[0], token.map[1])
    if (markdownProtectedTypes.has(token.type)) markLines(markdownProtectedLines, token.map[0], token.map[1])
    if (listTypes.has(token.type)) markLines(listLines, token.map[0], token.map[1])
  }
  const mathRanges = displayMathRanges(lines, codeProtectedLines)
  const blocks = sourceTokens.filter(token =>
    token.level === 0 && token.map && token.type !== "inline" && token.nesting !== -1
  ).map(token => ({
    type: token.type,
    startLine: token.map[0],
    endLine: token.map[1]
  }))
  const mathLines = new Uint8Array(lines.length)
  for (const range of mathRanges) {
    markLines(mathLines, range.startLine, range.endLine)
  }
  const blankLines = new Uint8Array(lines.length)
  lines.forEach((line, index) => { if (isWhitespaceLine(line)) blankLines[index] = 1 })
  const protectedLines = new Uint8Array(lines.length)
  for (let index = 0; index < lines.length; index += 1) {
    if (markdownProtectedLines[index] || mathLines[index]) protectedLines[index] = 1
  }
  const blockStartLines = new Set(blocks.map(block => block.startLine))

  const directiveLines = new Set()
  const artDirectiveLines = new Set()
  for (let index = 0; index < lines.length; index += 1) {
    const isDirective = /^\s*:::/.test(lines[index]) && !isIndentedCodeMarker(lines[index])
    const isArtCandidate = validArtLine(lines[index]) || invalidArtLine(lines[index])
    const isLegacyMarginDirective = /^\s*:::(section|subsection|footnote)\{/.test(lines[index])
    const isProtected = protectedLines[index] === 1
    const isBlockBoundary = blockStartLines.has(index) || directiveLines.has(index - 1)
    if (isDirective && !isProtected && (isBlockBoundary || isLegacyMarginDirective)) {
      directiveLines.add(index)
      if (isArtCandidate && isBlockBoundary) artDirectiveLines.add(index)
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const closingDelimiter = /^ {0,3}:::[ \t]*$/.test(lines[index])
    const indentedListContent = listLines[index] && lines[index].startsWith(" ")
    if (closingDelimiter && !codeProtectedLines[index] && !mathLines[index] && !indentedListContent) directiveLines.add(index)
    if (/^ {0,3}:::step(?=$|[^A-Za-z0-9_-])/.test(lines[index]) && !codeProtectedLines[index] && !mathLines[index]) directiveLines.add(index)
  }

  const maskedSource = lines.map((line, index) =>
    directiveLines.has(index) || blankLines[index] === 1 || mathLines[index] === 1 ? "" : line
  ).join("\n")
  const markdownTokens = listParser.parse(maskedSource, {})
  const markdownBlocks = markdownTokens.filter(token =>
    token.level === 0 && token.map && token.type !== "inline" && token.nesting !== -1
  ).map(token => ({
    startLine: token.map[0],
    endLine: token.map[1]
  }))
  const nonMathProtectedPrefix = new Uint32Array(lines.length + 1)
  for (let line = 0; line < lines.length; line += 1) {
    nonMathProtectedPrefix[line + 1] = nonMathProtectedPrefix[line] + markdownProtectedLines[line]
  }
  const topLevelMathRanges = mathRanges.filter(range =>
    nonMathProtectedPrefix[range.endLine] === nonMathProtectedPrefix[range.startLine]
  )
  markdownBlocks.push(...topLevelMathRanges.map(range => ({ startLine: range.startLine, endLine: range.endLine })))

  const boundaryMap = {
    blockStarts: markdownBlocks.map(block => block.startLine),
    blockEnds: markdownBlocks.map(block => block.endLine),
    directiveLines: [...directiveLines].sort((left, right) => left - right),
    artDirectiveLines: [...artDirectiveLines].sort((left, right) => left - right),
    blankLines: indexesOf(blankLines)
  }
  const rootListsByStartLine = new Map()
  for (const record of rootListRecords(markdownTokens)) rootListsByStartLine.set(record.token.map[0], record)

  return { markdownTokens, rootListsByStartLine, boundaryMap }
}

export function markdownBoundaryMap(source) {
  return markdownBoundaryContext(source).boundaryMap
}

function displayMathRanges(lines, codeProtectedLines) {
  const ranges = []
  let mathFence = null
  let startLine = null
  lines.forEach((line, index) => {
    if (codeProtectedLines[index]) return
    if (mathFence) {
      if (mathFenceMarker(line) === mathFence) {
        ranges.push({ type: "display_math", startLine, endLine: index + 1 })
        mathFence = null
        startLine = null
      }
      return
    }
    const opener = mathFenceOpener(line)
    if (opener) {
      mathFence = opener
      startLine = index
    }
  })
  if (mathFence) ranges.push({ type: "display_math", startLine, endLine: lines.length })
  return ranges
}

function markLines(target, startLine, endLine) {
  for (let line = Math.max(0, startLine); line < Math.min(target.length, endLine); line += 1) target[line] = 1
}

function indexesOf(values) {
  const indexes = []
  values.forEach((value, index) => { if (value) indexes.push(index) })
  return indexes
}

function isWhitespaceLine(line) {
  // Shared definition consumed by Ruby through boundary_map.blankLines.
  return /^[\t-\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*$/.test(line)
}

function isIndentedCodeMarker(line) {
  return /^(?: {4,}| *\t)[ \t]*:::/.test(line)
}

function findItemClose(tokens, start, end, level) {
  for (let index = start; index < end; index += 1) {
    if (tokens[index].type === "list_item_close" && tokens[index].level === level) return index
  }
  return -1
}

export function resolveArtBindings(source, { idPrefix = "art-directive" } = {}) {
  if (typeof source !== "string") throw new TypeError("Markdown source must be text")
  const markdownContext = markdownBoundaryContext(source)
  const lines = sourceLines(source)
  const boundaryMap = markdownContext.boundaryMap
  const directiveLines = new Set(boundaryMap.directiveLines)
  const artDirectiveLines = new Set(boundaryMap.artDirectiveLines)
  const directives = []
  const bindings = []
  const diagnostics = []
  let pending = null
  let fence = null
  let mathFence = null

  const reportNoTarget = directive => diagnostics.push({
    code: ART_DIAGNOSTICS.NO_LIST_TARGET,
    directive_id: directive.id,
    source_range: { ...directive.range }
  })

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const incomingFence = fenceMarker(line.text)
    if (fence) {
      fence = toggleFence(fence, incomingFence)
      continue
    }
    if (incomingFence) {
      if (pending) {
        reportNoTarget(pending)
        pending = null
      }
      fence = incomingFence
      continue
    }
    if (mathFence) {
      if (mathFenceMarker(line.text) === mathFence) mathFence = null
      continue
    }
    const openingMathFence = mathFenceOpener(line.text)
    if (openingMathFence) {
      if (pending) {
        reportNoTarget(pending)
        pending = null
      }
      mathFence = openingMathFence
      continue
    }

    if (validArtLine(line.text) && artDirectiveLines.has(index)) {
      if (pending) reportNoTarget(pending)
      pending = makeDirective(line, directives.length, "art", idPrefix)
      directives.push(pending)
      continue
    }
    if (invalidArtLine(line.text) && artDirectiveLines.has(index)) {
      if (pending) reportNoTarget(pending)
      pending = null
      const directive = makeDirective(line, directives.length, "art_invalid", idPrefix)
      directives.push(directive)
      diagnostics.push({
        code: ART_DIAGNOSTICS.INVALID_SYNTAX,
        directive_id: directive.id,
        source_range: { ...directive.range }
      })
      continue
    }

    if (!pending) continue
    if (!line.text.trim()) continue
    if (directiveLines.has(index) && compatibleStackDirective(line.text)) continue

    if (directiveLines.has(index) && (/^:::\s*$/.test(line.text) || /^:::/.test(line.text))) {
      reportNoTarget(pending)
      pending = null
      continue
    }

    const rootList = markdownContext.rootListsByStartLine.get(index)
    const analysis = rootList ? analyzeArtListTokens(markdownContext.markdownTokens, rootList) : null
    if (!analysis) {
      reportNoTarget(pending)
      pending = null
      continue
    }

    const endLine = Math.min(analysis.listRange.endLine, lines.length)
    const targetLines = lines.slice(index, endLine)
    const target = {
      markdown: targetLines.map(entry => entry.text).join("\n"),
      range: {
        start: line.start,
        end: targetLines.at(-1)?.end ?? line.end
      },
      analysis
    }
    const revealBoundaryLine = targetLines.find((entry, offset) =>
      offset > 0 && directiveLines.has(index + offset) &&
      /^ {0,3}:::step(?:\{[0-9]+\})?[ \t]*$/.test(entry.text)
    )
    if (revealBoundaryLine) {
      diagnostics.push({
        code: ART_DIAGNOSTICS.REVEAL_BOUNDARY,
        directive_id: pending.id,
        source_range: { start: revealBoundaryLine.start, end: revealBoundaryLine.end }
      })
    } else {
      bindings.push({
        directive_id: pending.id,
        directive_range: { ...pending.range },
        target_range: target.range,
        target_lines: { start: index, end: endLine },
        target_markdown: target.markdown,
        analysis: target.analysis
      })
    }
    if (!revealBoundaryLine && !target.analysis.supported) diagnostics.push({
      code: ART_DIAGNOSTICS.UNSUPPORTED_CONTENT,
      directive_id: pending.id,
      source_range: { ...pending.range }
    })
    pending = null

    for (let nested = index + 1; nested < endLine; nested += 1) {
      const nestedLine = lines[nested]
      const nestedFence = fenceMarker(nestedLine.text)
      if (fence) fence = toggleFence(fence, nestedFence)
      else if (nestedFence) fence = nestedFence
      else if (mathFence) {
        if (mathFenceMarker(nestedLine.text) === mathFence) mathFence = null
      } else {
        const nestedMath = mathFenceOpener(nestedLine.text)
        if (nestedMath) mathFence = nestedMath
      }
    }
    index = endLine - 1
  }

  if (pending) reportNoTarget(pending)
  return {
    directives,
    bindings,
    diagnostics,
    boundary_map: boundaryMap
  }
}

function compatibleStackDirective(line) {
  return validPositionLine(line) ||
    /^[ \t]*:::step(?=$|[^A-Za-z0-9_-])/.test(line)
}

function makeDirective(line, index, type, idPrefix) {
  return {
    id: `${idPrefix}-${index + 1}`,
    type,
    line: line.index,
    range: { start: line.start, end: line.end },
    source_range: { start: line.start, end: line.end }
  }
}

function validArtLine(line) {
  return /^:::art[ \t]*$/.test(line)
}

function invalidArtLine(line) {
  return /^:::art(?:\{|[ \t]+\S)/.test(line)
}

function validPositionLine(line) {
  const match = /^:::(align|position)[ \t]*\{([^}]*)\}[ \t]*$/.exec(line)
  if (!match) return false
  const values = match[2].trim().split(/\s+/).filter(Boolean).map(value => value.toLowerCase())
  const horizontal = values.some(value => ["left", "center", "right"].includes(value))
  const vertical = values.some(value => ["top", "middle", "bottom"].includes(value))
  if (match[1] === "align" && values.length === 2) {
    return ["top", "center", "middle", "bottom"].includes(values[0]) &&
      ["left", "center", "right"].includes(values[1])
  }
  return horizontal || vertical
}

function sourceLines(source) {
  const lines = []
  let cursor = 0
  while (cursor < source.length) {
    let newline = cursor
    while (newline < source.length && source[newline] !== "\n" && source[newline] !== "\r") newline += 1
    let end = newline
    if (newline < source.length) end += source[newline] === "\r" && source[newline + 1] === "\n" ? 2 : 1
    lines.push({ start: cursor, end, text: source.slice(cursor, newline), index: lines.length })
    cursor = end
  }
  if (source.length === 0) return []
  return lines
}

function fenceMarker(line) {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  return match ? { marker: match[1][0], length: match[1].length, closing: /^[ \t]*$/.test(match[2]) } : null
}

function toggleFence(current, incoming) {
  if (!current) return incoming
  if (incoming && incoming.marker === current.marker && incoming.length >= current.length && incoming.closing) return null
  return current
}

function mathFenceMarker(line) {
  return /^[ \t]{0,3}(\$\$|\\\[|\\\])[ \t]*$/.exec(line)?.[1] ?? null
}

function mathFenceOpener(line) {
  const marker = mathFenceMarker(line)
  if (marker === "$$") return "$$"
  if (marker === "\\[") return "\\]"
  const inlineDisplayOpener = /^[ \t]{0,3}\$\$[ \t]*(\S.*)$/.exec(line)
  return inlineDisplayOpener && !inlineDisplayOpener[1].includes("$$") ? "$$" : null
}

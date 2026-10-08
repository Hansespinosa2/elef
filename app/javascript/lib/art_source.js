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

  const rootLevel = firstBlock.level
  const closeType = firstBlock.type.replace("_open", "_close")
  let rootClose = -1
  for (let index = tokens.indexOf(firstBlock) + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === closeType && token.level === rootLevel) {
      rootClose = index
      break
    }
  }
  if (rootClose < 0) return null

  const rootItems = []
  let unsupported = false
  for (let index = tokens.indexOf(firstBlock) + 1; index < rootClose; index += 1) {
    const token = tokens[index]
    if (UNSUPPORTED_BLOCK_TYPES.has(token.type)) unsupported = true
    if (token.type === "inline" && token.children?.some(child => child.type === "image")) unsupported = true

    if (token.type !== "list_item_open" || token.level !== rootLevel + 1) continue
    const itemClose = findItemClose(tokens, index + 1, rootClose, token.level)
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

function findItemClose(tokens, start, end, level) {
  for (let index = start; index < end; index += 1) {
    if (tokens[index].type === "list_item_close" && tokens[index].level === level) return index
  }
  return -1
}

export function resolveArtBindings(source, { idPrefix = "art-directive" } = {}) {
  if (typeof source !== "string") throw new TypeError("Markdown source must be text")
  const lines = sourceLines(source)
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
      fence = incomingFence
      continue
    }
    if (mathFence) {
      if (mathFenceMarker(line.text) === mathFence) mathFence = null
      continue
    }
    const openingMathFence = mathFenceOpener(line.text)
    if (openingMathFence) {
      mathFence = openingMathFence
      continue
    }

    if (validArtLine(line.text)) {
      if (pending) reportNoTarget(pending)
      pending = makeDirective(line, directives.length, "art", idPrefix)
      directives.push(pending)
      continue
    }
    if (invalidArtLine(line.text)) {
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
    if (validPositionLine(line.text)) continue

    if (/^:::\s*$/.test(line.text) || /^:::/.test(line.text)) {
      reportNoTarget(pending)
      pending = null
      continue
    }

    const candidate = lines.slice(index).map(entry => entry.text).join("\n")
    const analysis = analyzeArtList(candidate)
    if (!analysis) {
      reportNoTarget(pending)
      pending = null
      continue
    }

    const endLine = Math.min(index + analysis.listRange.endLine, lines.length)
    const targetLines = lines.slice(index, endLine)
    const target = {
      markdown: targetLines.map(entry => entry.text).join("\n"),
      range: {
        start: line.start,
        end: targetLines.at(-1)?.end ?? line.end
      },
      analysis
    }
    bindings.push({
      directive_id: pending.id,
      directive_range: { ...pending.range },
      target_range: target.range,
      target_lines: { start: index, end: endLine },
      target_markdown: target.markdown,
      analysis: target.analysis
    })
    if (!target.analysis.supported) diagnostics.push({
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
  return { directives, bindings, diagnostics }
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
  return marker === "$$" ? "$$" : marker === "\\[" ? "\\]" : null
}

import { ART_DIAGNOSTICS, resolveArtBindings } from "#elef/art-source"

const THEMES = new Set(["light", "dark", "match"])
const TYPOGRAPHIES = new Set(["book", "modern", "technical"])

export function buildEditorMap(source, { sourceName = "Untitled presentation", mode = "presentation" } = {}) {
  return buildEditorStructure(source, { sourceName, mode }).editorMap
}

export function buildEditorStructure(source, { sourceName = "Untitled presentation", mode = "presentation" } = {}) {
  if (typeof source !== "string") throw new TypeError("The selected file did not contain readable text.")
  if (mode !== "presentation" && mode !== "document") throw new TypeError("Unsupported document mode")

  const frontMatter = initialFrontMatter(source)
  const bodyStart = frontMatter?.bodyStart ?? 0
  const ranges = mode === "document"
    ? [{ start: bodyStart, end: source.length, delimiterStart: null, delimiterEnd: null }]
    : slideSourceRanges(source, bodyStart)
  const context = { section: null, subsection: null }
  const map = {
    version: 1,
    source_name: String(sourceName),
    mode,
    source_length: source.length,
    front_matter: frontMatter ? {
      range: { start: 0, end: frontMatter.bodyStart },
      body_start: frontMatter.bodyStart
    } : null,
    slides: [],
    directives: [],
    editable_regions: []
  }
  const parsedSlides = []
  const warnings = []

  ranges.forEach((range, index) => {
    const sectionSource = source.slice(range.start, range.end)
    const normalizedSection = sectionSource.replace(/\r\n?/g, "\n")
    const idPrefix = `slide-${index + 1}-art`
    const artResolution = resolveArtBindings(sectionSource, { idPrefix })
    const boundaryMap = artResolution.boundary_map
    const metadata = slideMetadata(normalizedSection, context, mode, artResolution, boundaryMap)
    const result = editorBlocks(source, range.start, range.end, metadata, index, mode, artResolution, boundaryMap)
    let blocks = result.blocks
    let regions = result.regions
    if (mode === "document") {
      const empty = emptyEditorBlocks(source, index, blocks)
      blocks = [...blocks, ...empty.map(([block]) => block)].sort((left, right) => left.range.start - right.range.start)
      regions = [...regions, ...empty.map(([, region]) => region)]
    }
    const slideMap = {
      id: `slide-${index + 1}`,
      index,
      layout: metadata.layout,
      range: { start: range.start, end: range.end },
      source_range: { start: range.start, end: range.end },
      delimiter_range: range.delimiterStart === null
        ? null
        : { start: range.delimiterStart, end: range.delimiterEnd },
      blocks,
      directives: result.directives,
      art_diagnostics: artResolution.diagnostics.map(diagnostic => ({
        ...diagnostic,
        slide_id: `slide-${index + 1}`,
        source_range: {
          start: range.start + diagnostic.source_range.start,
          end: range.start + diagnostic.source_range.end
        }
      })),
      editable_regions: regions
    }
    if (metadata.reveal_event_count > 0) slideMap.reveal_event_count = metadata.reveal_event_count
    map.slides.push(slideMap)
    map.directives.push(...result.directives)
    if (slideMap.art_diagnostics.length) {
      map.art_diagnostics ||= []
      map.art_diagnostics.push(...slideMap.art_diagnostics)
    }
    map.editable_regions.push(...regions)
    parsedSlides.push({ ...metadata, map: slideMap })
    warnings.push(...metadata.warnings)
    for (const diagnostic of slideMap.art_diagnostics) warnings.push(artDiagnosticMessage(diagnostic.code))
    if (!slideMap.art_diagnostics.length) delete slideMap.art_diagnostics
  })

  return {
    editorMap: map,
    slides: parsedSlides,
    warnings,
    style: readStyle(source),
    marginSettings: marginSettings(source)
  }
}

export function initialFrontMatter(source) {
  const lines = sourceLines(source)
  if (!lines.length || lines[0].text.replace(/^\uFEFF/, "").replace(/[ \t]+$/, "") !== "---") return null
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.text.replace(/[ \t]+$/, "") === "---")
  if (closingIndex < 0) return null
  const metadataLines = lines.slice(1, closingIndex)
  if (!metadataLines.some(line => /^[A-Za-z_][\w-]*\s*:/.test(line.text))) return null
  return {
    lines,
    closingLine: closingIndex,
    bodyStart: lines[closingIndex].end
  }
}

export function readStyle(source) {
  const frontMatter = initialFrontMatter(source)
  const read = (key, fallback, vocabulary) => {
    if (!frontMatter) return fallback
    for (const line of frontMatter.lines.slice(1, frontMatter.closingLine)) {
      const match = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line.text)
      if (!match) continue
      const cleaned = match[1].trim().replace(/\s+#.*$/, "").trim()
      const unquoted = cleaned.match(/^(['"])(.*)\1$/)?.[2] ?? cleaned
      return vocabulary.has(unquoted) ? unquoted : fallback
    }
    return fallback
  }
  return {
    theme: read("theme", "match", THEMES),
    typography: read("typography", "book", TYPOGRAPHIES)
  }
}

// The native appearance adapter persists the same flat metadata fields as
// Rails. Retain unrelated metadata, body bytes, and the file's line endings.
export function withAppearanceValue(source, key, value) {
  const vocabulary = key === "theme" ? THEMES : key === "typography" ? TYPOGRAPHIES : null
  if (typeof source !== "string" || !vocabulary || (value !== "" && !vocabulary.has(value))) {
    throw new TypeError("Unsupported appearance value")
  }
  const front = initialFrontMatter(source)
  const ending = line => source.slice(line.start + line.text.length, line.end)
  const eol = front?.lines.map(ending).find(Boolean) || (source.includes("\r\n") ? "\r\n" : "\n")
  if (!front) return value === "" ? source : `---${eol}${key}: ${value}${eol}---${eol}${source}`
  const matching = front.lines.slice(1, front.closingLine).find(line => new RegExp(`^\\s*${key}\\s*:`).test(line.text))
  if (matching) {
    const replacement = value === "" ? "" : `${key}: ${value}${ending(matching)}`
    const updated = source.slice(0, matching.start) + replacement + source.slice(matching.end)
    if (value === "" && front.closingLine === 2) {
      return source.slice(front.bodyStart).replace(/^\r?\n/, "")
    }
    return updated
  }
  if (value === "") return source
  const closing = front.lines[front.closingLine]
  return source.slice(0, closing.start) + `${key}: ${value}${eol}` + source.slice(closing.start)
}

function marginSettings(source) {
  const settings = { section: true, subsection: true, footnote: true, slide_count: true }
  const frontMatter = initialFrontMatter(source)
  if (!frontMatter) return settings
  let inSettings = false
  for (const line of frontMatter.lines.slice(1, frontMatter.closingLine).map(entry => entry.text)) {
    if (/^show-in-margin\s*:\s*$/.test(line)) {
      inSettings = true
    } else if (inSettings && /^\s+([A-Za-z][\w-]*)\s*:\s*(true|false)\s*$/.test(line)) {
      const match = /^\s+([A-Za-z][\w-]*)\s*:\s*(true|false)\s*$/.exec(line)
      const key = match[1].replace(/-([a-z])/g, (_, letter) => `_${letter}`).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, "")
      if (Object.hasOwn(settings, key)) settings[key] = match[2] === "true"
    } else if (/^\S/.test(line)) {
      inSettings = false
    }
  }
  return settings
}

function slideSourceRanges(source, bodyStart) {
  const ranges = []
  let start = bodyStart
  let fence = null
  let mathFence = null
  for (const line of sourceLines(source, bodyStart)) {
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
      if (displayMathFenceMarker(line.text) === mathFence) mathFence = null
      continue
    }
    const openingMathFence = displayMathFenceOpener(line.text)
    if (openingMathFence) {
      mathFence = openingMathFence
      continue
    }
    if (/^[ \t]*---[ \t]*$/.test(line.text)) {
      ranges.push({ start, end: line.start, delimiterStart: line.start, delimiterEnd: line.end })
      start = line.end
    }
  }
  ranges.push({ start, end: source.length, delimiterStart: null, delimiterEnd: null })
  return ranges
}

function editorBlocks(source, start, end, slide, slideIndex, mode, artResolution, sourceBoundaryMap) {
  const lines = sourceLines(source, start, end)
  const artBindings = indexArtBindings(artResolution.bindings, lines.length, start)
  const artDirectivesByLine = new Map(artResolution.directives.map(directive => [directive.line, directive]))
  const boundaryMap = {
    blockStarts: new Set(sourceBoundaryMap.blockStarts),
    blockEnds: new Set(sourceBoundaryMap.blockEnds),
    directiveLines: new Set(sourceBoundaryMap.directiveLines),
    blankLines: new Set(sourceBoundaryMap.blankLines)
  }
  const blocks = []
  const directives = []
  const regions = []
  let current = []
  let pendingPosition = null
  let fence = null
  let mathFence = null

  const flush = () => {
    if (!current.length) return
    const first = current[0]
    const last = current.at(-1)
    const blockStart = first.start
    const blockEnd = last.end
    const markdown = source.slice(blockStart, blockEnd).replace(/(?:\r\n|\r|\n)$/, "")
    const blockIndex = blocks.length
    const id = `slide-${slideIndex + 1}-block-${blockIndex + 1}`
    const kind = editableBlockKind(markdown)
    const range = { start: blockStart, end: blockEnd }
    const contentRange = { start: blockStart, end: blockStart + markdown.length }
    const block = {
      id,
      index: blockIndex,
      kind,
      markdown,
      position: pendingPosition?.value ?? null,
      position_directive_id: pendingPosition?.directiveId ?? null,
      range,
      source_range: { ...range },
      content_range: contentRange
    }
    const revealEvent = slide.blocks[blockIndex]?.reveal_event
    if (revealEvent !== undefined) block.reveal_event = revealEvent
    const artBinding = artBindings.byTargetStart.get(blockStart)
    if (artBinding) {
      block.art = {
        directive_id: artBinding.directive_id,
        source_range: {
          start: start + artBinding.directive_range.start,
          end: start + artBinding.directive_range.end
        }
      }
    }
    const region = editableRegion(markdown, blockStart, id, slideIndex, blockIndex, kind, slide, mode)
    block.editable_region_id = region.id
    blocks.push(block)
    regions.push(region)
    current = []
    pendingPosition = null
  }

  lines.forEach((line, lineIndex) => {
    if (boundaryMap.blockStarts.has(lineIndex) && current.length) flush()
    const incomingFence = fenceMarker(line.text)
    if (fence) {
      current.push(line)
      fence = toggleFence(fence, incomingFence)
      return
    }
    if (incomingFence) {
      current.push(line)
      fence = incomingFence
      return
    }
    if (mathFence) {
      current.push(line)
      if (displayMathFenceMarker(line.text) === mathFence) {
        mathFence = null
        if (boundaryMap.blockEnds.has(lineIndex + 1)) flush()
      }
      return
    }
    const openingMathFence = displayMathFenceOpener(line.text)
    if (openingMathFence) {
      current.push(line)
      mathFence = openingMathFence
      return
    }
    if (boundaryMap.blankLines.has(lineIndex)) {
      const artBinding = artBindings.byLine[lineIndex]
      if (artBinding && lineIndex + 1 < artBinding.target_lines.end) current.push(line)
      else flush()
      return
    }
    if (boundaryMap.directiveLines.has(lineIndex)) {
      flush()
      const text = line.text.trim()
      const artDirective = artDirectivesByLine.get(lineIndex)
      const directive = editorDirective(line, text, slideIndex, directives.length, mode)
      if (artDirective) {
        directive.id = artDirective.id
        directive.type = artDirective.type === "art" ? "art" : "art_invalid"
        directive.art_diagnostic = artDirective.type === "art_invalid" ? ART_DIAGNOSTICS.INVALID_SYNTAX : null
      }
      directives.push(directive)
      const position = positionFromBlock(text)
      if (position) {
        pendingPosition = {
          value: position,
          directiveId: directive.id
        }
      }
      return
    }
    current.push(line)
    if (boundaryMap.blockEnds.has(lineIndex + 1)) flush()
  })
  flush()
  if (mode === "document") directives.forEach(directive => { directive.scope = "document" })
  return { blocks, directives, regions }
}

function indexArtBindings(bindings, lineCount, sourceOffset = 0) {
  const byLine = new Array(lineCount)
  const byTargetStart = new Map()
  for (const binding of bindings) {
    byTargetStart.set(sourceOffset + binding.target_range.start, binding)
    const start = Math.max(0, binding.target_lines.start)
    const end = Math.min(lineCount, binding.target_lines.end)
    for (let line = start; line < end; line += 1) byLine[line] = binding
  }
  return { byLine, byTargetStart }
}

function editorDirective(line, text, slideIndex, directiveIndex, mode) {
  const step = mode === "presentation" ? stepDirective(line.text) : null
  const position = /^:::(align|position)[ \t]*\{([^}]*)\}/.exec(text)
  const margin = /^:::(section|subsection|footnote)\{/.exec(text)
  const type = step?.kind === "step" ? "step" : step?.kind === "malformed" ? "malformed_step" : position ? "position" : margin?.[1] ?? "unknown"
  const range = { start: line.start, end: line.end }
  return {
    id: `slide-${slideIndex + 1}-directive-${directiveIndex + 1}`,
    type,
    value: step?.kind === "step" ? step.label : position?.[2].trim() ?? null,
    text,
    range,
    source_range: { ...range },
    editable: type === "position"
  }
}

function editableRegion(markdown, blockStart, blockId, slideIndex, blockIndex, kind, slide, mode) {
  const id = `slide-${slideIndex + 1}-region-${blockIndex + 1}`
  const editable = clientCanRoundTrip(markdown, kind)
  const heading = /^(\s{0,3})(#+)(\s+)(.+?)(\s*#*\s*)$/s.exec(markdown)
  if (heading) {
    const contentStart = blockStart + heading[1].length + heading[2].length + heading[3].length
    const contentEnd = contentStart + heading[4].length
    const range = { start: blockStart, end: blockStart + markdown.length }
    return {
      id,
      block_id: blockId,
      role: (mode === "document" && blockIndex === 0) || slide.title === markdown ? "title" : "heading",
      kind: "heading",
      text: heading[4].trim(),
      range,
      source_range: { ...range },
      content_range: { start: contentStart, end: contentEnd },
      editable
    }
  }
  const emptyHeading = /^(\s{0,3}#)[ \t]*$/.exec(markdown)
  if (emptyHeading) {
    const offset = blockStart + emptyHeading[0].length
    const range = { start: blockStart, end: blockStart + markdown.length }
    return {
      id,
      block_id: blockId,
      role: "title",
      kind: "heading",
      text: "",
      range,
      source_range: { ...range },
      content_range: { start: offset, end: offset },
      editable,
      empty_heading: true
    }
  }
  const range = { start: blockStart, end: blockStart + markdown.length }
  return {
    id,
    block_id: blockId,
    role: "block",
    kind,
    text: markdown,
    range,
    source_range: { ...range },
    content_range: { ...range },
    editable
  }
}

function emptyEditorBlocks(source, slideIndex, blocks) {
  const placeholders = []
  let sequence = 0
  for (const [index, previous] of blocks.slice(0, -1).entries()) {
    const following = blocks[index + 1]
    const start = previous.content_range.end
    const end = following.range.start
    const separator = source.slice(start, end)
    if (!/^[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)*$/.test(separator)) continue
    const endings = separator.match(/\r\n|\r|\n/g) || []
    const emptyCount = Math.max(Math.floor(endings.length / 2) - 1, 0)
    let offset = start
    for (let emptyIndex = 1; emptyIndex <= emptyCount; emptyIndex += 1) {
      offset = start + endings.slice(0, emptyIndex * 2).join("").length
      sequence += 1
      placeholders.push(emptyEditorBlock(slideIndex, sequence, offset))
    }
  }
  const trailing = source.match(/(?:\r\n|\r|\n)+$/)?.[0] ?? ""
  const endings = trailing.match(/\r\n|\r|\n/g) || []
  const trailingCount = Math.floor(endings.length / 2)
  const trailingStart = source.length - trailing.length
  for (let emptyIndex = 1; emptyIndex <= trailingCount; emptyIndex += 1) {
    const offset = trailingStart + endings.slice(0, emptyIndex * 2).join("").length
    sequence += 1
    placeholders.push(emptyEditorBlock(slideIndex, sequence, offset))
  }
  return placeholders
}

function emptyEditorBlock(slideIndex, sequence, offset) {
  const blockId = `slide-${slideIndex + 1}-empty-${sequence}`
  const regionId = `slide-${slideIndex + 1}-empty-region-${sequence}`
  const range = { start: offset, end: offset }
  return [{
    id: blockId,
    index: sequence,
    kind: "paragraph",
    markdown: "",
    range: { ...range },
    source_range: { ...range },
    content_range: { ...range },
    editable_region_id: regionId,
    empty_placeholder: true
  }, {
    id: regionId,
    block_id: blockId,
    role: "block",
    kind: "paragraph",
    text: "",
    range: { ...range },
    source_range: { ...range },
    content_range: { ...range },
    editable: true,
    empty_placeholder: true
  }]
}

function editableBlockKind(markdown) {
  if (headingFor(markdown) || /^\s{0,3}#[ \t]*$/.test(markdown)) return "heading"
  if (fencedCodeSource(markdown) || /^ {4}|^\t/.test(markdown)) return "code"
  if (imageBlock(markdown)) return "image"
  if (tableBlock(markdown)) return "table"
  if (/^\s*(?:[-*+] |\d+[.)] )/.test(markdown)) return "list"
  if (/^\s*>/.test(markdown)) return "quote"
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(markdown)) return "rule"
  return "paragraph"
}

function clientCanRoundTrip(markdown, kind) {
  if (kind === "code" && /^\s{0,3}(?:`{3,}|~{3,})[ \t]*mermaid\b/i.test(markdown)) return false
  if (kind === "code" && fencedCodeSource(markdown)) return supportedFencedCode(markdown)
  if (kind === "code" || kind === "rule") return false
  if (kind === "heading" && sourceLines(markdown).length !== 1) return false
  if (kind === "table" && !supportedTable(markdown)) return false
  if (kind === "quote" && sourceLines(markdown).some(line => /^[ \t]*>[ \t]*>/.test(line.text))) return false
  if (kind !== "image" && /!\[[^\]]*\]\(elef-asset:[0-9a-f]{64}(?:\s+[^)]*)?\)/.test(markdown)) return false
  if (/^[^\r\n]+\r?\n[=-]{3,}[ \t]*$/.test(markdown)) return false
  return !unsupportedBlockSyntax(markdown)
}

function supportedFencedCode(markdown) {
  const match = /^([ \t]*)(`{3,}|~{3,})([^\r\n]*?)(\r\n|\n|\r)([\s\S]*?)(\r\n|\n|\r)([`~]{3,})([ \t]*)$/.exec(markdown)
  return Boolean(match && match[7][0] === match[2][0] && [...match[7]].every(char => char === match[2][0]) && match[7].length >= match[2].length)
}

function supportedTable(markdown) {
  const lines = markdown.split(/\r?\n/)
  if (lines.length < 3 || !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[1])) return false
  const columns = tableCellCount(lines[0])
  return columns > 0 && tableCellCount(lines[1]) === columns && lines.slice(2).every(line => Boolean(line.trim()) && tableCellCount(line) === columns)
}

function tableCellCount(line) {
  const value = line.trim()
  const pipes = []
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\" && !escaped) {
      escaped = true
      continue
    }
    if (value[index] === "|" && !escaped) pipes.push(index)
    escaped = false
  }
  const leading = pipes[0] === 0 ? 1 : 0
  const trailing = pipes.at(-1) === value.length - 1 ? 1 : 0
  return Math.max(pipes.length - leading - trailing + 1, 0)
}

function unsupportedBlockSyntax(markdown) {
  if (/<\s*!--|--\s*>|<\/?[A-Za-z][^>]*>/.test(markdown)) return true
  if (/<\s*(?:https?:\/\/|mailto:)[^>]+>|<\s*[^<>\s@]+@[^<>\s@]+\s*>/i.test(markdown)) return true
  if (/\[[^\]]+\]\s*\[[^\]]*\]|^\s*\[[^\]]+\]:|\[\^[^\]]+\]/m.test(markdown)) return true
  if (/&(?:[A-Za-z][A-Za-z0-9]+|#\d+|#x[0-9A-Fa-f]+);/.test(markdown)) return true
  if (/\]\([^)]*\(/.test(markdown)) return true
  if (/[A-Za-z0-9][_*]{1,2}[^\s*_]+?[*_]{1,2}[A-Za-z0-9]/.test(markdown)) return true
  if (sourceLines(markdown).some(line => /(?: {2,}|\\)\r?$/.test(line.text))) return true
  return unsupportedEscapedPunctuation(markdown)
}

function unsupportedEscapedPunctuation(markdown) {
  const withoutMath = displayMathFenceSource(markdown)
    ? ""
    : markdown.replace(/(?<!\\)\$\$[\s\S]+?\$\$(?!\$)|(?<![\\$])\$(?!\$|\s)[^$\r\n]+?(?<!\s)\$(?!\$)/g, "")
  for (let index = 0; index < withoutMath.length; index += 1) {
    if (withoutMath[index] !== "\\") continue
    const next = withoutMath[index + 1]
    if (next === undefined || next === "$" || /[A-Za-z0-9_\s]/.test(next)) continue
    return true
  }
  return false
}

function slideMetadata(markdown, context, mode, artResolution, sourceBoundaryMap) {
  let normalized = markdown.replace(/\r\n?/g, "\n")
  const reveals = resolveRevealGroups(normalized, mode, artResolution)
  const margin = mode === "presentation"
    ? parseMarginDirectives(normalized, context, sourceBoundaryMap)
    : { content: normalized, section: null, subsection: null, footnote: null, warnings: [] }
  normalized = margin.content
  const lines = normalized.split("\n")
  for (const directive of artResolution.directives) {
    if (directive.type === "art" || directive.type === "art_invalid") lines[directive.line] = ""
  }
  for (const line of reveals.directive_lines) lines[line] = ""
  const parsed = parseBlocks(lines.join("\n"), artResolution, sourceBoundaryMap, reveals)
  const layout = inferLayout(parsed.blocks)
  const title = ["two-column", "three-column"].includes(layout) ? parsed.blocks[0]?.markdown ?? null : null
  const regions = columnRegions(parsed.blocks, layout)
  return {
    layout,
    title,
    blocks: parsed.blocks,
    reveal_event_count: parsed.reveal_event_count ?? 0,
    regions,
    section: margin.section,
    subsection: margin.subsection,
    footnote: margin.footnote,
    warnings: [...margin.warnings, ...reveals.warnings, ...parsed.warnings]
  }
}

function parseMarginDirectives(markdown, context, sourceBoundaryMap) {
  const lines = markdown.split("\n")
  const directiveLines = new Set(sourceBoundaryMap.directiveLines)
  const blankLines = new Set(sourceBoundaryMap.blankLines)
  const content = []
  const warnings = []
  let leading = true
  let fence = null
  let mathFence = null
  let footnote = null
  lines.forEach((line, index) => {
    const incoming = fenceMarker(line)
    if (fence) {
      content.push(line)
      fence = toggleFence(fence, incoming)
      return
    }
    if (incoming) {
      content.push(line)
      fence = incoming
      leading = false
      return
    }
    if (mathFence) {
      if (displayMathFenceMarker(line) === mathFence) mathFence = null
      content.push(line)
      return
    }
    const opening = displayMathFenceOpener(line)
    if (opening) {
      mathFence = opening
      content.push(line)
      leading = false
      return
    }
    const directive = directiveLines.has(index) ? marginDirective(line) : null
    if (directive) {
      content.push("")
      if (directive.malformed) {
        warnings.push(`Malformed ${directive.type} margin directive was removed.`)
      } else if (directive.type === "footnote") {
        if (lines.slice(index + 1).every((_following, offset) => blankLines.has(index + 1 + offset))) footnote = directive.value
        else warnings.push("Footnote margin directive must appear at the end of a slide.")
      } else if (leading) {
        context[directive.type] = directive.value
      } else {
        warnings.push(`${directive.type[0].toUpperCase()}${directive.type.slice(1)} margin directive must appear at the beginning of a slide.`)
      }
      return
    }
    if (!blankLines.has(index)) leading = false
    content.push(line)
  })
  return { content: content.join("\n"), section: context.section, subsection: context.subsection, footnote, warnings }
}

function marginDirective(line) {
  const match = /^\s*:::(section|subsection|footnote)\{/.exec(line)
  if (!match) return null
  const chars = [...line.slice(match[0].length)]
  const value = []
  let depth = 1
  for (let index = 0; index < chars.length; index += 1) {
    const character = chars[index]
    if (character === "\\" && ["{", "}", "\\"].includes(chars[index + 1])) {
      value.push(chars[index + 1])
      index += 1
    } else if (character === "{") {
      depth += 1
      value.push(character)
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) return chars.slice(index + 1).join("").trim() ? { type: match[1], malformed: true } : { type: match[1], value: value.join("").trim() }
      value.push(character)
    } else {
      value.push(character)
    }
  }
  return { type: match[1], malformed: true }
}

function parseBlocks(markdown, artResolution, sourceBoundaryMap, reveals) {
  const rawBlocks = markdownBlocks(markdown, artResolution, sourceBoundaryMap)
  if (reveals?.directive_lines.length) return parseBlocksWithReveals(rawBlocks, artResolution, reveals)

  return parseBlocksLegacy(rawBlocks, artResolution)
}

function parseBlocksLegacy(rawBlocks, artResolution) {
  const blocks = []
  const warnings = []
  const artBindingsByStartLine = new Map(artResolution.bindings.map(binding => [binding.target_lines.start, binding]))
  for (let index = 0; index < rawBlocks.length;) {
    const record = rawBlocks[index]
    const block = record.markdown
    const position = positionFromBlock(block)
    if (position) {
      if (rawBlocks[index + 1] !== undefined) {
        blocks.push(parsedBlock(rawBlocks[index + 1], position, artBindingsByStartLine, null))
        index += 2
      } else {
        warnings.push("Alignment directive has no following Markdown block.")
        index += 1
      }
    } else if (block === ":::" || block.startsWith(":::")) {
      warnings.push("Unknown or malformed presentation directive was removed.")
      index += 1
    } else {
      blocks.push(parsedBlock(record, null, artBindingsByStartLine, null))
      index += 1
    }
  }
  return { blocks, warnings, reveal_event_count: 0 }
}

function parseBlocksWithReveals(rawBlocks, artResolution, reveals) {
  const blocks = []
  const warnings = []
  const artBindingsByStartLine = new Map(artResolution.bindings.map(binding => [binding.target_lines.start, binding]))
  for (let index = 0; index < rawBlocks.length;) {
    const record = rawBlocks[index]
    if (record.markdown === ":::") {
      warnings.push("Unknown or malformed presentation directive was removed.")
      index += 1
      continue
    }

    const position = positionFromBlock(record.markdown)
    if (position) {
      let selectedPosition = position
      index += 1
      while (index < rawBlocks.length) {
        const nextPosition = positionFromBlock(rawBlocks[index].markdown)
        if (!nextPosition) break
        selectedPosition = nextPosition
        index += 1
      }
      if (rawBlocks[index]) {
        blocks.push(parsedBlock(rawBlocks[index], selectedPosition, artBindingsByStartLine, reveals.event_by_line))
        index += 1
      } else {
        warnings.push("Alignment directive has no following Markdown block.")
      }
      continue
    }

    if (record.markdown.startsWith(":::")) {
      warnings.push("Unknown or malformed presentation directive was removed.")
      index += 1
      continue
    }

    blocks.push(parsedBlock(record, null, artBindingsByStartLine, reveals.event_by_line))
    index += 1
  }
  return { blocks, warnings, reveal_event_count: reveals.event_count }
}

function parsedBlock(record, position, artBindingsByStartLine, eventByLine) {
  const block = { markdown: record.markdown, position }
  const binding = artBindingsByStartLine.get(record.startLine)
  if (binding) block.art = { directive_id: binding.directive_id }
  const revealEvent = eventByLine?.[record.startLine]
  if (revealEvent !== undefined) block.reveal_event = revealEvent
  return block
}

function resolveRevealGroups(markdown, mode, artResolution) {
  const lines = markdown.split("\n")
  const empty = { event_by_line: {}, event_count: 0, directive_lines: [], warnings: [], lines }
  if (mode !== "presentation") return empty

  const directiveLines = new Set(artResolution.boundary_map.directiveLines)
  const blankLines = new Set(artResolution.boundary_map.blankLines)
  const artLines = new Set(artResolution.directives.map(directive => directive.line))
  const eventByLine = {}
  const consumed = []
  const warnings = []
  const pending = []
  const current = []
  const eventOrdinals = new Map()
  let stepSequence = 0

  const warnConflicts = () => {
    const labels = new Set(pending.map(step => step.label === null ? "plain" : `label:${canonicalStepLabel(step.label)}`))
    if (labels.size > 1) warnings.push("Conflicting step directives in one stack; the last valid step directive takes effect.")
  }
  const orphan = () => {
    if (!pending.length) return
    warnConflicts()
    warnings.push("Step directive has no following contiguous Markdown group; place content immediately below it without a blank line.")
    pending.length = 0
  }
  const flush = () => {
    if (!current.length) return
    warnConflicts()
    const step = pending.at(-1)
    if (step) {
      const identity = step.label === null ? `plain:${step.sequence}` : `label:${canonicalStepLabel(step.label)}`
      if (!eventOrdinals.has(identity)) eventOrdinals.set(identity, eventOrdinals.size)
      const revealEvent = eventOrdinals.get(identity)
      for (const line of current) eventByLine[line] = revealEvent
    }
    current.length = 0
    pending.length = 0
  }

  lines.forEach((line, lineIndex) => {
    const step = directiveLines.has(lineIndex) ? stepDirective(line) : null
    if (step?.kind === "step") {
      flush()
      consumed.push(lineIndex)
      stepSequence += 1
      pending.push({ ...step, sequence: stepSequence })
      return
    }
    if (step?.kind === "malformed") {
      flush()
      consumed.push(lineIndex)
      warnings.push("Malformed step directive was removed; use :::step or :::step{N} on its own line.")
      return
    }
    if (step?.kind === "indented_code") {
      current.push(lineIndex)
      return
    }

    if (blankLines.has(lineIndex)) {
      flush()
      orphan()
      return
    }
    if (directiveLines.has(lineIndex)) {
      if (/^ {0,3}:::[ \t]*$/.test(line)) {
        flush()
        orphan()
        return
      }
      const compatible = positionFromBlock(line) || artLines.has(lineIndex) || /^\s*:::(?:section|subsection|footnote)\{/.test(line)
      if (!compatible) {
        flush()
        orphan()
      }
      return
    }
    current.push(lineIndex)
  })
  flush()
  orphan()

  return { event_by_line: eventByLine, event_count: eventOrdinals.size, directive_lines: consumed, warnings, lines }
}

function stepDirective(line) {
  if (/^ {4,}:::step(?=$|[^A-Za-z0-9_-])/.test(line)) return { kind: "indented_code" }
  if (!/^[ \t]*:::step(?=$|[^A-Za-z0-9_-])/.test(line)) return null
  const valid = /^ {0,3}:::step(?:\{([0-9]+)\})?[ \t]*$/.exec(line)
  return valid ? { kind: "step", label: valid[1] ?? null } : { kind: "malformed" }
}

function canonicalStepLabel(label) {
  return label.replace(/^0+/, "") || "0"
}

function markdownBlocks(markdown, artResolution, sourceBoundaryMap) {
  const blocks = []
  const artBindings = indexArtBindings(artResolution.bindings, markdown.split("\n").length)
  const boundaryMap = {
    blockStarts: new Set(sourceBoundaryMap.blockStarts),
    blockEnds: new Set(sourceBoundaryMap.blockEnds),
    directiveLines: new Set(sourceBoundaryMap.directiveLines),
    blankLines: new Set(sourceBoundaryMap.blankLines)
  }
  let current = []
  let currentStartLine = null
  let currentEndLine = null
  const flush = () => {
    if (!current.length) return
    blocks.push({ markdown: current.join("\n"), startLine: currentStartLine, endLine: currentEndLine })
    current = []
    currentStartLine = null
    currentEndLine = null
  }
  const pushLine = (line, index) => {
    if (!current.length) currentStartLine = index
    current.push(line)
    currentEndLine = index + 1
  }
  let fence = null
  let mathFence = null
  for (const [index, line] of markdown.split("\n").entries()) {
    if (boundaryMap.blockStarts.has(index) && current.length) flush()
    const incoming = fenceMarker(line)
    if (fence) fence = toggleFence(fence, incoming)
    else if (incoming) fence = incoming
    if (!fence && mathFence) {
      current.push(line)
      if (displayMathFenceMarker(line) === mathFence) {
        mathFence = null
        if (boundaryMap.blockEnds.has(index + 1)) flush()
      }
      continue
    }
    if (!fence) {
      const opening = displayMathFenceOpener(line)
      if (opening) mathFence = opening
    }
    if ((line === "" || boundaryMap.blankLines.has(index)) && boundaryMap.directiveLines.has(index)) {
      // Source resolution has already consumed this directive as metadata.
      // Its blank placeholder preserves line ownership without creating an
      // empty rendered block or a second directive interpretation.
      flush()
    } else if (!fence && !mathFence && boundaryMap.directiveLines.has(index)) {
      flush()
      blocks.push({ markdown: line.trim(), startLine: index, endLine: index + 1 })
    } else if ((line === "" || boundaryMap.blankLines.has(index)) && !fence && !mathFence) {
      const artBinding = artBindings.byLine[index]
      if (artBinding && index + 1 < artBinding.target_lines.end) pushLine(line, index)
      else flush()
    } else {
      pushLine(line, index)
    }
    if (boundaryMap.blockEnds.has(index + 1)) flush()
  }
  flush()
  return blocks
}

function positionFromBlock(block) {
  const match = /^\s*:::(align|position)[ \t]*\{([^}]*)\}\s*$/.exec(block)
  if (!match) return null
  const values = match[2].split(/\s+/).filter(Boolean).map(value => value.toLowerCase())
  let horizontal = values.find(value => ["left", "center", "right"].includes(value))
  let vertical = values.find(value => ["top", "middle", "bottom"].includes(value))
  if (!horizontal && !vertical) return null
  return { horizontal: horizontal || "left", vertical: vertical || "top", vertical_explicit: Boolean(vertical) }
}

function artDiagnosticMessage(code) {
  const messages = {
    [ART_DIAGNOSTICS.NO_LIST_TARGET]: "Art needs a root Markdown list immediately after its directive.",
    [ART_DIAGNOSTICS.INVALID_SYNTAX]: "Art directive syntax is invalid. Use :::art with no arguments.",
    [ART_DIAGNOSTICS.UNSUPPORTED_CONTENT]: "Art contains unsupported content; the complete Markdown list is shown.",
    [ART_DIAGNOSTICS.REVEAL_BOUNDARY]: "SmartArt list crosses a reveal boundary; split the Art list or remove the step marker inside it. The complete Markdown list is shown.",
    [ART_DIAGNOSTICS.NO_FIT]: "Art does not fit the fixed slide; all authored content remains available.",
    [ART_DIAGNOSTICS.ITEM_TOO_TALL]: "An Art item is taller than a document page and remains intact.",
    [ART_DIAGNOSTICS.INTERNAL_ERROR]: "Art could not be laid out; the complete Markdown list remains available."
  }
  return messages[code] || "Art reported an unknown diagnostic."
}

function inferLayout(blocks) {
  const meaningful = blocks.filter(block => block.markdown.trim())
  if (!meaningful.length) return "body"
  if (meaningful.length === 1 && imageBlock(meaningful[0].markdown)) return "image"
  if (headingFor(meaningful[0].markdown)?.level === 1) {
    const following = meaningful.slice(1)
    const headings = following.map(block => headingFor(block.markdown)).filter(Boolean)
    const firstHeadingIndex = following.findIndex(block => headingFor(block.markdown))
    const levels = headings.map(heading => heading.level)
    if (headings.length >= 2 && headings.length <= 3 && firstHeadingIndex === 0 && new Set(levels).size === 1 && levels[0] > 1) {
      return headings.length === 2 ? "two-column" : "three-column"
    }
  }
  const contentBlocks = headingFor(meaningful[0].markdown)?.level === 1 ? meaningful.slice(1) : null
  if (contentBlocks?.length === 1) {
    const content = contentBlocks[0].markdown
    if (imageBlock(content)) return "image"
    if (tableBlock(content)) return "table"
    if (codeBlock(content)) return "code"
    if (!/^\s*(?:[-*+] |\d+[.)] |> |!\[|\||`{3,}|~{3,})/.test(content)) return "statement"
  }
  return "body"
}

function columnRegions(blocks, layout) {
  if (!["two-column", "three-column"].includes(layout)) return [blocks]
  const regions = []
  for (const block of blocks.slice(1)) {
    if (headingFor(block.markdown)) regions.push([])
    if (regions.length) regions.at(-1).push(block)
  }
  return regions
}

function headingFor(markdown) {
  const first = sourceLines(markdown)[0]?.text ?? ""
  const match = /^\s{0,3}(#+)\s+(.+?)\s*#*\s*$/.exec(first)
  return match ? { level: match[1].length, text: match[2].trim() } : null
}

function imageBlock(markdown) {
  return /^\s*!\[[^\]]*\]\([^\)]+\)\s*$/s.test(markdown)
}

function tableBlock(markdown) {
  const lines = sourceLines(markdown).map(line => line.text)
  return lines.length >= 2 && lines[0].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[1])
}

function codeBlock(markdown) {
  const lines = sourceLines(markdown).map(line => line.text)
  const opening = /^\s*([`~]{3,})/.exec(lines[0] ?? "")
  const closing = /^\s*([`~]{3,})\s*$/.exec(lines.at(-1) ?? "")
  return Boolean(opening && closing && opening[1][0] === closing[1][0] && closing[1].length >= opening[1].length)
}

function fencedCodeSource(markdown) {
  return Boolean(fenceMarker(sourceLines(markdown)[0]?.text ?? ""))
}

function displayMathFenceMarker(line) {
  return /^[ \t]{0,3}(\$\$|\\\[|\\\])[ \t]*$/.exec(line)?.[1] ?? null
}

function displayMathFenceOpener(line) {
  const marker = displayMathFenceMarker(line)
  if (marker === "$$") return "$$"
  if (marker === "\\[") return "\\]"
  const inlineDisplayOpener = /^[ \t]{0,3}\$\$[ \t]*(\S.*)$/.exec(line)
  return inlineDisplayOpener && !inlineDisplayOpener[1].includes("$$") ? "$$" : null
}

function displayMathFenceSource(markdown) {
  const lines = markdown.split(/\r\n|\r|\n/)
  const opener = displayMathFenceOpener(lines[0] ?? "")
  return Boolean(opener && (lines.length === 1 || displayMathFenceMarker(lines.at(-1)) === opener))
}

function fenceMarker(line) {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  return match ? { marker: match[1][0], length: match[1].length, closing: /^[ \t]*$/.test(match[2]) } : null
}

function toggleFence(current, incoming) {
  if (!current) return incoming
  if (incoming && incoming.marker === current.marker && incoming.length >= current.length && incoming.closing) return null
  return current
}

function sourceLines(source, start = 0, end = source.length) {
  const lines = []
  let cursor = start
  while (cursor < end) {
    let newline = cursor
    while (newline < end && source[newline] !== "\n" && source[newline] !== "\r") newline += 1
    let lineEnd = newline
    if (newline < end) lineEnd += source[newline] === "\r" && source[newline + 1] === "\n" ? 2 : 1
    lines.push({ start: cursor, end: lineEnd, text: source.slice(cursor, newline) })
    cursor = lineEnd
  }
  return lines
}

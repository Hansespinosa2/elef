import { parseDocumentLinkAt } from "./document_links.js"

// Math delimiter semantics shared by the reader and editor projections.
// Offsets index UTF-16 source. Markdown context (code, images, escapes) is
// excluded by scanMathSource; renderer rules call mathSourceAt from their
// existing Markdown parser context instead.
export interface MathSource {
  start: number
  end: number
  interior: string
  open: string
  close: string
  display: boolean
}

export function sourceIsEscaped(source: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

// Search within the parser's current Markdown content.
export function findMathClosingDelimiter(source: string, close: string, from: number): number {
  for (let end = source.indexOf(close, from); end >= 0; end = source.indexOf(close, end + close.length)) {
    if (!sourceIsEscaped(source, end) && (close !== "$" || source[end + 1] !== "$" && source[end - 1] !== "$")) {
      return end
    }
  }
  return -1
}

// The reader's existing rule: an unescaped matching delimiter closes;
// a single dollar surrounded by another dollar cannot close inline math.
export function mathSourceAt(source: string, start = 0): MathSource | null {
  if (sourceIsEscaped(source, start)) return null
  const bracket = source[start] === "\\" && (source[start + 1] === "(" || source[start + 1] === "[")
  if (!bracket && source[start] !== "$") return null
  const open = bracket ? source.slice(start, start + 2) : source[start + 1] === "$" ? "$$" : "$"
  const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open
  const display = open === "$$" || open === "\\["
  if (open === "$" && /\s/.test(source[start + 1] || "")) return null
  const end = findMathClosingDelimiter(source, close, start + open.length)
  if (end < 0) return null
  const interior = source.slice(start + open.length, end)
  if (open === "$" && (!interior || /\s$/.test(interior))) return null
  return { start, end: end + close.length, interior, open, close, display }
}

function markdownCodeFenceMarker(line: string): string | null {
  const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  const marker = fence?.[2]
  return marker && !(marker[0] === "`" && fence?.[3]?.includes("`")) ? marker : null
}

function markdownCodeFenceCloses(line: string, marker: string): boolean {
  const rest = line.replace(/^ {0,3}/, "")
  let count = 0
  while (count < rest.length && rest[count] === marker[0]) count++
  return count >= marker.length && /^[ \t\r]*$/.test(rest.slice(count))
}

export function mathCodeFenceAtLine(
  line: string,
  fence: string | null,
  followsBlank: boolean,
  remainingSource: () => string
): string | null {
  if (fence) return markdownCodeFenceCloses(line, fence) ? null : fence
  const marker = markdownCodeFenceMarker(line)
  if (!marker) return null
  // Bare tildes within an expression can be TeX spacing. Treat them as
  // code when a matching fence appears before an explicit math closer.
  if (followsBlank || marker[0] === "`" || line.slice(marker.length).trim()) return marker

  const boundary = new RegExp(`^[ \\t>]*(~{${marker.length},}[ \\t]*|\\$\\$.*)$`, "m").exec(remainingSource())
  return boundary?.[1]?.startsWith("~") ? marker : null
}

export function displayMathDelimiterOnLine(line: string, inCodeFence: boolean): number {
  if (inCodeFence && line.trimEnd() !== "$$") return -1
  return findMathClosingDelimiter(line, "$$", 0)
}

export function scanMathSource(source: string, { inline = false } = {}): MathSource[] {
  const matches: MathSource[] = []
  let index = 0
  while (index < source.length) {
    if (!inline && (index === 0 || source[index - 1] === "\n")) {
      const lineEnd = source.indexOf("\n", index)
      const line = source.slice(index, lineEnd < 0 ? source.length : lineEnd)
      const marker = markdownCodeFenceMarker(line)
      if (marker) {
        index = lineEnd < 0 ? source.length : lineEnd + 1
        while (index < source.length) {
          const nextEnd = source.indexOf("\n", index)
          const closed = markdownCodeFenceCloses(source.slice(index, nextEnd < 0 ? source.length : nextEnd), marker)
          index = nextEnd < 0 ? source.length : nextEnd + 1
          if (closed) break
        }
        continue
      }
      if (/^( {4}|\t)/.test(line)) {
        index = lineEnd < 0 ? source.length : lineEnd + 1
        continue
      }
    }
    if (source[index] === "`") {
      const run = /^`+/.exec(source.slice(index))?.[0] ?? "`"
      let close = index + run.length
      while ((close = source.indexOf(run, close)) >= 0) {
        if (source[close - 1] !== "`" && source[close + run.length] !== "`") break
        close += run.length
      }
      index = close < 0 ? index + run.length : close + run.length
      continue
    }
    if (source[index] === "<") {
      const autolink = /^<(?:[a-z][a-z\d+.-]{1,31}:[^<>\s]*|[^<>\s@]+@[a-z\d][a-z\d.-]*)>/i.exec(source.slice(index))
      if (autolink) {
        index += autolink[0].length
        continue
      }
    }
    const documentLink = source[index] === "[" ? parseDocumentLinkAt(source, index) : null
    if (documentLink) {
      index = documentLink.end
      continue
    }
    const image = source[index] === "!" ? /^!\[(?:\\.|[^\]])*\]\((?:\\.|[^)])*\)/.exec(source.slice(index)) : null
    if (image) { index += image[0].length; continue }
    // Link destinations are metadata; math in a link's label remains prose.
    if (source.startsWith("](", index)) {
      let depth = 1
      index += 2
      while (index < source.length && depth > 0) {
        if (source[index] === "\\") { index += 2; continue }
        if (source[index] === "(") depth += 1
        if (source[index] === ")") depth -= 1
        index += 1
      }
      continue
    }
    const math = mathSourceAt(source, index)
    if (math) { matches.push(math); index = math.end; continue }
    index += source[index] === "\\" ? 2 : 1
  }
  return matches
}

// When a paragraph already opened display math, a bare dollar fence on the
// next line closes that span instead of interrupting the paragraph.
export function closesParagraphDisplayMath(paragraph: string): boolean {
  if (!paragraph.includes("$$")) return false
  const source = paragraph + "\n$$"
  return scanMathSource(source, { inline: true }).some(math => math.open === "$$" && math.end === source.length)
}

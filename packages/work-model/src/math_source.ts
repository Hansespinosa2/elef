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
  let end = start + open.length
  while ((end = source.indexOf(close, end)) >= 0) {
    if (!sourceIsEscaped(source, end) && (close !== "$" || source[end + 1] !== "$" && source[end - 1] !== "$")) break
    end += close.length
  }
  if (end < 0) return null
  const interior = source.slice(start + open.length, end)
  if (open === "$" && (!interior || /\s$/.test(interior))) return null
  return { start, end: end + close.length, interior, open, close, display }
}

export function scanMathSource(source: string): MathSource[] {
  const matches: MathSource[] = []
  let index = 0
  while (index < source.length) {
    if (index === 0 || source[index - 1] === "\n") {
      const lineEnd = source.indexOf("\n", index)
      const line = source.slice(index, lineEnd < 0 ? source.length : lineEnd)
      const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
      const marker = fence?.[2]
      if (marker && !(marker[0] === "`" && fence?.[3]?.includes("`"))) {
        const closer = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t\\r]*$`)
        index = lineEnd < 0 ? source.length : lineEnd + 1
        while (index < source.length) {
          const nextEnd = source.indexOf("\n", index)
          const closed = closer.test(source.slice(index, nextEnd < 0 ? source.length : nextEnd))
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

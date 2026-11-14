// A code span needs a delimiter longer than any backtick run in its text.
// Padding protects literal edge backticks and preserves paired edge spaces.
export function markdownWrapMarkers(text: string, marker: "*" | "`"): { open: string; close: string } {
  if (marker === "*") return { open: marker, close: marker }
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  const ticks = "`".repeat(longest + 1)
  const padding = text.startsWith("`") || text.endsWith("`") ||
    (text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "") ? " " : ""
  return { open: ticks + padding, close: padding + ticks }
}

// Keep emphasis delimiters adjacent to content and wrap separate paragraphs
// separately: inline Markdown cannot cross an empty line.
export function wrapMarkdownText(text: string, marker: "*" | "`"): { text: string; from: number; to: number } {
  let result = ""
  let first = -1
  let last = -1
  // Fenced blocks and table rows have structural delimiters that cannot be
  // wrapped as inline content without changing their meaning.
  if (/^[ \t]*(?:`{3,}|~{3,}|\||(?:-{3,}|={3,})[ \t]*$)/m.test(text)) return { text, from: 0, to: text.length }
  for (const part of text.split(/(\n)/)) {
    if (!part || part === "\n") { result += part; continue }
    // Leave block markers outside the inline formatting.
    const prefix = part.match(/^(?:(?:[ \t]*>[ \t]*)|(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*[ \t]*(?:#{1,6}[ \t]+)?/)?.[0] ?? ""
    const remainder = part.slice(prefix.length)
    const leading = prefix + (marker === "*" ? (remainder.match(/^\s*/)?.[0] ?? "") : "")
    const rest = part.slice(leading.length)
    const closingHeading = /#{1,6}[ \t]+$/.test(prefix) ? (rest.match(/[ \t]+#+[ \t]*$/)?.[0] ?? "") : ""
    const withoutClosing = rest.slice(0, rest.length - closingHeading.length)
    const trailing = (marker === "*" ? (withoutClosing.match(/\s*$/)?.[0] ?? "") : "") + closingHeading
    const content = rest.slice(0, rest.length - trailing.length)
    if (!content) { result += part; continue }
    const { open, close } = markdownWrapMarkers(content, marker)
    result += leading + open
    if (first < 0) first = result.length
    result += content
    last = result.length
    result += close + trailing
  }
  return { text: result, from: first < 0 ? 0 : first, to: last < 0 ? result.length : last }
}

/// <reference path="./types/markdown-it.d.ts" />
import MarkdownIt from "markdown-it"
import { sourceLines } from "./style_vocab.js"
import { scanMathSource } from "./math_source.js"

export interface TableSourceCell {
  readonly from: number
  readonly to: number
  readonly alignment: "left" | "center" | "right"
}

export interface TableSourceRow {
  readonly from: number
  readonly to: number
  readonly header: boolean
  readonly cells: readonly TableSourceCell[]
}

export interface TableSource {
  readonly from: number
  readonly to: number
  readonly delimiter: { readonly from: number; readonly to: number }
  readonly rows: readonly TableSourceRow[]
}

const markdown = new MarkdownIt({ html: false })

// markdown-it decides whether a table exists. This scanner only attaches
// original UTF-16 source positions to its cells (including CRLF). Its pipe
// escaping follows markdown-it's table rule, including pipes inside code.
function cells(source: string, from: number, to: number): Array<{ from: number; to: number }> {
  while (from < to && /\s/.test(source[from] ?? "")) from++
  while (to > from && /\s/.test(source[to - 1] ?? "")) to--
  if (source[from] === "|") from++
  if (source[to - 1] === "|" && source[to - 2] !== "\\") to--
  const result: Array<{ from: number; to: number }> = []
  let start = from
  for (let index = from; index <= to; index++) {
    if (index !== to && (source[index] !== "|" || source[index - 1] === "\\")) continue
    let left = start
    let right = index
    while (left < right && /\s/.test(source[left] ?? "")) left++
    while (right > left && /\s/.test(source[right - 1] ?? "")) right--
    result.push({ from: left, to: right })
    start = index + 1
  }
  return result
}

export function tableSourceProjection(source: string): readonly TableSource[] {
  const lines = sourceLines(source)
  const tables: TableSource[] = []
  const math = scanMathSource(source)
  for (const token of markdown.parse(source, {})) {
    if (token.type !== "table_open" || token.level !== 0 || !token.map) continue
    const firstIndex = token.map[0]
    const endIndex = token.map[1]
    if (firstIndex === undefined || endIndex === undefined) continue
    const first = lines[firstIndex]
    const separator = lines[firstIndex + 1]
    const last = lines[endIndex - 1]
    if (!first || !separator || !last) continue
    if (math.some(span => span.start < first.start && span.end > first.start)) continue
    // Nested containers need their own prefix annotations. Never mistake
    // a quote/list prefix for cell text in the top-level projection.
    if (/^\s*>/.test(first.text) || /^\s*[-+*]\s/.test(first.text)) continue
    const alignmentCells = cells(source, separator.start, separator.start + separator.text.length)
    const alignments = alignmentCells.map(({ from, to }): TableSourceCell["alignment"] => {
      const value = source.slice(from, to)
      return value.endsWith(":") ? value.startsWith(":") ? "center" : "right" : "left"
    })
    const rows: TableSourceRow[] = []
    for (let index = firstIndex; index < endIndex; index++) {
      if (index === firstIndex + 1) continue
      const line = lines[index]
      if (!line) continue
      const rowCells = cells(source, line.start, line.start + line.text.length).slice(0, alignments.length)
      // Missing trailing cells are valid Markdown, and have a real zero-
      // length insertion position. They must remain editable in the grid.
      while (rowCells.length < alignments.length) rowCells.push({ from: line.start + line.text.length, to: line.start + line.text.length })
      rows.push({ from: line.start, to: line.start + line.text.length, header: index === firstIndex,
        cells: rowCells.map((cell, column) => ({ ...cell, alignment: alignments[column] ?? "left" })) })
    }
    tables.push({ from: first.start, to: last.start + last.text.length,
      delimiter: { from: separator.start, to: separator.start + separator.text.length }, rows })
  }
  return tables
}

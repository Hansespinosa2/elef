// WxH table dimensions for the `/table` assist trigger.
//
// `/table` alone keeps the registry's fixed 2x2 grid. `/table 5x2` draws a
// 5-column grid with a header row plus 2 body rows, so the inserted Markdown
// always renders (a header plus delimiter is required). Dimensions are
// columns-first, matching spreadsheet "WxH" convention. Anything outside
// 1..12 per side (or not of the form `NxM`) falls back to the default grid
// instead of erroring, so typing never dead-ends.

export const TABLE_DIMENSION_MIN = 1
export const TABLE_DIMENSION_MAX = 12

export interface TableDimensions {
  cols: number
  rows: number
}

// Parse the text after a `/table` trigger (`5x2`, ` 3X4 `) into dimensions.
// Returns null when the text is absent or malformed, which means the caller
// should use the registry default instead of failing the insert.
export function parseTableDimensions(text: string | null | undefined): TableDimensions | null {
  if (text == null) return null
  const match = text.match(/^\s*(\d+)\s*[xX]\s*(\d+)\s*$/)
  if (!match) return null
  const cols = Number.parseInt(match[1] ?? "", 10)
  const rows = Number.parseInt(match[2] ?? "", 10)
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null
  if (cols < TABLE_DIMENSION_MIN || cols > TABLE_DIMENSION_MAX) return null
  if (rows < TABLE_DIMENSION_MIN || rows > TABLE_DIMENSION_MAX) return null
  return { cols, rows }
}

// Parse the text before the caret into an assist query: the `/` or `:`
// prefix, the trigger text, the caret-relative start, and any trailing text
// after the trigger (table dimensions). A `:` directive with trailing text
// never matches, keeping directive parsing byte-identical; only `/`
// triggers may carry arguments.
export interface AssistQuery {
  prefix: string
  text: string
  start: number
  rest: string
}

export function parseAssistQuery(beforeCaret: string): AssistQuery | null {
  const match = beforeCaret.match(/([/:])([a-z0-9-]*)([ \t]+[^\n]*)?$/i)
  if (!match) return null
  const rest = match[3] ?? ""
  if ((match[1] ?? "") === ":" && rest !== "") return null
  const triggerStart = match.index ?? 0
  const previousCharacter = beforeCaret[triggerStart - 1]
  if (previousCharacter === ":" || previousCharacter === "/" || previousCharacter === "\\") return null
  return {
    prefix: match[1] ?? "",
    text: (match[2] ?? "").toLowerCase(),
    start: triggerStart,
    rest
  }
}

// Build a Markdown table body for the dimensions, using the same
// `${position:label}` stop syntax (and Column/Value labels) as the
// registry default so the existing stop expansion applies unchanged.
// Header stops are 1..cols; body stops continue the numbering.
export function tableGridBody(cols: number, rows: number): string {
  const clampedCols = Math.min(Math.max(Math.floor(cols), TABLE_DIMENSION_MIN), TABLE_DIMENSION_MAX)
  const clampedRows = Math.min(Math.max(Math.floor(rows), TABLE_DIMENSION_MIN), TABLE_DIMENSION_MAX)
  let position = 0
  const header = Array.from({ length: clampedCols }, (_, index) => {
    position += 1
    return `\${${position}:Column ${index + 1}}`
  })
  const delimiter = Array.from({ length: clampedCols }, () => "---")
  const body: string[] = []
  for (let row = 0; row < clampedRows; row += 1) {
    const cells = Array.from({ length: clampedCols }, () => {
      position += 1
      return `\${${position}:Value ${position - clampedCols}}`
    })
    body.push(`| ${cells.join(" | ")} |`)
  }
  return [`| ${header.join(" | ")} |`, `| ${delimiter.join(" | ")} |`, ...body].join("\n")
}

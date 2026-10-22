// Grid-aware caret support for Markdown tables. A table renders as one
// contenteditable shell, so engine line motion preserves source-character
// columns instead of grid columns, delimiter rows (|---|---|) have no
// rendered cells at all, and the linear source-to-visible mapper cannot see
// cell boundaries. These helpers map offsets to (row, column, intra-cell)
// so motion, delimiter-skipping, and DOM placement all agree.
import { visibleBlockText } from "./projection_input.js"

interface TableCell {
  start: number
  length: number
}

export interface TableCellPosition {
  lineIndex: number
  // Order among the table's non-delimiter rows (header first, then body);
  // -1 when the offset sits in a delimiter row.
  dataRowIndex: number
  cellIndex: number
  intra: number
  cellStart: number
  cellLength: number
}

function splitRowCells(rowText: string, rowStart: number): TableCell[] {
  const cells: TableCell[] = []
  let cellStart = -1
  let index = 0
  while (index <= rowText.length) {
    const char = rowText[index]
    if ((char === "|" && rowText[index - 1] !== "\\") || index === rowText.length) {
      // A zero-length tail (row ends with a pipe) is a terminator, not a
      // navigable column; an unterminated tail is real content.
      if (cellStart >= 0 && (index > cellStart || index < rowText.length)) {
        cells.push({ start: rowStart + cellStart, length: index - cellStart })
      }
      cellStart = index + 1
    } else if (cellStart < 0 && index < rowText.length) {
      cellStart = index
    }
    index += 1
  }
  return cells
}

export function isTableRow(text: string): boolean {
  return /^\s*\|/.test(text) && text.indexOf("|", 1) >= 0
}

function isDelimiterRow(text: string): boolean {
  const trimmed = text.trim()
  if (!/^\|/.test(trimmed)) return false
  const cells = splitRowCells(text, 0)
  return cells.length > 0 && cells.every((cell) => /^[\s:|-]*-[:\s|-]*$/.test(text.slice(cell.start, cell.start + cell.length)))
}

function splitLines(value: string): Array<{ text: string; start: number }> {
  const lines: Array<{ text: string; start: number }> = []
  let start = 0
  for (const line of value.split("\n")) {
    lines.push({ text: line, start })
    start += line.length + 1
  }
  return lines
}

function lineAt(lines: Array<{ text: string; start: number }>, offset: number): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as { text: string; start: number }
    if (offset <= line.start + line.text.length) return index
  }
  return lines.length - 1
}

function cellsOf(lines: Array<{ text: string; start: number }>, lineIndex: number): TableCell[] {
  const line = lines[lineIndex]
  if (!line) return []
  return splitRowCells(line.text, line.start)
}

function dataRowIndexOf(lines: Array<{ text: string; start: number }>, lineIndex: number): number {
  // Count non-delimiter rows back to the table start (first table line
  // above, stopping at a non-table line or the document start).
  let tableStart = lineIndex
  while (tableStart > 0) {
    const above = lines[tableStart - 1]
    if (!above || !isTableRow(above.text)) break
    tableStart -= 1
  }
  let dataRowIndex = -1
  for (let index = tableStart; index <= lineIndex; index += 1) {
    const line = lines[index] as { text: string; start: number }
    if (isDelimiterRow(line.text)) {
      if (index === lineIndex) return -1
      continue
    }
    dataRowIndex += 1
  }
  return dataRowIndex
}

// Offsets on pipes and edges belong to the cell on the left; Vim lands on
// the last character when the target is shorter, not past it.
export function tableCellAt(value: string, offset: number): TableCellPosition | null {
  const lines = splitLines(value)
  const lineIndex = lineAt(lines, offset)
  const line = lines[lineIndex]
  if (!line || offset < line.start || !isTableRow(line.text)) return null
  const cells = cellsOf(lines, lineIndex)
  if (cells.length === 0) return null
  let cellIndex = cells.length - 1
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index] as TableCell
    if (offset <= cell.start + cell.length) {
      cellIndex = index
      break
    }
  }
  const cell = cells[cellIndex] as TableCell
  return {
    lineIndex,
    dataRowIndex: dataRowIndexOf(lines, lineIndex),
    cellIndex,
    intra: Math.max(0, Math.min(offset - cell.start, Math.max(0, cell.length - 1))),
    cellStart: cell.start,
    cellLength: cell.length,
  }
}

// Delimiter rows (|---|---|) have no rendered cells: a head that lands in
// one has nowhere visible to go, so the visible caret freezes while the
// engine moves on. Step through to the next real row in the direction of
// motion; the column adjuster below then lands the same grid column.
export function skipTableDelimiterRow(value: string, headBefore: number, newHead: number): number {
  const lines = splitLines(value)
  const originIndex = lineAt(lines, headBefore)
  const originLine = lines[originIndex]
  if (!originLine || !isTableRow(originLine.text)) return newHead
  const direction = newHead >= headBefore ? 1 : -1
  let index = lineAt(lines, newHead)
  const first = index
  let guard = lines.length + 1
  while (guard-- > 0) {
    const line = lines[index]
    if (!line || !isDelimiterRow(line.text)) break
    index += direction
    if (index < 0 || index >= lines.length) return newHead
  }
  if (index === first) return newHead
  const landed = lines[index]
  if (!landed) return newHead
  return landed.start
}

export interface TableGridCell {
  text: string
  length: number
}

// Source spans of one table run: the rendered grid of a block's first
// table aligns row-for-row with the source's first run of table lines
// (adjacent tables merge; blank-line-separated tables are separate
// blocks). Delimiter rows have no rendered cells and are skipped.
function firstTableDataRows(value: string): TableCell[][] {
  const lines = splitLines(value)
  const rows: TableCell[][] = []
  let inRun = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || !isTableRow(line.text)) {
      if (inRun) break
      continue
    }
    inRun = true
    if (isDelimiterRow(line.text)) continue
    rows.push(cellsOf(lines, index))
  }
  return rows
}

function tableCellSource(value: string, dataRowIndex: number, cellIndex: number): TableCell | null {
  const row = firstTableDataRows(value)[dataRowIndex]
  const cell = row?.[cellIndex]
  return cell ?? null
}

// Inverse of tableVisibleOffset for the capture layers (native caret and
// typing translation): a DOM-visible offset back to a source offset via
// the rendered grid. Shared cell edges pin forward to the next cell's
// content start, matching the placement walker's forward attach, so a
// motion that lands on a cell re-captures the same cell instead of
// drifting a row; declines (null) on any
// structural surprise, including formatted cells, so callers keep the
// legacy map.
export function tableSourceOffset(value: string, grid: TableGridCell[][], domVisible: number): number | null {
  if (domVisible < 0) return null
  let preceding = 0
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex] ?? []
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const rendered = row[cellIndex] as TableGridCell
      const span = tableCellSource(value, rowIndex, cellIndex)
      if (!span) return null
      const sourceCell = normalizeCellText(value.slice(span.start, span.start + span.length))
      if (normalizeCellText(rendered.text) !== sourceCell.trim()) return null
      const leading = sourceCell.length - sourceCell.trimStart().length
      const end = preceding + rendered.length
      if (domVisible < end) {
        const intraRendered = domVisible - preceding
        return span.start + leading + Math.max(0, Math.min(intraRendered, rendered.length))
      }
      preceding = end
    }
  }
  return null
}

function normalizeCellText(text: string): string {
  return text.replace(/\u00a0/g, " ")
}

// Grid-aware visible offset for the DOM placement layer: the linear
// source-to-visible map cannot see cell boundaries (delimiter rows occupy
// source space with zero rendered cells), so it lands j/k motion in the
// wrong rendered cell. Recompute from the rendered grid instead: the
// visible offset is the rendered text before the target cell plus the
// intra-cell offset adjusted for padding the renderer trims.
// Declines (null) unless the rendered cell is the plain trimmed source
// cell — formatted cells fall back to the legacy linear map.
export function tableVisibleOffset(value: string, offset: number, grid: TableGridCell[][]): number | null {
  const position = tableCellAt(value, offset)
  if (!position || position.dataRowIndex < 0) return null
  const row = grid[position.dataRowIndex]
  const cell = row?.[position.cellIndex]
  if (!cell) return null
  const sourceCell = normalizeCellText(value.slice(position.cellStart, position.cellStart + position.cellLength))
  if (normalizeCellText(cell.text) !== sourceCell.trim()) return null
  const leading = sourceCell.length - sourceCell.trimStart().length
  let preceding = 0
  for (let rowIndex = 0; rowIndex < position.dataRowIndex; rowIndex += 1) {
    for (const earlier of grid[rowIndex] ?? []) preceding += earlier.length
  }
  for (let cellIndex = 0; cellIndex < position.cellIndex; cellIndex += 1) {
    preceding += row?.[cellIndex]?.length ?? 0
  }
  return preceding + Math.max(0, Math.min(position.intra - leading, cell.length))
}

// Rendered grid of a block's first table in DOM order, or null when the
// block holds no table. Lengths use visibleBlockText, the same measure
// the placement walkers use, so grid offsets index the DOM-visible text.
export function tableGridForBlock(block: Element): TableGridCell[][] | null {
  // Host and test doubles sometimes pass block-shaped stubs without DOM
  // traversal; decline those the same way as a table-free block.
  if (!block || typeof block.querySelector !== "function") return null
  const table = block.querySelector("table")
  if (!table) return null
  const grid = [...table.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll("td, th")].map((cell) => {
      const text = visibleBlockText(cell)
      return { text, length: text.length }
    }),
  )
  return grid.length > 0 ? grid : null
}

// Source-to-DOM placement through a block's rendered table, or null when
// the block holds no positively identified table. Shared by the document
// and presentation placement layers so both recompute the same way.
export function tableVisibleForSource(source: string, block: Element, relative: number): number | null {
  const grid = tableGridForBlock(block)
  if (!grid) return null
  return tableVisibleOffset(source, relative, grid)
}

// DOM-to-source capture through a block's rendered table, or null when
// the block holds no positively identified table. Shared by the capture
// and typing-translation layers so edits resolve the same cell the
// caret shows.
export function tableRelativeForVisible(source: string, block: Element, domVisible: number): number | null {
  const grid = tableGridForBlock(block)
  if (!grid) return null
  return tableSourceOffset(source, grid, domVisible)
}

export function adjustTableColumnMove(value: string, originHead: number, newHead: number): number {
  if (originHead === newHead) return newHead
  const origin = tableCellAt(value, originHead)
  const target = tableCellAt(value, newHead)
  if (!origin || !target || target.dataRowIndex < 0) return newHead
  const lines = splitLines(value)
  const targetLine = lines[target.lineIndex]
  if (!targetLine) return newHead
  const targetCells = cellsOf(lines, target.lineIndex)
  if (targetCells.length === 0) return newHead
  const column = Math.min(origin.cellIndex, targetCells.length - 1)
  const cell = targetCells[column] as TableCell
  return cell.start + Math.min(origin.intra, Math.max(0, cell.length - 1))
}

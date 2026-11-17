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

export type FragmentedTableSourceResult =
  | { kind: "mapped"; offset: number }
  | { kind: "not-table" }
  | { kind: "unmappable" }

// Map a DOM point, rather than a linear visible offset: every continuation
// repeats the header, and cell edges (especially empty cells) are ambiguous
// in a concatenated string. Offsets are relative to the supplied source.
// The caller must supply every fragment of the same block, in document order,
// and must not use an unverified fallback when the result is unmappable.
export function fragmentedTableSourceOffset(
  source: string, fragments: readonly Element[], node: Node, offset: number,
): FragmentedTableSourceResult {
  const notTable: FragmentedTableSourceResult = { kind: "not-table" }
  const invalid: FragmentedTableSourceResult = { kind: "unmappable" }
  if (fragments.length === 0) return notTable
  const tables = fragments.map(fragment => {
    const found: Element[] = [...fragment.querySelectorAll("table")]
    if (fragment.matches("table")) found.unshift(fragment)
    return found
  })
  if (tables.every(found => found.length === 0)) return notTable
  if (tables.some(found => found.length !== 1) || new Set(fragments).size !== fragments.length) return invalid

  // The accepted source is one pipe-delimited table with a single header
  // and delimiter. Reject other Markdown rather than guessing at its spans.
  const lines = splitLines(source)
  if (lines.at(-1)?.text === "") lines.pop()
  if (lines.length < 2 || lines.some(line => !isTableRow(line.text)) ||
      !isDelimiterRow(lines[1]?.text ?? "") ||
      lines.some((line, index) => index !== 1 && isDelimiterRow(line.text))) return invalid
  const rows = lines.filter((_line, index) => index !== 1).map(line => splitRowCells(line.text, line.start))
  const header = rows[0]
  if (!header?.length || rows.some(row => row.length !== header.length)) return invalid

  let bodyRow = 1
  let result: number | null = null
  const ids = fragments.map(fragment => fragment.getAttribute("data-editor-block-id"))
  if (ids.some(id => id !== ids[0])) return invalid
  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index]
    const table = tables[index]?.[0]
    if (!fragment || !table) return invalid
    const previous = fragments[index - 1]
    if (previous) {
      const position = previous.compareDocumentPosition(fragment)
      if ((position & 1) !== 0 || (position & 4) === 0) return invalid
    }
    const sections = [...table.children]
    if (sections.length !== 2 || sections[0]?.tagName !== "THEAD" || sections[1]?.tagName !== "TBODY") return invalid
    const heads = [...sections[0].children]
    const body = [...sections[1].children]
    if (heads.length !== 1 || heads[0]?.tagName !== "TR" || body.some(row => row.tagName !== "TR")) return invalid
    const renderedRows = [heads[0], ...body]
    for (let rowIndex = 0; rowIndex < renderedRows.length; rowIndex += 1) {
      const row = renderedRows[rowIndex]
      const sourceRow = rowIndex === 0 ? header : rows[bodyRow++]
      if (!row || !sourceRow) return invalid
      const cells = [...row.children]
      if (cells.length !== sourceRow.length) return invalid
      for (let column = 0; column < cells.length; column += 1) {
        const cell = cells[column]
        const span = sourceRow[column]
        if (!cell || !span || cell.tagName !== (rowIndex === 0 ? "TH" : "TD") ||
            cell.hasAttribute("rowspan") || cell.hasAttribute("colspan")) return invalid
        const raw = source.slice(span.start, span.start + span.length)
        const rendered = cell.textContent ?? ""
        // Accept a single, exactly verified inline wrapper. Its text maps
        // inside the delimiters, so edits leave the Markdown intact.
        if ([...cell.childNodes].some(child => child.nodeType !== 3)) {
          const child = cell.children.length === 1 && cell.childNodes.length === 1 ? cell.children[0] : null
          const markers: Record<string, string[]> = { STRONG: ["**", "__"], EM: ["*", "_"], DEL: ["~~"], CODE: ["`"] }
          const marker = child && !child.children.length
            ? (markers[child.tagName] ?? []).find(mark => raw.trim() === mark + rendered + mark)
            : undefined
          if (!child || !marker) return invalid
          if (cell === node || cell.contains(node)) {
            if (!Number.isInteger(offset) || offset < 0) return invalid
            let local: number
            if (node === cell) {
              if (offset > 1) return invalid
              local = offset === 0 ? 0 : rendered.length
            } else if (node === child) {
              if (offset > child.childNodes.length) return invalid
              local = [...child.childNodes].slice(0, offset).reduce((sum, part) => sum + (part.textContent ?? "").length, 0)
            } else {
              local = 0
              let found = false
              for (const part of child.childNodes) {
                if (part === node) {
                  if (offset > (part.textContent ?? "").length) return invalid
                  local += offset
                  found = true
                  break
                }
                local += (part.textContent ?? "").length
              }
              if (!found) return invalid
            }
            result = span.start + raw.indexOf(marker) + marker.length + local
          }
          continue
        }
        const normalizedRaw = normalizeCellText(raw)
        const normalizedRendered = normalizeCellText(rendered)
        const contentStart = normalizedRendered.trim() === ""
          ? normalizedRaw.length - normalizedRendered.length
          : normalizedRaw.indexOf(normalizedRendered)
        if (/[\r\n]/.test(rendered) ||
            contentStart < 0 || normalizedRaw.slice(0, contentStart).trim() !== "" ||
            normalizedRaw.slice(contentStart, contentStart + rendered.length) !== normalizedRendered ||
            normalizedRaw.slice(contentStart + rendered.length).trim() !== "") return invalid
        if (cell === node || cell.contains(node)) {
          if (!Number.isInteger(offset) || offset < 0) return invalid
          let local = 0
          if (cell === node) {
            if (offset > cell.childNodes.length) return invalid
            for (const child of [...cell.childNodes].slice(0, offset)) local += (child.textContent ?? "").length
          } else {
            let found = false
            for (const child of cell.childNodes) {
              const length = (child.textContent ?? "").length
              if (child === node) {
                if (offset > length) return invalid
                local += offset
                found = true
                break
              }
              local += length
            }
            if (!found) return invalid
          }
          result = span.start + contentStart + local
        }
      }
    }
  }
  if (bodyRow !== rows.length || result === null) return invalid
  return { kind: "mapped", offset: result }
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

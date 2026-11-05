import { StateEffect, StateField } from "@codemirror/state"
import type { Transaction } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"
import type { Range } from "@codemirror/state"
import { tableSourceProjection } from "@elef/work-model/table-source"
import { livePreviewField, livePreviewMode, continuousPlainTableEdit, localMathEdit, localInlineMathLineEdit } from "@elef/client/editor"

export const continuousTableGeometryChanged = StateEffect.define<void>()

class EmptyCell extends WidgetType {
  constructor(readonly position: number, readonly width: string) { super() }
  override eq(other: EmptyCell): boolean { return this.position === other.position && this.width === other.width }
  override toDOM(view: EditorView): HTMLElement {
    const cell = document.createElement("span")
    cell.className = "cm-continuous-cell"
    cell.style.width = this.width
    cell.textContent = "\u200b"
    cell.addEventListener("mousedown", event => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.position } })
      view.focus()
    })
    return cell
  }
  override ignoreEvent(): boolean { return true }
}

type TableRange = { from: number; to: number }
interface CellRange { from: number; to: number; tableFrom: number }
interface TableDecorations { cells: DecorationSet; syntax: DecorationSet; ranges: readonly TableRange[]; emptyCells: readonly number[]; editableCells: readonly CellRange[] }

function buildTables(source: string, measure: (markdown: string) => readonly number[]): TableDecorations {
  const decorations: Range<Decoration>[] = []
  const cellMarks: Range<Decoration>[] = []
  const tables = tableSourceProjection(source)
  const emptyCells: number[] = []
  const editableCells: CellRange[] = []
  for (const table of tables) {
    const columns = table.rows[0]?.cells.length ?? 0
    if (!columns) continue
    const fractions = measure(source.slice(table.from, table.to))
    decorations.push(Decoration.line({ class: "cm-continuous-table-delimiter" }).range(table.delimiter.from))
    if (table.delimiter.to > table.delimiter.from) {
      decorations.push(Decoration.mark({ class: "cm-continuous-table-syntax" }).range(table.delimiter.from, table.delimiter.to))
    }
    for (const row of table.rows) {
      decorations.push(Decoration.line({ class: `cm-continuous-table-row${row.header ? " cm-continuous-table-header" : ""}` }).range(row.from))
      let cursor = row.from
      for (const [column, cell] of row.cells.entries()) {
        const width = `${(fractions[column] ?? 1 / columns) * 100}%`
        const alignment = cell.alignment === "default" ? (row.header ? "center" : "start") : cell.alignment
        if (cell.from > cursor) decorations.push(Decoration.mark({ class: "cm-continuous-table-syntax" }).range(cursor, cell.from))
        if (cell.from === cell.to) {
          emptyCells.push(cell.from)
          decorations.push(Decoration.widget({ widget: new EmptyCell(cell.from, width), side: 1 }).range(cell.from))
        } else {
          // Keep the editable source range through the cell's surrounding
          // whitespace. The display range is trimmed, but a caret after a
          // newly typed space is still inside the same cell.
          const leftPipe = source.lastIndexOf("|", cell.from - 1)
          const rightPipe = source.indexOf("|", cell.to)
          editableCells.push({ from: leftPipe >= row.from ? leftPipe + 1 : row.from,
            to: rightPipe >= 0 && rightPipe < row.to ? rightPipe : row.to, tableFrom: table.from })
          // Inclusive boundaries keep a replacement widget inside the cell
          // even when it occupies the entire source range, including compact
          // tables that have no whitespace around their delimiters.
          cellMarks.push(Decoration.mark({ class: "cm-continuous-cell", inclusive: true, attributes: {
            style: `width:${width};text-align:${alignment}`,
          } }).range(cell.from, cell.to))
        }
        cursor = cell.to
      }
      if (row.to > cursor) decorations.push(Decoration.mark({ class: "cm-continuous-table-syntax" }).range(cursor, row.to))
    }
  }
  return { cells: Decoration.set(cellMarks, true), syntax: Decoration.set(decorations, true),
    ranges: tables.map(({ from, to }) => ({ from, to })), emptyCells, editableCells }
}

// Ordinary text within an existing plain cell cannot alter the table shape.
// Rich or structural edits take the full path. Empty-cell widgets store their
// own source position, so a later empty cell also requires a full rebuild.
function localTableChange(value: TableDecorations, transaction: Transaction): TableRange | null {
  let count = 0
  let result: TableRange | null = null
  transaction.changes.iterChangedRanges((from, to, newFrom, newTo) => {
    count++
    if (count !== 1 || value.emptyCells.some(position => position >= from)) return
    const cell = value.editableCells.find(candidate => from >= candidate.from && to <= candidate.to)
    if (!cell) return
    const table = value.ranges.find(candidate => candidate.from === cell.tableFrom)
    if (!table) return
    const oldLine = transaction.startState.doc.lineAt(from)
    const newLine = transaction.newDoc.lineAt(newFrom)
    if (to > oldLine.to || newTo > newLine.to) return
    // Reject inline markup anywhere in the row: it may own decorations that
    // extend across the edited cell. Pipe separators and plain text are safe.
    if (![oldLine.text, newLine.text].every(line => /^[\p{L}\p{N} \t|,.!?-]*$/u.test(line))) return
    const original = transaction.startState.sliceDoc(cell.from, cell.to)
    const inserted = transaction.newDoc.sliceString(newFrom, newTo)
    const next = original.slice(0, from - cell.from) + inserted + original.slice(to - cell.from)
    const plain = (text: string) => text.trim().length > 0 && /^[\p{L}\p{N} \t,.!?]*$/u.test(text)
    if (!plain(original) || !plain(next)) return
    result = table
  })
  return count === 1 ? result : null
}

function shiftedRanges(set: DecorationSet, length: number, offset: number): Array<Range<Decoration>> {
  const ranges: Array<Range<Decoration>> = []
  set.between(0, length, (from, to, value) => { ranges.push(value.range(from + offset, to + offset)) })
  return ranges
}

function updateLocalTable(value: TableDecorations, transaction: Transaction, table: TableRange,
  measure: (markdown: string) => readonly number[]): TableDecorations | null {
  const changes = transaction.changes
  const from = changes.mapPos(table.from, -1)
  const to = changes.mapPos(table.to, 1)
  const source = transaction.newDoc.sliceString(from, to)
  const fresh = buildTables(source, measure)
  if (fresh.ranges.length !== 1 || fresh.ranges[0]?.from !== 0 || fresh.ranges[0]?.to !== source.length) return null
  const replace = (old: DecorationSet, updated: DecorationSet) => old.map(changes).update({
    filterFrom: from, filterTo: to,
    filter: (start, end) => start < from || end > to,
    add: shiftedRanges(updated, source.length, from), sort: true,
  })
  return {
    cells: replace(value.cells, fresh.cells),
    syntax: replace(value.syntax, fresh.syntax),
    ranges: value.ranges.map(range => range === table ? { from, to }
      : { from: changes.mapPos(range.from, -1), to: changes.mapPos(range.to, 1) }),
    editableCells: [
      ...value.editableCells.filter(cell => cell.tableFrom !== table.from).map(cell => ({
        from: changes.mapPos(cell.from, -1), to: changes.mapPos(cell.to, 1), tableFrom: changes.mapPos(cell.tableFrom, -1),
      })),
      ...fresh.editableCells.map(cell => ({ from: from + cell.from, to: from + cell.to, tableFrom: from + cell.tableFrom })),
    ],
    emptyCells: value.emptyCells,
  }
}

// A plain-text edit away from table-like lines cannot create or alter a
// Markdown table. Map existing decorations through it instead of reparsing
// all tables (and measuring them) for every prose keystroke. Ambiguous
// syntax, table cells, and empty-cell widget anchors take the full path.
function canMapTables(value: TableDecorations, transaction: Transaction): boolean {
  let safe = true
  const math = localMathEdit(transaction) || localInlineMathLineEdit(transaction)
  transaction.changes.iterChangedRanges((from, to, newFrom, newTo) => {
    if (!safe) return
    if (value.ranges.some(table => from <= table.to && to >= table.from) || value.emptyCells.some(position => position >= from)) { safe = false; return }
    const removed = transaction.startState.sliceDoc(from, to)
    const inserted = transaction.newDoc.sliceString(newFrom, newTo)
    if (!math && !/^[\p{L}\p{N} ,.!?]*$/u.test(removed + inserted)) { safe = false; return }
    for (const [doc, start, end] of [[transaction.startState.doc, from, to], [transaction.newDoc, newFrom, newTo]] as const) {
      // Only a plain line can take this path: changing a fence, delimiter,
      // or other structural line can affect a distant table. Math on an
      // adjacent line does not affect table recognition, but a pipe can
      // make this line part of a new table and needs the full parser.
      const current = doc.lineAt(start)
      if (end > current.to || (!math && !/^[\p{L}\p{N} ,.!?]*$/u.test(current.text))) { safe = false; return }
      const first = Math.max(1, doc.lineAt(start).number - 1)
      const last = Math.min(doc.lines, doc.lineAt(end).number + 1)
      for (let line = first; line <= last; line++) {
        if (/\|/.test(doc.line(line).text)) { safe = false; return }
      }
    }
  })
  return safe
}

// Only source changes rebuild table annotations. Selection, Vim state, and
// history remain owned by the same EditorView that edits ordinary prose.
export function createContinuousTables(measure: (markdown: string) => readonly number[]) {
  return StateField.define<{ enabled: boolean } & TableDecorations>({
    create: state => {
      const enabled = state.field(livePreviewField, false)?.enabled ?? true
      return enabled ? { enabled, ...buildTables(state.doc.toString(), measure) }
        : { enabled, cells: Decoration.none, syntax: Decoration.none, ranges: [], emptyCells: [], editableCells: [] }
    },
  update(value, transaction) {
    let enabled = value.enabled
    for (const effect of transaction.effects) if (effect.is(livePreviewMode)) enabled = effect.value
    if (!enabled) return { enabled, cells: Decoration.none, syntax: Decoration.none, ranges: [], emptyCells: [], editableCells: [] }
    if (enabled !== value.enabled || transaction.effects.some(effect => effect.is(continuousTableGeometryChanged))) {
      return { enabled, ...buildTables(transaction.newDoc.toString(), measure) }
    }
    if (!transaction.docChanged) return value
    const table = localTableChange(value, transaction)
    if (table) {
      const updated = updateLocalTable(value, transaction, table, measure)
      if (updated) return { enabled, ...updated }
    }
    if (!canMapTables(value, transaction)) return { enabled, ...buildTables(transaction.newDoc.toString(), measure) }
    return { enabled, cells: value.cells.map(transaction.changes), syntax: value.syntax.map(transaction.changes),
      ranges: value.ranges.map(range => ({ from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1) })),
      editableCells: value.editableCells.map(cell => ({ from: transaction.changes.mapPos(cell.from, -1),
        to: transaction.changes.mapPos(cell.to, 1), tableFrom: transaction.changes.mapPos(cell.tableFrom, -1) })),
      emptyCells: value.emptyCells }
  },
  provide: field => [EditorView.outerDecorations.from(field, value => value.cells),
    EditorView.decorations.from(field, value => value.syntax)],
})
}

export function continuousTableEditSupport(field: ReturnType<typeof createContinuousTables>) {
  return continuousPlainTableEdit.of(transaction => {
    const value = transaction.startState.field(field, false)
    return Boolean(value?.enabled && localTableChange(value, transaction))
  })
}

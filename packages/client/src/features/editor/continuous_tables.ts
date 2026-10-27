import { StateEffect, StateField } from "@codemirror/state"
import type { Transaction } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"
import type { Range } from "@codemirror/state"
import { tableSourceProjection } from "@elef/work-model/table-source"
import { livePreviewField, livePreviewMode } from "@elef/client/editor"

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
interface TableDecorations { cells: DecorationSet; syntax: DecorationSet; ranges: readonly TableRange[]; emptyCells: readonly number[] }

function buildTables(source: string, measure: (markdown: string) => readonly number[]): TableDecorations {
  const decorations: Range<Decoration>[] = []
  const cellMarks: Range<Decoration>[] = []
  const tables = tableSourceProjection(source)
  const emptyCells: number[] = []
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
          cellMarks.push(Decoration.mark({ class: "cm-continuous-cell", attributes: {
            style: `width:${width};text-align:${alignment}`,
          } }).range(cell.from, cell.to))
        }
        cursor = cell.to
      }
      if (row.to > cursor) decorations.push(Decoration.mark({ class: "cm-continuous-table-syntax" }).range(cursor, row.to))
    }
  }
  return { cells: Decoration.set(cellMarks, true), syntax: Decoration.set(decorations, true),
    ranges: tables.map(({ from, to }) => ({ from, to })), emptyCells }
}

// A plain-text edit away from table-like lines cannot create or alter a
// Markdown table. Map existing decorations through it instead of reparsing
// all tables (and measuring them) for every prose keystroke. Ambiguous
// syntax, table cells, and empty-cell widget anchors take the full path.
function canMapTables(value: TableDecorations, transaction: Transaction): boolean {
  let safe = true
  transaction.changes.iterChangedRanges((from, to, newFrom, newTo) => {
    if (!safe) return
    if (value.ranges.some(table => from <= table.to && to >= table.from) || value.emptyCells.some(position => position >= from)) { safe = false; return }
    const removed = transaction.startState.sliceDoc(from, to)
    const inserted = transaction.newDoc.sliceString(newFrom, newTo)
    if (!/^[\p{L}\p{N} ,.!?]*$/u.test(removed + inserted)) { safe = false; return }
    for (const [doc, start, end] of [[transaction.startState.doc, from, to], [transaction.newDoc, newFrom, newTo]] as const) {
      const first = Math.max(1, doc.lineAt(start).number - 1)
      const last = Math.min(doc.lines, doc.lineAt(end).number + 1)
      for (let line = first; line <= last; line++) {
        if (/[|:`~$\\>*+_\-]/.test(doc.line(line).text)) { safe = false; return }
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
        : { enabled, cells: Decoration.none, syntax: Decoration.none, ranges: [], emptyCells: [] }
    },
  update(value, transaction) {
    let enabled = value.enabled
    for (const effect of transaction.effects) if (effect.is(livePreviewMode)) enabled = effect.value
    if (!enabled) return { enabled, cells: Decoration.none, syntax: Decoration.none, ranges: [], emptyCells: [] }
    if (enabled !== value.enabled || transaction.effects.some(effect => effect.is(continuousTableGeometryChanged))) {
      return { enabled, ...buildTables(transaction.newDoc.toString(), measure) }
    }
    if (!transaction.docChanged) return value
    if (!canMapTables(value, transaction)) return { enabled, ...buildTables(transaction.newDoc.toString(), measure) }
    return { enabled, cells: value.cells.map(transaction.changes), syntax: value.syntax.map(transaction.changes),
      ranges: value.ranges.map(range => ({ from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1) })),
      emptyCells: value.emptyCells }
  },
  provide: field => [EditorView.outerDecorations.from(field, value => value.cells),
    EditorView.decorations.from(field, value => value.syntax)],
})
}

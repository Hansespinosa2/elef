import { StateField } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"
import type { Range } from "@codemirror/state"
import { tableSourceProjection } from "@elef/work-model/table-source"
import { livePreviewMode } from "@elef/client/editor"

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

function buildTables(source: string, measure: (markdown: string) => readonly number[]): { cells: DecorationSet; syntax: DecorationSet } {
  const decorations: Range<Decoration>[] = []
  const cellMarks: Range<Decoration>[] = []
  for (const table of tableSourceProjection(source)) {
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
  return { cells: Decoration.set(cellMarks, true), syntax: Decoration.set(decorations, true) }
}

// Only source changes rebuild table annotations. Selection, Vim state, and
// history remain owned by the same EditorView that edits ordinary prose.
export function createContinuousTables(measure: (markdown: string) => readonly number[]) {
  return StateField.define<{ enabled: boolean; cells: DecorationSet; syntax: DecorationSet }>({
  create: state => ({ enabled: true, ...buildTables(state.doc.toString(), measure) }),
  update(value, transaction) {
    let enabled = value.enabled
    for (const effect of transaction.effects) if (effect.is(livePreviewMode)) enabled = effect.value
    if (!enabled) return { enabled, cells: Decoration.none, syntax: Decoration.none }
    return transaction.docChanged || enabled !== value.enabled
      ? { enabled, ...buildTables(transaction.newDoc.toString(), measure) } : value
  },
  provide: field => [EditorView.outerDecorations.from(field, value => value.cells),
    EditorView.decorations.from(field, value => value.syntax)],
})
}

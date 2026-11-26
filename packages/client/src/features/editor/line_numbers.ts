import type { EditorState, Extension } from "@codemirror/state"
import { type EditorView, GutterMarker, gutter, lineNumbers } from "@codemirror/view"

export function formatLineNumber(number: number, state: EditorState, mode: string): string {
  if (mode !== "relative") return String(number)

  return String(Math.abs(activeLine(state) - number))
}

class LineNumberMarker extends GutterMarker {
  constructor(readonly label: string) {
    super()
  }

  eq(other: LineNumberMarker): boolean {
    return this.label === other.label
  }

  toDOM(view: EditorView): Text {
    return view.dom.ownerDocument.createTextNode(this.label)
  }
}

function activeLine(state: EditorState): number {
  return state.doc.lineAt(state.selection.main.head).number
}

function spacer(state: EditorState): LineNumberMarker {
  return new LineNumberMarker("9".repeat(String(state.doc.lines).length))
}

export function editorLineNumbers(mode: string): Extension {
  if (mode !== "relative") return lineNumbers()

  return gutter({
    class: "cm-lineNumbers",
    lineMarker(view, block) {
      const number = view.state.doc.lineAt(block.from).number
      return new LineNumberMarker(formatLineNumber(number, view.state, mode))
    },
    lineMarkerChange(update) {
      return update.selectionSet && activeLine(update.startState) !== activeLine(update.state)
    },
    initialSpacer: (view) => spacer(view.state),
    updateSpacer(marker, update) {
      return String(update.startState.doc.lines).length === String(update.state.doc.lines).length
        ? marker
        : spacer(update.state)
    }
  })
}

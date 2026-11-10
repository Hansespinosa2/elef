import { EditorSelection, EditorState, Prec } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

// Only selected text is wrapped. Ordinary Markdown typing (including list
// markers and code fences) is left to CodeMirror's normal input handling.
export function wrapMarkdownSelection(state: EditorState, marker: string) {
  if (state.readOnly || (marker !== "*" && marker !== "`") || state.selection.ranges.some(range => range.empty)) return null
  return state.update(state.changeByRange(range => ({
    changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }],
    range: EditorSelection.range(range.anchor + marker.length, range.head + marker.length)
  })), { userEvent: "input.type", scrollIntoView: true })
}

export const markdownSelectionWrapping = Prec.highest(EditorView.inputHandler.of((view, from, to, text) => {
  if (view.compositionStarted || from !== view.state.selection.main.from || to !== view.state.selection.main.to) return false
  const transaction = wrapMarkdownSelection(view.state, text)
  if (!transaction) return false
  view.dispatch(transaction)
  return true
}))

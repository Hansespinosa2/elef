import { EditorSelection, EditorState, Prec } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { markdownWrapMarkers } from "../../session/markdown_wrap.js"

// Only selected text is wrapped. Ordinary Markdown typing (including list
// markers and code fences) is left to CodeMirror's normal input handling.
export function wrapMarkdownSelection(state: EditorState, marker: string) {
  if (state.readOnly || (marker !== "*" && marker !== "`") || state.selection.ranges.some(range => range.empty)) return null
  return state.update(state.changeByRange(range => {
    const { open, close } = markdownWrapMarkers(state.sliceDoc(range.from, range.to), marker)
    return {
      changes: [{ from: range.from, insert: open }, { from: range.to, insert: close }],
      range: EditorSelection.range(range.anchor + open.length, range.head + open.length)
    }
  }), { userEvent: "input.type", scrollIntoView: true })
}

export const markdownSelectionWrapping = Prec.highest(EditorView.inputHandler.of((view, from, to, text) => {
  if (view.compositionStarted || from !== view.state.selection.main.from || to !== view.state.selection.main.to) return false
  const transaction = wrapMarkdownSelection(view.state, text)
  if (!transaction) return false
  view.dispatch(transaction)
  return true
}))

import { EditorSelection, EditorState, Prec } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { wrapMarkdownText } from "../../session/markdown_wrap.js"

// Only selected text is wrapped. Ordinary Markdown typing (including list
// markers and code fences) is left to CodeMirror's normal input handling.
export function wrapMarkdownSelection(state: EditorState, marker: string) {
  if (state.readOnly || (marker !== "*" && marker !== "`") || state.selection.ranges.some(range => range.empty)) return null
  return state.update(state.changeByRange(range => {
    const wrapped = wrapMarkdownText(state.sliceDoc(range.from, range.to), marker)
    const forward = range.anchor <= range.head
    return {
      changes: { from: range.from, to: range.to, insert: wrapped.text },
      range: EditorSelection.range(range.from + (forward ? wrapped.from : wrapped.to), range.from + (forward ? wrapped.to : wrapped.from))
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

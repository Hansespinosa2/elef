import { Prec } from "@codemirror/state"
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown"
import { syntaxTree } from "@codemirror/language"
import { EditorView, keymap } from "@codemirror/view"
import { getCM } from "@replit/codemirror-vim"
import { scanMathSource } from "@elef/work-model/math-source"
import { livePreviewField } from "@elef/client/editor"

function canEdit(view: EditorView): boolean {
  if (!view.state.field(livePreviewField, false)?.enabled || view.composing) return false
  const vimState = getCM(view)?.state?.vim as { insertMode?: boolean } | null | undefined
  return !vimState || Boolean(vimState.insertMode)
}

function inCode(view: EditorView, position: number): boolean {
  let node = syntaxTree(view.state).resolveInner(position, -1)
  while (node) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return true
    if (!node.parent) break
    node = node.parent
  }
  return false
}

function inMath(view: EditorView, position: number): boolean {
  return scanMathSource(view.state.doc.toString()).some(span => span.start < position && position < span.end)
}

function enter(view: EditorView): boolean {
  if (!canEdit(view) || view.state.selection.ranges.length !== 1) return false
  const selection = view.state.selection.main
  const line = view.state.doc.lineAt(selection.head)
  if (inCode(view, selection.head) || inMath(view, selection.head)) return false
  // Exit a top-level empty list or quote into a new paragraph. CodeMirror's
  // Markdown continuation otherwise removes the marker but leaves a soft
  // break, which the rendered document joins back into the preceding block.
  if (selection.empty && selection.head === line.to && /^(?:[-+*]|\d+[.)]|>)[ \t]*$/.test(line.text)) {
    const insert = line.from > 0 ? view.state.lineBreak : ""
    view.dispatch({ changes: { from: line.from, to: line.to, insert },
      selection: { anchor: line.from + (insert ? 1 : 0) }, scrollIntoView: true, userEvent: "input" })
    return true
  }
  if (insertNewlineContinueMarkup(view)) return true
  // Let incomplete display delimiters continue on their own source line.
  if (/^[ \t]*(?:\$\$|\\\[)[ \t]*$/.test(line.text)) return false
  const separator = view.state.lineBreak + view.state.lineBreak
  view.dispatch({ ...view.state.replaceSelection(separator), scrollIntoView: true, userEvent: "input" })
  return true
}

function joinParagraph(view: EditorView, backwards: boolean): boolean {
  if (!canEdit(view) || view.state.selection.ranges.length !== 1) return false
  const selection = view.state.selection.main
  if (!selection.empty) return false
  const line = view.state.doc.lineAt(selection.head)
  if (backwards ? selection.head !== line.from : selection.head !== line.to) return false
  const from = backwards ? selection.head - 2 : selection.head
  const to = backwards ? selection.head : selection.head + 2
  if (from < 0 || to > view.state.doc.length || view.state.doc.sliceString(from, to) !== "\n\n") return false
  if (inCode(view, selection.head) || inMath(view, selection.head)) return false
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, scrollIntoView: true,
    userEvent: backwards ? "delete.backward" : "delete.forward" })
  return true
}

// Vim's normal-mode handler keeps its keys. In insert and ordinary mode the
// visual surface treats a paragraph boundary as one visible editing action.
export const continuousDocumentKeys = Prec.highest(keymap.of([
  { key: "Enter", run: enter },
  { key: "Backspace", run: view => joinParagraph(view, true) },
  { key: "Delete", run: view => joinParagraph(view, false) },
]))

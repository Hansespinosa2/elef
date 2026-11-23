import { EditorState, Text } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

// A contenteditable can deliver multiline native input as one text node
// containing literal LF characters. In a CRLF or CR document, CodeMirror
// then keeps those characters inside a single logical line. Split them into
// normal document lines in the same transaction, so positions and history
// remain intact and serialization uses the document's chosen separator.
const normalizePastedLineEndings = EditorView.clipboardInputFilter.of((text, state) => {
  const normalized = text.replace(/\r\n|\r/g, "\n")
  return state.lineBreak === "\n" ? normalized : normalized.replace(/\n/g, state.lineBreak)
})

const normalizeNativeChanges = EditorState.transactionFilter.of(transaction => {
  if (transaction.startState.lineBreak === "\n" || !transaction.isUserEvent("input")) return transaction

  const corrections: Array<{ from: number; to: number; insert: Text }> = []
  transaction.changes.iterChanges((_from, _to, from, to, inserted) => {
    const lines = inserted.toJSON()
    if (!lines.some(line => line.includes("\n"))) return
    corrections.push({ from, to, insert: Text.of(lines.flatMap(line => line.split("\n"))) })
  })
  if (!corrections.length) return transaction
  return [transaction, { changes: corrections, selection: transaction.newSelection, sequential: true }]
})

// Clipboard normalization must happen before CodeMirror decides whether to
// distribute separate lines across multiple selections.
export const nativeInputLineEndings = [normalizePastedLineEndings, normalizeNativeChanges]

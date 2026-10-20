import assert from "node:assert/strict"
import test from "node:test"
import { EditorState } from "@codemirror/state"
import { history, undo } from "@codemirror/commands"
import { createDocumentState } from "@elef/editor-runtime/test-internals"

test("opening another work creates a fresh undo boundary", () => {
  let state = createDocumentState(EditorState, "work A", [history()]).state
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: "A edited" } }).state
  assert.equal(undo({ state, dispatch: transaction => { state = transaction.state } }), true)
  assert.equal(state.sliceDoc(), "work A")
  state = createDocumentState(EditorState, "work B", [history()]).state
  assert.equal(undo({ state, dispatch: transaction => { state = transaction.state } }), false)
  assert.equal(state.sliceDoc(), "work B")
  state = state.update({ changes: { from: 6, insert: " edited" } }).state
  assert.equal(undo({ state, dispatch: transaction => { state = transaction.state } }), true)
  assert.equal(state.sliceDoc(), "work B")
})

test("each loaded work retains its own CRLF, CR, or LF bytes through edits", () => {
  for (const ending of ["\r\n", "\r", "\n"]) {
    const source = ["# Work", "", "Body", ""].join(ending)
    const document = createDocumentState(EditorState, source, [history()])
    assert.equal(document.lineSeparator, ending)
    assert.equal(document.state.sliceDoc(), source)
    const edited = document.state.update({ changes: { from: 2, to: 6, insert: "Edited" } }).state
    assert.equal(edited.sliceDoc(), source.replace("Work", "Edited"))
  }
})

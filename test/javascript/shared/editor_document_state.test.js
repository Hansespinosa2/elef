import assert from "node:assert/strict"
import test from "node:test"
import { EditorState } from "@codemirror/state"
import { history, undo } from "@codemirror/commands"
import { createDocumentState } from "../../../app/javascript/lib/editor_document_state.js"

test("opening another deck creates a fresh undo boundary", () => {
  let state = createDocumentState(EditorState, "deck A", [history()]).state
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: "A edited" } }).state
  assert.equal(undo({ state, dispatch: transaction => { state = transaction.state } }), true)
  assert.equal(state.sliceDoc(), "deck A")
  state = createDocumentState(EditorState, "deck B", [history()]).state
  assert.equal(undo({ state, dispatch: transaction => { state = transaction.state } }), false)
  assert.equal(state.sliceDoc(), "deck B")
  state = state.update({ changes: { from: 6, insert: " edited" } }).state
  assert.equal(undo({ state, dispatch: transaction => { state = transaction.state } }), true)
  assert.equal(state.sliceDoc(), "deck B")
})

test("each loaded deck retains its own CRLF, CR, or LF bytes through edits", () => {
  for (const ending of ["\r\n", "\r", "\n"]) {
    const source = ["# Deck", "", "Body", ""].join(ending)
    const document = createDocumentState(EditorState, source, [history()])
    assert.equal(document.lineSeparator, ending)
    assert.equal(document.state.sliceDoc(), source)
    const edited = document.state.update({ changes: { from: 2, to: 6, insert: "Edited" } }).state
    assert.equal(edited.sliceDoc(), source.replace("Deck", "Edited"))
  }
})

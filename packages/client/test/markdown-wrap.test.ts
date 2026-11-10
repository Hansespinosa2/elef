import { test } from "node:test"
import assert from "node:assert/strict"
import { EditorSelection, EditorState } from "@codemirror/state"
import { history, undo } from "@codemirror/commands"
import { wrapMarkdownSelection } from "../src/features/editor/markdown_wrap.js"

test("wrapping keeps a backwards selection, permits bold, and undoes", () => {
  let state = EditorState.create({ doc: "hello world", selection: { anchor: 11, head: 6 }, extensions: history() })
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), "hello *world*")
  assert.deepEqual([state.selection.main.anchor, state.selection.main.head], [12, 7])
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), "hello **world**")
  assert.equal(undo({ state, dispatch(tr) { state = tr.state } }), true)
  assert.equal(state.doc.toString(), "hello world")
})

test("backticks wrap selected text while a caret and other input stay ordinary", () => {
  let state = EditorState.create({ doc: "some code", selection: { anchor: 5, head: 9 } })
  state = wrapMarkdownSelection(state, "`")!.state
  assert.equal(state.doc.toString(), "some `code`")
  assert.deepEqual([state.selection.main.from, state.selection.main.to], [6, 10])
  assert.equal(wrapMarkdownSelection(state, "x"), null)
  state = state.update({ selection: EditorSelection.cursor(0) }).state
  assert.equal(wrapMarkdownSelection(state, "*"), null)
})

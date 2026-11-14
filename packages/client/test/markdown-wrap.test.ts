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

test("backtick selections get a longer padded code delimiter", () => {
  let state = EditorState.create({ doc: "`inner`", selection: { anchor: 0, head: 7 } })
  state = wrapMarkdownSelection(state, "`")!.state
  assert.equal(state.doc.toString(), "`` `inner` ``")
  assert.equal(state.sliceDoc(state.selection.main.from, state.selection.main.to), "`inner`")
})

test("emphasis leaves surrounding spaces outside the markers", () => {
  let state = EditorState.create({ doc: "  hello  ", selection: { anchor: 0, head: 9 } })
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), "  *hello*  ")
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), "  **hello**  ")
})

test("paragraphs receive separate inline delimiters", () => {
  for (const marker of ["*", "`"]) {
    let state = EditorState.create({ doc: "one\n\ntwo", selection: { anchor: 0, head: 8 } })
    state = wrapMarkdownSelection(state, marker)!.state
    assert.equal(state.doc.toString(), `${marker}one${marker}\n\n${marker}two${marker}`)
    if (marker === "*") {
      state = wrapMarkdownSelection(state, marker)!.state
      assert.equal(state.doc.toString(), "**one**\n\n**two**")
    }
  }
})

test("wrapping preserves heading and list structure and leaves fenced code intact", () => {
  const source = "one\n\n# heading #\n- item\n- # nested"
  let state = EditorState.create({ doc: source, selection: { anchor: 0, head: source.length } })
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), "*one*\n\n# *heading* #\n- *item*\n- # *nested*")
  const fenced = "before\n\n```js\nconst x = 1\n```"
  state = EditorState.create({ doc: fenced, selection: { anchor: 0, head: fenced.length } })
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), fenced)
  const table = "| Name | Value |\n| --- | --- |\n| a | b |"
  state = EditorState.create({ doc: table, selection: { anchor: 0, head: table.length } })
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), table)
  const tableWithoutEdges = "Name | Value\n--- | ---\na | b"
  state = EditorState.create({ doc: tableWithoutEdges, selection: { anchor: 0, head: tableWithoutEdges.length } })
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), tableWithoutEdges)
  const setext = "Heading\n---"
  state = EditorState.create({ doc: setext, selection: { anchor: 0, head: setext.length } })
  state = wrapMarkdownSelection(state, "*")!.state
  assert.equal(state.doc.toString(), setext)
})

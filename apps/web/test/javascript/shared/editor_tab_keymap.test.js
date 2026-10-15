import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { EditorState } from "@codemirror/state"
import { editorTabBinding } from "@elef/editor-runtime/test-internals"

function run(command, doc, selection = { anchor: 0 }) {
  let state = EditorState.create({ doc, selection })
  const handled = command({ state, dispatch: (transaction) => { state = transaction.state } })
  return { handled, state }
}

test("the source editor binds Tab to indent and Shift+Tab to outdent", () => {
  assert.equal(editorTabBinding.key, "Tab")
  assert.equal(typeof editorTabBinding.run, "function")
  assert.equal(typeof editorTabBinding.shift, "function")
})

test("Tab on a list item indents it into a subitem", () => {
  const { handled, state } = run(editorTabBinding.run, "- item\n- other", { anchor: 3 })
  assert.equal(handled, true)
  assert.equal(state.sliceDoc(), "  - item\n- other")
})

test("Shift+Tab outdents a subitem back to a top-level item", () => {
  const { handled, state } = run(editorTabBinding.shift, "  - item\n- other", { anchor: 5 })
  assert.equal(handled, true)
  assert.equal(state.sliceDoc(), "- item\n- other")
})

test("Tab on a plain line inserts indentation instead of moving focus", () => {
  const { handled, state } = run(editorTabBinding.run, "hello", { anchor: 5 })
  assert.equal(handled, true)
  assert.equal(state.sliceDoc(), "  hello")
})

test("Tab over a multi-line selection indents every touched line", () => {
  const { handled, state } = run(editorTabBinding.run, "- one\n- two", { anchor: 0, head: 11 })
  assert.equal(handled, true)
  assert.equal(state.sliceDoc(), "  - one\n  - two")
})

test("Shift+Tab on an unindented line still captures the key", () => {
  const { handled, state } = run(editorTabBinding.shift, "hello", { anchor: 5 })
  assert.equal(handled, true)
  assert.equal(state.sliceDoc(), "hello")
})

test("the shipped client editor wires the Tab keymap", async () => {
  const engine = await readFile(
    new URL("../../../../../packages/client/src/features/editor/engine.ts", import.meta.url),
    "utf8"
  )
  assert.match(engine, /from "\.\/tab_keymap\.js"/)
  assert.match(engine, /editorTabKeymap/)
})

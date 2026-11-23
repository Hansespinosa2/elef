import { test } from "node:test"
import assert from "node:assert/strict"
import { EditorSelection, EditorState, Text, Transaction } from "@codemirror/state"
import { isolateHistory } from "@codemirror/commands"
import { EditorView } from "@codemirror/view"
import { nativeInputLineEndings } from "../src/features/editor/native_input_line_endings.js"

test("multiline native input uses the document separator without changing selections or composition", () => {
  for (const separator of ["\r\n", "\r"]) {
    const state = EditorState.create({
      doc: `before${separator}after`,
      extensions: [EditorState.lineSeparator.of(separator), nativeInputLineEndings],
    })
    const transaction = state.update({
      changes: { from: 0, to: state.doc.length, insert: Text.of(["alpha\nbeta"]) },
      selection: EditorSelection.range(2, 8),
      userEvent: "input.type.compose",
      annotations: isolateHistory.of("before"),
    })
    assert.equal(transaction.state.sliceDoc(), `alpha${separator}beta`)
    assert.equal(transaction.state.doc.lines, 2)
    assert.equal(transaction.newSelection.main.anchor, 2)
    assert.equal(transaction.newSelection.main.head, 8)
    assert.equal(transaction.annotation(Transaction.userEvent), "input.type.compose")
    assert.equal(transaction.annotation(isolateHistory), "before")
  }
})

test("normalizing multiple input ranges retains both carets", () => {
  const state = EditorState.create({
    doc: "ab\r\ncd",
    extensions: [EditorState.lineSeparator.of("\r\n"), EditorState.allowMultipleSelections.of(true), nativeInputLineEndings],
  })
  const input = Text.of(["X\nY"])
  const selection = EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(10)])
  const transaction = state.update({ changes: [{ from: 1, insert: input }, { from: 4, insert: input }], selection, userEvent: "input.type" })
  assert.equal(transaction.state.sliceDoc(), "aX\r\nYb\r\ncX\r\nYd")
  assert.ok(transaction.newSelection.eq(selection))
})

test("programmatic mixed line endings are not rewritten as native input", () => {
  const state = EditorState.create({
    doc: "before\r\nafter",
    extensions: [EditorState.lineSeparator.of("\r\n"), nativeInputLineEndings],
  })
  const transaction = state.update({ changes: { from: 0, to: state.doc.length, insert: Text.of(["a\nb"]) } })
  assert.deepEqual(transaction.newDoc.toJSON(), ["a\nb"])
})

test("multiline clipboard input is split before distributing it among cursors", () => {
  for (const separator of ["\n", "\r\n", "\r"]) {
    const state = EditorState.create({
      doc: `first${separator}second`,
      extensions: [EditorState.lineSeparator.of(separator), nativeInputLineEndings],
    })
    for (const input of ["alpha\nbeta", "alpha\r\nbeta", "alpha\rbeta"]) {
      const filtered = state.facet(EditorView.clipboardInputFilter).reduce((text, filter) => filter(text, state), input)
      assert.deepEqual(state.toText(filtered).toJSON(), ["alpha", "beta"])
    }
  }
})

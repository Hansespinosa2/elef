import { test } from "node:test"
import assert from "node:assert/strict"
import { EditorSelection, EditorState } from "@codemirror/state"
import { createContinuousFlow } from "../src/features/editor/continuous_flow.js"

test("flow joins soft source lines without joining the next paragraph or fenced code", () => {
  const source = "First line\ncontinues here.\n\nSecond paragraph.\n\n```\nliteral\n\nlines\n```\n"
  const flow = createContinuousFlow({ paragraph: { before: 0, after: 18 }, code: { before: 20, after: 20 } })
  const state = EditorState.create({ doc: source, extensions: [flow] })
  const replacements: Array<[number, number]> = []
  state.field(flow).decorations.between(0, source.length, (from, to) => {
    if (from !== to) replacements.push([from, to])
  })
  const paragraphEnd = source.indexOf("\n\n")
  assert.ok(replacements.some(([from, to]) => from === source.indexOf("\n") && to === from + 1))
  assert.ok(replacements.some(([from, to]) => from === paragraphEnd + 1 && to === paragraphEnd + 2))
  assert.ok(replacements.every(([from, to]) => !(from <= paragraphEnd && to > paragraphEnd)),
    "a paragraph terminator must survive so CodeMirror can virtualize individual visual lines")
  const codeStart = source.indexOf("```")
  assert.ok(replacements.every(([from]) => from < codeStart))
  const moved = state.update({ selection: EditorSelection.cursor(3) }).state
  assert.equal(moved.field(flow), state.field(flow), "caret movement rebuilt the source projection")
})

import { test } from "node:test"
import assert from "node:assert/strict"
import { EditorSelection, EditorState } from "@codemirror/state"
import type { DecorationSet } from "@codemirror/view"
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

test("incremental plain prose and structural edits agree with a fresh flow projection", () => {
  const margins = { paragraph: { before: 0, after: 18 }, h1: { before: 0, after: 24 }, list: { before: 12, after: 12 } }
  const flow = createContinuousFlow(margins)
  let state = EditorState.create({ doc: "# Title\n\nA simple paragraph.\n\nAnother paragraph\n", extensions: [flow] })
  const snapshot = (set: DecorationSet, length: number) => {
    const result: unknown[] = []
    set.between(0, length, (from, to, decoration) => { result.push([from, to, decoration.spec.class, decoration.spec.widget?.constructor.name, decoration.spec.widget?.height]) })
    return result
  }
  for (const [find, remove, insert] of [["simple", "", "very "], ["Another", "Another", "1. item"], ["paragraph.", ".", "!"], ["item", "item", ""]] as const) {
    const start = state.doc.toString().indexOf(find)
    assert.ok(start >= 0)
    const from = start + (remove === "." ? "paragraph".length : 0)
    state = state.update({ changes: { from, to: from + remove.length, insert } }).state
    const freshFlow = createContinuousFlow(margins)
    const fresh = EditorState.create({ doc: state.doc, extensions: [freshFlow] })
    assert.deepEqual(snapshot(state.field(flow).decorations, state.doc.length), snapshot(fresh.field(freshFlow).decorations, state.doc.length))
  }
})

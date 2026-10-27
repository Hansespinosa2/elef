import { test } from "node:test"
import assert from "node:assert/strict"
import { EditorState } from "@codemirror/state"
import type { DecorationSet } from "@codemirror/view"
import { createContinuousTables } from "../src/features/editor/continuous_tables.js"

function ranges(set: DecorationSet, length: number) {
  const result: unknown[] = []
  set.between(0, length, (from, to, value) => { result.push([from, to, value.spec.class ?? "", value.spec.attributes ?? null]) })
  return result
}

test("prose edits map table ranges, while table and syntax edits recompute their projection", () => {
  const source = "| A | B |\n| - | - |\n| one | two |\n\nSeparate prose paragraph.\n\nLast paragraph\n"
  let measurements = 0
  const tables = createContinuousTables(() => { measurements++; return [0.5, 0.5] })
  let state = EditorState.create({ doc: source, extensions: [tables] })
  const initialMeasurements = measurements
  const edit = (from: number, to: number, insert: string, shouldMeasure: boolean) => {
    const before = measurements
    state = state.update({ changes: { from, to, insert } }).state
    assert.equal(measurements > before, shouldMeasure)
    const freshField = createContinuousTables(() => [0.5, 0.5])
    const fresh = EditorState.create({ doc: state.doc, extensions: [freshField] }).field(freshField)
    assert.deepEqual(ranges(state.field(tables).cells, state.doc.length), ranges(fresh.cells, state.doc.length))
    assert.deepEqual(ranges(state.field(tables).syntax, state.doc.length), ranges(fresh.syntax, state.doc.length))
  }
  assert.ok(initialMeasurements > 0)
  edit(source.indexOf("Separate") + 4, source.indexOf("Separate") + 4, " text", false)
  const cell = state.doc.toString().indexOf("one")
  edit(cell, cell + 3, "three", true)
  const last = state.doc.toString().indexOf("Last")
  edit(last, last, "|", true)
})

test("edits before an empty table cell rebuild its click anchor", () => {
  const source = "First paragraph\n\n| A | B |\n| - | - |\n| one | |\n"
  let measurements = 0
  const tables = createContinuousTables(() => { measurements++; return [0.5, 0.5] })
  const state = EditorState.create({ doc: source, extensions: [tables] })
  const before = measurements
  state.update({ changes: { from: 5, insert: " extra" } }).state.field(tables)
  assert.ok(measurements > before)
})

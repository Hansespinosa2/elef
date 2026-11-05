import { test } from "node:test"
import assert from "node:assert/strict"
import { EditorSelection, EditorState } from "@codemirror/state"
import type { DecorationSet } from "@codemirror/view"
import { markdown } from "@codemirror/lang-markdown"
import { createContinuousTables, continuousTableEditSupport } from "../src/features/editor/continuous_tables.js"
import { livePreviewField } from "@elef/client/editor"
import { createContinuousFlow } from "../src/features/editor/continuous_flow.js"

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

test("prose next to an equation maps tables without reparsing the document", () => {
  const source = "| A | B |\n| - | - |\n| one | two |\n\nText with $x^2$.\n"
  let measurements = 0
  const tables = createContinuousTables(() => { measurements++; return [0.5, 0.5] })
  let state = EditorState.create({ doc: source, extensions: [tables] })
  const before = measurements
  for (const insert of [" ", "new", " prose."]) {
    state = state.update({ changes: { from: state.doc.length, insert } }).state
    const freshField = createContinuousTables(() => [0.5, 0.5])
    const fresh = EditorState.create({ doc: state.doc, extensions: [freshField] }).field(freshField)
    assert.deepEqual(ranges(state.field(tables).cells, state.doc.length), ranges(fresh.cells, state.doc.length))
    assert.deepEqual(ranges(state.field(tables).syntax, state.doc.length), ranges(fresh.syntax, state.doc.length))
  }
  assert.equal(measurements, before, "an adjacent equation does not change table structure")
})

test("typing within a closed equation preserves distant table annotations", () => {
  const source = "| A | B |\n| - | - |\n| one | two |\n\nEquation $f(x) = x^{2}$.\n"
  let measurements = 0
  const tables = createContinuousTables(() => { measurements++; return [0.5, 0.5] })
  let state = EditorState.create({ doc: source, extensions: [tables] })
  const before = measurements
  for (const insert of [" + \\alpha", "_{i}"]) {
    const from = state.doc.toString().indexOf(" = x")
    state = state.update({ changes: { from, insert } }).state
    const freshField = createContinuousTables(() => [0.5, 0.5])
    const fresh = EditorState.create({ doc: state.doc, extensions: [freshField] }).field(freshField)
    assert.deepEqual(ranges(state.field(tables).cells, state.doc.length), ranges(fresh.cells, state.doc.length))
    assert.deepEqual(ranges(state.field(tables).syntax, state.doc.length), ranges(fresh.syntax, state.doc.length))
  }
  assert.equal(measurements, before)
})

test("plain cell typing updates only its table and agrees with fresh document projections", () => {
  const source = "# Notes\n\n| A | B |\n| - | - |\n| one | two |\n\n| Name | Value |\n| - | - |\n| queue worker | 210 ms |\n\nEquation $x^2$.\n"
  let measurements = 0
  const tables = createContinuousTables(() => { measurements++; return [0.5, 0.5] })
  const margins = { paragraph: { before: 0, after: 18 }, table: { before: 0, after: 0 } }
  const flow = createContinuousFlow(margins)
  let cursor = source.indexOf("queue worker") + "queue worker".length
  let state = EditorState.create({ doc: source, selection: EditorSelection.cursor(cursor),
    extensions: [markdown(), livePreviewField, tables, continuousTableEditSupport(tables), flow] })
  const widget = state.field(livePreviewField).dynamic.find(item => item.from === source.indexOf("$x"))!
    .inactive.find(item => item.value.spec.widget)?.value
  for (const insert of [" ", "fast", " worker"]) {
    const before = measurements
    state = state.update({ changes: { from: cursor, insert }, selection: EditorSelection.cursor(cursor + insert.length) }).state
    cursor += insert.length
    assert.equal(measurements - before, 1, "only the edited table is measured")
    const freshTables = createContinuousTables(() => [0.5, 0.5])
    const freshFlow = createContinuousFlow(margins)
    const fresh = EditorState.create({ doc: state.doc, selection: state.selection,
      extensions: [markdown(), livePreviewField, freshTables, continuousTableEditSupport(freshTables), freshFlow] })
    assert.deepEqual(ranges(state.field(tables).cells, state.doc.length), ranges(fresh.field(freshTables).cells, state.doc.length))
    assert.deepEqual(ranges(state.field(tables).syntax, state.doc.length), ranges(fresh.field(freshTables).syntax, state.doc.length))
    assert.deepEqual(ranges(state.field(flow).decorations, state.doc.length), ranges(fresh.field(freshFlow).decorations, state.doc.length))
    assert.deepEqual(ranges(state.field(livePreviewField).decorations, state.doc.length), ranges(fresh.field(livePreviewField).decorations, state.doc.length))
    const offset = state.doc.toString().indexOf("$x")
    assert.equal(state.field(livePreviewField).dynamic.find(item => item.from === offset)!
      .inactive.find(item => item.value.spec.widget)?.value, widget)
  }
})

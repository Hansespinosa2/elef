import { test } from "node:test"
import assert from "node:assert/strict"
import { EditorSelection, EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
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

test("table rows with short delimiter cells keep separate editable lines", () => {
  const source = "# Table\n\n| A | B |\n| - | - |\n| | alpha |\n"
  const flow = createContinuousFlow({ paragraph: { before: 0, after: 18 }, table: { before: 0, after: 0 } })
  const state = EditorState.create({ doc: source, extensions: [flow] })
  const tableStart = source.indexOf("| A")
  const tableEnd = source.indexOf("\n", source.indexOf("alpha"))
  const replacements: Array<[number, number]> = []
  state.field(flow).decorations.between(tableStart, tableEnd, (from, to) => {
    if (from >= tableStart && from < tableEnd && from !== to) replacements.push([from, to])
  })
  assert.ok(replacements.every(([from, to]) => !source.slice(from, to).includes("\n")))
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

test("aligned document blocks retain reader alignment through edits and paragraph splits", () => {
  const margins = { paragraph: { before: 0, after: 18 } }
  const flow = createContinuousFlow(margins)
  const source = ":::align{right}\n\nRight paragraph.\n\n:::align{center}\n\nCenter paragraph.\n"
  let state = EditorState.create({ doc: source, extensions: [markdown(), flow] })
  const snapshot = (set: DecorationSet, length: number) => {
    const found: unknown[] = []
    set.between(0, length, (from, to, decoration) => {
      found.push([from, to, decoration.spec.class, decoration.spec.widget?.constructor.name, decoration.spec.widget?.height])
    })
    return found
  }
  const initial = snapshot(state.field(flow).decorations, state.doc.length)
  assert.ok(initial.some((item: any) => item[2] === "cm-continuous-align-right"))
  assert.ok(initial.some((item: any) => item[2] === "cm-continuous-align-center"))
  for (const [marker, offset, insert] of [["Right paragraph.", 0, "New "], ["Center paragraph.", 17, "!"], ["Right paragraph.", 16, "\n\n"]] as const) {
    const from = state.doc.toString().indexOf(marker) + offset
    state = state.update({ changes: { from, insert } }).state
    const freshFlow = createContinuousFlow(margins)
    const fresh = EditorState.create({ doc: state.doc, extensions: [markdown(), freshFlow] })
    assert.deepEqual(snapshot(state.field(flow).decorations, state.doc.length), snapshot(fresh.field(freshFlow).decorations, state.doc.length))
  }
})

test("local equation edits keep the same reader flow as a fresh parse", () => {
  const margins = { paragraph: { before: 0, after: 18 }, h1: { before: 0, after: 24 } }
  const flow = createContinuousFlow(margins)
  let state = EditorState.create({ doc: "# Heading\n\nEquation $f(x) = x^{2}$.\n\nAfter.\n", extensions: [flow] })
  for (const insert of [" + \\alpha", "_{i}", " + 1"]) {
    const from = state.doc.toString().indexOf(" = x")
    state = state.update({ changes: { from, insert } }).state
    const freshFlow = createContinuousFlow(margins)
    const fresh = EditorState.create({ doc: state.doc, extensions: [freshFlow] })
    const snapshot = (set: DecorationSet) => {
      const found: unknown[] = []
      set.between(0, state.doc.length, (start, end, value) => { found.push([start, end, value.spec.class, value.spec.widget?.constructor.name, value.spec.widget?.height]) })
      return found
    }
    assert.deepEqual(snapshot(state.field(flow).decorations), snapshot(fresh.field(freshFlow).decorations))
  }
})

test("creating and removing inline math updates the plain-paragraph index", () => {
  const margins = { paragraph: { before: 0, after: 18 } }
  const flow = createContinuousFlow(margins)
  let state = EditorState.create({ doc: "Before.\n\nWrite here.\n\nAfter.\n", extensions: [markdown(), flow] })
  const position = state.doc.toString().indexOf("here") + "here".length
  for (const changes of [
    { from: position, insert: "$" },
    { from: position + 1, insert: "x$" },
    { from: position, to: position + 3, insert: "" },
  ]) {
    state = state.update({ changes }).state
    const freshFlow = createContinuousFlow(margins)
    const fresh = EditorState.create({ doc: state.doc, extensions: [markdown(), freshFlow] })
    assert.deepEqual(state.field(flow).plain, fresh.field(freshFlow).plain)
  }
})

test("a new paragraph at the end acquires the reader's spacing when text arrives", () => {
  const margins = { paragraph: { before: 0, after: 18 }, h1: { before: 0, after: 24 } }
  const flow = createContinuousFlow(margins)
  let state = EditorState.create({ doc: "# Heading\n\nEarlier paragraph.\n\n", extensions: [flow] })
  for (const insert of [" ", "A", " new paragraph."]) {
    state = state.update({ changes: { from: state.doc.length, insert } }).state
    const freshFlow = createContinuousFlow(margins)
    const fresh = EditorState.create({ doc: state.doc, extensions: [freshFlow] })
    const snapshot = (set: DecorationSet) => {
      const result: unknown[] = []
      set.between(0, state.doc.length, (from, to, decoration) => {
        result.push([from, to, decoration.spec.class, decoration.spec.widget?.constructor.name, decoration.spec.widget?.height])
      })
      return result
    }
    assert.deepEqual(snapshot(state.field(flow).decorations), snapshot(fresh.field(freshFlow).decorations))
  }
})

test("splitting and joining at a plain paragraph end preserves surrounding flow", () => {
  const margins = { paragraph: { before: 0, after: 18 }, h1: { before: 0, after: 24 } }
  const snapshot = (set: DecorationSet, length: number) => {
    const result: unknown[] = []
    set.between(0, length, (from, to, value) => { result.push([from, to, value.spec.class, value.spec.widget?.constructor.name, value.spec.widget?.height]) })
    return result
  }
  for (const suffix of ["\n\nNext paragraph.\n", "\n\n# Next heading\n", ""]) {
    const source = `# Heading\n\nPlain paragraph.${suffix}`
    const position = source.indexOf("Plain paragraph.") + "Plain paragraph.".length
    const flow = createContinuousFlow(margins)
    let state = EditorState.create({ doc: source, extensions: [markdown(), flow] })
    let oldWidget: unknown
    state.field(flow).decorations.between(0, position, (_from, _to, decoration) => { oldWidget ||= decoration.spec.widget })
    for (const changes of [{ from: position, insert: "\n\n" }, { from: position, to: position + 2 }]) {
      state = state.update({ changes }).state
      const freshFlow = createContinuousFlow(margins)
      const fresh = EditorState.create({ doc: state.doc, extensions: [markdown(), freshFlow] })
      assert.deepEqual(snapshot(state.field(flow).decorations, state.doc.length), snapshot(fresh.field(freshFlow).decorations, state.doc.length))
      assert.deepEqual(state.field(flow).plain, fresh.field(freshFlow).plain)
      let retained: unknown
      state.field(flow).decorations.between(0, position, (_from, _to, decoration) => { retained ||= decoration.spec.widget })
      assert.equal(retained, oldWidget, "untouched reader spacing should keep its widget")
    }
  }
})

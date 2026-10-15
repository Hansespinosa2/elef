import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { EditorSelection, EditorState } from "@codemirror/state"
import { history, historyField } from "@codemirror/commands"
import { sourceOffsetForVisibleOffset, visibleOffsetForSourceOffset } from "@elef/editor-runtime/test-internals"

// Exercise the shipped controller's mode transition without mounting a host.
// Browser/native input parity is a separate acceptance tier.
let source = await readFile(new URL("../../../../../packages/editor-runtime/dist/controllers/editor_controller.js", import.meta.url), "utf8")
source = source.replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\s*/gm, "")
const prelude = `
class Controller {}
const tags = { processingInstruction: {} }
const EditorView = { theme: () => [] }
const livePreviewMode = { of: value => ({ mode: value }) }
const foldEffect = { of: value => ({ fold: value }) }
const unfoldEffect = { of: value => ({ unfold: value }) }
const Vim = { handleKey() { throw new Error("Mode switch must not send Vim keys") } }
`
const { default: EditorController } = await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString("base64")}`)

function modeFixture(t, selection, visualCaret = null, source = "# Heading\n\nFirst **bold** passage.\n\nFinal.") {
  const frames = []
  const saved = Object.fromEntries(["requestAnimationFrame", "document", "window", "Element", "KeyboardEvent"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const projection = { flushPendingProjectionEdits() {}, captureCaret: () => visualCaret, restoreCaret() {} }
  const nativeSelection = { anchorNode: {}, anchorOffset: 0, focusNode: {}, focusOffset: 0 }
  class ElementStub { closest() { return projection } }
  class KeyboardEventStub {
    constructor(key) { this.key = key; this.type = "keydown"; this.target = new ElementStub() }
  }
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: callback => frames.push(callback) })
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: {} } })
  Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => nativeSelection } })
  Object.defineProperty(globalThis, "Element", { configurable: true, value: ElementStub })
  Object.defineProperty(globalThis, "KeyboardEvent", { configurable: true, value: KeyboardEventStub })
  t.after(() => {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  let state = EditorState.create({ doc: source, extensions: [history()], selection })
  state = state.update({ changes: { from: state.doc.length, insert: "!" }, userEvent: "input" }).state
  const dispatches = []
  const view = {
    state,
    dom: { contains: () => false },
    dispatch(spec) {
      dispatches.push(spec)
      if (spec.selection) this.state = this.state.update({ selection: spec.selection }).state
    },
    focus() { this.focused = true }
  }
  const vim = { state: { vim: { mode: "visual", visualMode: true, registerName: "a", macroModeState: { recording: true } } } }
  const controller = new EditorController()
  Object.assign(controller, {
    view, vim, vimEnabled: true, editingMode: "source",
    element: { dataset: {} },
    form: { setAttribute() {}, querySelector: () => null, dispatchEvent() {}, contains: element => element === projection },
    projectionController: () => projection,
    syncFrontmatterVisibility() {}, syncMetadataToggle() {}
  })
  return { controller, view, vim, dispatches, nativeSelection, flushFrames: () => frames.splice(0).forEach(callback => callback()) }
}

for (const eventKind of ["ArrowLeft", "beforeinput"]) {
  test(`unchanged projection selection after ${eventKind} retains concealed source positions`, t => {
    const { controller, view, flushFrames } = modeFixture(t, EditorSelection.single(8, 1), { sourceOffset: 2 }, "**bold**")
    const before = view.state.selection
    controller.setEditingMode("visual")
    flushFrames()
    const event = eventKind === "ArrowLeft"
      ? new KeyboardEvent("ArrowLeft")
      : { type: "beforeinput", target: new Element(), defaultPrevented: true }
    controller.noteProjectionNavigation(event)
    flushFrames()
    assert.equal(controller.projectionNavigationOccurred, false)
    controller.setEditingMode("source")
    flushFrames()
    assert.equal(view.state.selection, before)
  })
}

test("actual projection selection movement transfers the source caret even before its next animation frame", t => {
  const { controller, view, nativeSelection, flushFrames } = modeFixture(t, EditorSelection.single(8, 1), { sourceOffset: 3 }, "**bold**")
  controller.setEditingMode("visual")
  flushFrames()
  controller.noteProjectionNavigation(new KeyboardEvent("ArrowRight"))
  nativeSelection.anchorOffset = 1
  nativeSelection.focusOffset = 1
  controller.setEditingMode("source")
  flushFrames()
  assert.equal(view.state.selection.main.head, 3)
  assert.equal(view.state.selection.main.anchor, 3)
})

test("non-navigation shortcuts preserve the source selection without reading a lossy projection caret", t => {
  const { controller, view, flushFrames } = modeFixture(t, EditorSelection.single(8, 1), { sourceOffset: 2 }, "**bold**")
  const before = view.state.selection
  controller.setEditingMode("visual")
  flushFrames()
  const event = new KeyboardEvent("s")
  event.ctrlKey = true
  controller.noteProjectionNavigation(event)
  flushFrames()
  controller.setEditingMode("source")
  flushFrames()
  assert.equal(view.state.selection, before)
})

for (const selection of [
  EditorSelection.single(28, 12),
  EditorSelection.single(12, 28),
  EditorSelection.create([EditorSelection.range(28, 12), EditorSelection.cursor(38)], 0)
]) {
  test(`mode round trip retains ${selection.ranges.length} selection(s), direction, history, and Vim state`, t => {
    const fixture = modeFixture(t, selection)
    const { controller, view, vim, flushFrames } = fixture
    const beforeSelection = view.state.selection
    const beforeHistory = view.state.field(historyField)
    const beforeVim = structuredClone(vim)
    controller.setEditingMode("visual")
    flushFrames()
    controller.setEditingMode("source")
    flushFrames()
    assert.equal(view.state.selection, beforeSelection)
    assert.equal(view.state.field(historyField), beforeHistory)
    assert.deepEqual(vim, beforeVim)
    assert.equal(view.focused, true)
  })
}

test("returning from a projection at the same head retains a backward source selection", t => {
  const { controller, view, flushFrames } = modeFixture(t, EditorSelection.single(28, 12), { sourceOffset: 12, blockId: "block-1" })
  const before = view.state.selection
  controller.editingMode = "visual"
  controller.projectionNavigationOccurred = true
  controller.setEditingMode("source")
  flushFrames()
  assert.equal(view.state.selection, before)
})

test("explicit navigation in the projection transfers the new caret to source", t => {
  const { controller, view, flushFrames } = modeFixture(t, EditorSelection.single(28, 12), { sourceOffset: 35, blockId: "block-2" })
  controller.editingMode = "visual"
  controller.projectionNavigationOccurred = true
  controller.setEditingMode("source")
  flushFrames()
  assert.equal(view.state.selection.main.anchor, 35)
  assert.equal(view.state.selection.main.head, 35)
})

test("a deliberate selection change before focus restoration wins over the old projection caret", t => {
  const { controller, view, flushFrames } = modeFixture(t, EditorSelection.single(28, 12), { sourceOffset: 35 })
  controller.editingMode = "visual"
  controller.projectionNavigationOccurred = true
  controller.setEditingMode("source")
  view.dispatch({ selection: { anchor: 2, head: 8 } })
  flushFrames()
  assert.equal(view.state.selection.main.anchor, 2)
  assert.equal(view.state.selection.main.head, 8)
})

for (const [source, head] of [["**bold**", 1], ["[text](https://example.com)", 10]]) {
  test(`mode round trip preserves a source selection inside concealed syntax: ${source}`, t => {
    const mappedHead = sourceOffsetForVisibleOffset(source, visibleOffsetForSourceOffset(source, head))
    assert.notEqual(mappedHead, head, "Regression must exercise a lossy rendered mapping")
    const { controller, view, flushFrames } = modeFixture(t, EditorSelection.single(source.length, head), { sourceOffset: mappedHead }, source)
    const before = view.state.selection
    controller.setEditingMode("visual")
    flushFrames()
    controller.setEditingMode("source")
    flushFrames()
    assert.equal(view.state.selection, before)
  })
}

test("unfolding source metadata does not move the selection", () => {
  const dispatches = []
  EditorController.prototype.syncFrontmatterVisibility.call({
    view: { dispatch: spec => dispatches.push(spec) },
    frontmatterRange: { from: 0, to: 24 },
    frontmatterIsFolded: () => true,
    metadataVisible: true,
    editingMode: "source"
  })
  assert.equal(dispatches.length, 1)
  assert.equal(dispatches[0].selection, undefined)
  assert.equal(dispatches[0].scrollIntoView, undefined)
})

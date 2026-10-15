import assert from "node:assert/strict"
import test from "node:test"
import { DocumentEditor } from "@elef/client"
import { buildEditorMap } from "@elef/work-model"

test("document block kind classification follows the source grammar", () => {
  const editor = new DocumentEditor({})
  assert.equal(editor.currentBlockKind("# Title", "paragraph"), "heading")
  assert.equal(editor.currentBlockKind("   ## Deep", "paragraph"), "heading")
  assert.equal(editor.currentBlockKind("- item", "paragraph"), "list")
  assert.equal(editor.currentBlockKind("  1. item", "paragraph"), "list")
  assert.equal(editor.currentBlockKind("> quote", "paragraph"), "quote")
  assert.equal(editor.currentBlockKind("```js", "paragraph"), "code")
  assert.equal(editor.currentBlockKind("~~~", "paragraph"), "code")
  assert.equal(editor.currentBlockKind("plain text", "paragraph"), "paragraph")
  assert.equal(editor.currentBlockKind("plain text", null), "paragraph")
  assert.equal(editor.currentBlockKind("#nospace", "paragraph"), "paragraph")
})

test("empty trailing markers detect only bare list and quote lines", () => {
  const editor = new DocumentEditor({})
  assert.equal(editor.hasEmptyTrailingMarker("- one\n- ", "list"), true)
  assert.equal(editor.hasEmptyTrailingMarker("1. one\n2. ", "list"), true)
  assert.equal(editor.hasEmptyTrailingMarker("- one\n- two", "list"), false)
  assert.equal(editor.hasEmptyTrailingMarker("> a\n> ", "quote"), true)
  assert.equal(editor.hasEmptyTrailingMarker("> a\n> b", "quote"), false)
  assert.equal(editor.hasEmptyTrailingMarker("- item", "quote"), false)
})

test("document block source ranges include the block directive", () => {
  // No scoped groups: each position directive applies to its single
  // following block, and a bare ::: is an unknown directive line.
  const editor = new DocumentEditor({})
  const source = ":::align{center}\n\n# Solo\n\n:::\n\nAfter\n"
  editor.map = buildEditorMap(source)
  const [solo, after] = editor.map.slides[0].blocks
  assert.deepEqual(editor.blockSourceRange(after), { from: after.range.start, to: after.range.end })
  assert.deepEqual(editor.blockSourceRange(solo), { from: 0, to: 25 })

  const plain = new DocumentEditor({})
  plain.map = buildEditorMap("# T\n\nBody\n")
  const [title] = plain.map.slides[0].blocks
  assert.deepEqual(plain.blockSourceRange(title), { from: title.range.start, to: title.range.end })
})

test("document map shifting pins the edited block start", () => {
  const editor = new DocumentEditor({})
  editor.map = buildEditorMap("# One\n\nBody one.\n")
  const block = editor.map.slides[0].blocks[1]
  editor.shiftMapAfterEdit(7, 17, 4, block.id)
  assert.deepEqual([block.range.start, block.range.end], [7, 11])
  assert.equal(editor.map.source_length, 11)

  const untouched = new DocumentEditor({})
  untouched.map = buildEditorMap("# One\n\nBody one.\n")
  const first = untouched.map.slides[0].blocks[0]
  untouched.shiftMapAfterEdit(7, 17, 4, "other")
  assert.deepEqual([first.range.start, first.range.end], [0, 6])
})

test("visual source edits preserve the edited block start and shift shared map entries once", () => {
  const edited = { id: "block-1", range: { start: 10, end: 14 }, source_range: { start: 8, end: 12 } }
  const after = { range: { start: 14, end: 20 } }
  const editor = new DocumentEditor({})
  editor.map = {
    source_length: 20,
    slides: [{ blocks: [edited, after] }],
    editable_regions: [edited]
  }

  editor.shiftMapAfterEdit(10, 14, 2, "block-1")

  assert.equal(editor.map.source_length, 18)
  assert.deepEqual(edited.range, { start: 10, end: 12 })
  assert.deepEqual(edited.source_range, { start: 8, end: 12 })
  assert.deepEqual(after.range, { start: 12, end: 18 })
})

test("presentation source edits shift nested slide ranges and leave directives alone", () => {
  // The retired presentation editor shifted with older no-pin rules; the
  // unified editor pins only the edited block start, so an unedited block
  // starting inside a replacement collapses to the edit start.
  const block = { range: { start: 12, end: 14 }, content_range: { start: 14, end: 20 } }
  const editor = new DocumentEditor({})
  editor.map = {
    source_length: 20,
    slides: [{ range: { start: 4, end: 18 }, blocks: [block] }],
    directives: [{ range: { start: 0, end: 10 } }]
  }

  editor.shiftMapAfterEdit(10, 14, 2)

  assert.equal(editor.map.source_length, 18)
  assert.deepEqual(editor.map.slides[0].range, { start: 4, end: 16 })
  assert.deepEqual(block.range, { start: 10, end: 12 })
  assert.deepEqual(block.content_range, { start: 12, end: 18 })
  assert.deepEqual(editor.map.directives[0].range, { start: 0, end: 10 })
})

test("structured continuation appends the list marker through the editor seam", () => {
  const calls = []
  const editor = new DocumentEditor({})
  Object.defineProperty(editor, "editorController", { value: { replaceRange: (text, from, to) => calls.push({ text, from, to }) } })
  const blockElement = { dataset: { editorBlockId: "b1" }, blur() {} }
  const region = { content_range: { start: 10, end: 20 } }

  editor.continueStructuredBlock(blockElement, region, "list", "- one", "# T\n\n- one", false)

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { text: "- one\n- ", from: 10, to: 20 })
  assert.deepEqual(editor.pendingCaret, { sourceOffset: 10 + "- one\n- ".length, location: "list_item_end" })
})

test("empty list markers collapse back to the previous lines", () => {
  const calls = []
  const editor = new DocumentEditor({})
  Object.defineProperty(editor, "editorController", { value: { replaceRange: (text, from, to) => calls.push({ text, from, to }) } })
  const blockElement = { dataset: { editorBlockId: "b1" }, blur() {} }
  const region = { content_range: { start: 10, end: 22 } }

  editor.continueStructuredBlock(blockElement, region, "list", "- one\n- ", "# T\n\n- one\n- ", true)

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { text: "- one\n\n", from: 10, to: 22 })
})

// Input-bridge selection leg: a collapsed native caret inside an editable
// projection block drives the engine selection.
function stubSelectionBridge(t, { editable = true, collapsed = true, focusOffset = 2, anchorOffset = null, anchorInOtherBlock = false, engineSelection = [0, 0] } = {}) {
  const saved = new Map()
  const setGlobal = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  const textNode = { nodeType: 3, parentElement: null, textContent: "First" }
  const block = {
    dataset: { editorBlockId: "b1" },
    contentEditable: editable ? "true" : "false",
    children: [],
    textContent: "First",
    closest: (selector) => (selector === "[data-editor-block-id]" ? block : null),
  }
  textNode.parentElement = block
  const otherText = { nodeType: 3, parentElement: null, textContent: "Other" }
  const otherBlock = {
    dataset: { editorBlockId: "b2" },
    contentEditable: "true",
    children: [],
    textContent: "Other",
    closest: (selector) => (selector === "[data-editor-block-id]" ? otherBlock : null),
  }
  otherText.parentElement = otherBlock
  const projection = {
    contains: (node) => node === block || node === textNode || node === otherBlock || node === otherText,
    querySelectorAll: () => [block],
  }
  const anchorNode = anchorInOtherBlock ? otherText : textNode
  setGlobal("window", { getSelection: () => ({ isCollapsed: collapsed, anchorNode, anchorOffset: anchorOffset ?? focusOffset, focusNode: textNode, focusOffset }) })
  setGlobal("Node", { ELEMENT_NODE: 1 })
  setGlobal("CSS", { escape: (value) => value })
  const calls = []
  const replaced = []
  const engine = {
    value: "x".repeat(20),
    selectionStart: engineSelection[0],
    selectionEnd: engineSelection[1],
    setSelectionRange: (anchor, head) => calls.push([anchor, head]),
    replaceRange: (text, from, to) => replaced.push({ text, from, to }),
    replaceRanges: () => {},
  }
  const editor = new DocumentEditor({
    projection,
    deps: {
      syncActiveMath: () => {},
      visibleOffsetAtPoint: (block, node, offset) => offset,
      sourceOffsetForVisibleOffset: (source, offset) => offset,
      markdownForVisibleText: (source, text) => `${text}!`,
      renderInlineMath: () => {},
    },
  })
  editor.map = { editable_regions: [{ id: "r1", block_id: "b1", kind: "paragraph", editable: true, content_range: { start: 9, end: 14 } }] }
  Object.defineProperty(editor, "editorController", { value: engine })
  return { editor, engine, block, calls, replaced }
}

test("a collapsed caret in an editable block drives the engine selection", (t) => {
  const { editor, calls } = stubSelectionBridge(t)

  editor.rememberProjectionCaret()

  assert.deepEqual(editor.lastProjectionCaret, { blockId: "b1", visibleOffset: 2 })
  assert.deepEqual(calls, [[11, 11]])
})

test("a readonly projection block never moves the engine selection", (t) => {
  const { editor, calls } = stubSelectionBridge(t, { editable: false })

  editor.rememberProjectionCaret()

  assert.deepEqual(editor.lastProjectionCaret, { blockId: "b1", visibleOffset: 2 })
  assert.deepEqual(calls, [])
})

test("a ranged projection selection stays projection-side", (t) => {
  const { editor, calls } = stubSelectionBridge(t, { collapsed: false })

  editor.rememberProjectionCaret()

  assert.deepEqual(editor.lastProjectionCaret, { blockId: "b1", visibleOffset: 2 })
  assert.deepEqual(calls, [])
})

test("an already matching engine selection is left alone", (t) => {
  const { editor, calls } = stubSelectionBridge(t, { engineSelection: [11, 11] })

  editor.rememberProjectionCaret()

  assert.deepEqual(calls, [])
})

test("pending projection edits defer the sync until the flush commits", (t) => {
  const { editor, engine, block, calls } = stubSelectionBridge(t)
  editor.pendingProjectionEdits = new Map([["r1", { from: 9, to: 14, source: "First", kind: "paragraph", blockId: "b1", blockElement: block }]])
  const flushed = []
  engine.replaceRanges = (changes) => flushed.push(changes)

  editor.rememberProjectionCaret()
  assert.deepEqual(calls, [])

  editor.flushPendingProjectionEdits()
  assert.equal(flushed.length, 1)
  assert.deepEqual(flushed[0], [{ from: 9, to: 14, insert: "First!" }])
  assert.deepEqual(calls, [[11, 11]])
})

// Precise-intent leg: caret-local plain-text beforeinput commits exact
// source transactions; everything else stays on the reconstruction path.
test("typing commits a precise source transaction without pending", (t) => {
  const { editor, block, replaced } = stubSelectionBridge(t)

  editor.projectionBeforeinput({ target: block, inputType: "insertText", data: "X" })

  assert.deepEqual(replaced, [{ text: "X", from: 11, to: 11 }])
  assert.equal(editor.pendingProjectionEdits, undefined)
  assert.deepEqual(editor.map.editable_regions[0].content_range, { start: 9, end: 15 })
})

test("backward deletion removes one visible grapheme precisely", (t) => {
  const { editor, block, replaced } = stubSelectionBridge(t)

  editor.projectionBeforeinput({ target: block, inputType: "deleteContentBackward", data: null })

  assert.deepEqual(replaced, [{ text: "", from: 10, to: 11 }])
})

test("structural intents stay on the reconstruction path", (t) => {
  const { editor, block, replaced } = stubSelectionBridge(t)

  for (const inputType of ["insertParagraph", "insertLineBreak", "insertCompositionText", "historyUndo"]) {
    editor.projectionBeforeinput({ target: block, inputType, data: inputType === "historyUndo" ? null : "x" })
  }

  assert.deepEqual(replaced, [])
  assert.equal(editor.pendingProjectionEdits, undefined)
})

test("precise intents decline while legacy pending edits exist", (t) => {
  const { editor, block, replaced } = stubSelectionBridge(t)
  editor.pendingProjectionEdits = new Map([["r1", { from: 9, to: 14, source: "First", kind: "paragraph", blockId: "b1", blockElement: block }]])

  editor.projectionBeforeinput({ target: block, inputType: "insertText", data: "X" })

  assert.deepEqual(replaced, [])
})

test("cross-block selections stay on the reconstruction path", (t) => {
  const { editor, block, replaced } = stubSelectionBridge(t, { collapsed: false, anchorOffset: 1, anchorInOtherBlock: true })

  editor.projectionBeforeinput({ target: block, inputType: "insertText", data: "X" })

  assert.deepEqual(replaced, [])
})

// Visual Vim routing: normal-mode keys run through the live engine.
function stubVimRouting(t, { vimEnabled = true, insertMode = false, handled = true, mutate = null } = {}) {
  const { editor, engine, block } = stubSelectionBridge(t)
  const vimCalls = []
  const inputEvents = []
  const restored = []
  Object.assign(engine, {
    vimEnabled,
    insertMode,
    selectionHead: 11,
    handleVimKey: (event) => {
      vimCalls.push(event.key)
      if (mutate) mutate(engine)
      return handled
    },
  })
  block.dispatchEvent = (event) => inputEvents.push(event.type)
  editor.restoreCaret = (offset, blockId) => restored.push([offset, blockId])
  const keyEvent = (key, overrides = {}) => {
    const event = {
      key,
      target: block,
      defaultPrevented: false,
      isComposing: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: () => { event.defaultPrevented = true },
      ...overrides,
    }
    return event
  }
  return { editor, engine, block, vimCalls, inputEvents, restored, keyEvent }
}

test("visual keys bypass Vim when disabled or in insert mode", (t) => {
  const disabled = stubVimRouting(t, { vimEnabled: false })
  assert.equal(disabled.editor.routeVimKey(disabled.keyEvent("j"), disabled.block), false)
  assert.deepEqual(disabled.vimCalls, [])

  const insert = stubVimRouting(t, { insertMode: true })
  assert.equal(insert.editor.routeVimKey(insert.keyEvent("j"), insert.block), false)
  assert.deepEqual(insert.vimCalls, [])
})

test("Escape leaves visual insert mode through Vim", (t) => {
  const { editor, block, vimCalls, keyEvent } = stubVimRouting(t, { insertMode: true })
  const event = keyEvent("Escape")

  assert.equal(editor.routeVimKey(event, block), true)
  assert.deepEqual(vimCalls, ["Escape"])
  assert.equal(event.defaultPrevented, true)
})

test("handled Vim motions move the projection caret without a refresh", (t) => {
  const { editor, engine, block, vimCalls, inputEvents, restored, keyEvent } = stubVimRouting(t)
  engine.selectionHead = 13
  const event = keyEvent("l")

  assert.equal(editor.routeVimKey(event, block), true)
  assert.deepEqual(vimCalls, ["l"])
  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(restored, [[13, "b1"]])
  assert.deepEqual(inputEvents, [])
  assert.equal(editor.pendingCaretRestore, undefined)
})

test("handled Vim edits schedule a refresh with caret restoration", (t) => {
  const { editor, engine, block, inputEvents, restored, keyEvent } = stubVimRouting(t, {
    mutate: (target) => { target.value = "changed"; target.selectionHead = 12 },
  })
  const event = keyEvent("x")

  assert.equal(editor.routeVimKey(event, block), true)
  assert.deepEqual(restored, [[12, "b1"]])
  assert.deepEqual(editor.pendingCaretRestore, { sourceOffset: 12, preferredBlockId: "b1" })
  assert.deepEqual(inputEvents, ["input"])
})

test("unconsumed normal-mode keys swallow except navigation", (t) => {
  const printable = stubVimRouting(t, { handled: false })
  const swallowed = printable.keyEvent("j")
  assert.equal(printable.editor.routeVimKey(swallowed, printable.block), true)
  assert.deepEqual(printable.vimCalls, ["j"])
  assert.equal(swallowed.defaultPrevented, true)

  const navigation = stubVimRouting(t, { handled: false })
  const arrow = navigation.keyEvent("ArrowLeft")
  assert.equal(navigation.editor.routeVimKey(arrow, navigation.block), false)
  assert.equal(arrow.defaultPrevented, false)
})

test("visual Vim routing skips modified, composing, and readonly input", (t) => {
  const modified = stubVimRouting(t)
  assert.equal(modified.editor.routeVimKey(modified.keyEvent("j", { ctrlKey: true }), modified.block), false)
  assert.deepEqual(modified.vimCalls, [])

  const composing = stubVimRouting(t)
  assert.equal(composing.editor.routeVimKey(composing.keyEvent("j", { isComposing: true }), composing.block), false)
  assert.deepEqual(composing.vimCalls, [])

  const readonly = stubVimRouting(t)
  readonly.block.contentEditable = "false"
  assert.equal(readonly.editor.routeVimKey(readonly.keyEvent("j"), readonly.block), false)
  assert.deepEqual(readonly.vimCalls, [])
})

test("a Vim visual range survives projection caret sync", (t) => {
  const { editor, engine, calls } = stubSelectionBridge(t)
  Object.assign(engine, { vimEnabled: true, insertMode: false, selectionStart: 5, selectionEnd: 9 })

  editor.rememberProjectionCaret()

  assert.deepEqual(editor.lastProjectionCaret, { blockId: "b1", visibleOffset: 2 })
  assert.deepEqual(calls, [])
})

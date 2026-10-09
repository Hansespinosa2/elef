import assert from "node:assert/strict"
import test from "node:test"
import { DocumentEditor } from "../../../packages/client/src/features/document/document_editor.js"
import { buildEditorMap } from "../../../packages/work-model/src/index.js"

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

test("document block source ranges include lone group directives", () => {
  const editor = new DocumentEditor({})
  const source = ":::align{center}\n\n# Solo\n\n:::\n\nAfter\n"
  editor.map = buildEditorMap(source)
  const [solo, after] = editor.map.slides[0].blocks
  assert.deepEqual(editor.blockSourceRange(after), { from: after.range.start, to: after.range.end })
  assert.deepEqual(editor.blockSourceRange(solo), { from: 0, to: 30 })

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

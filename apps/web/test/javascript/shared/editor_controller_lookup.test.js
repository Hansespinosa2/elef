import test from "node:test"
import assert from "node:assert/strict"
import { asEditorSeam, editorFor } from "@elef/editor-runtime/test-internals"

test("editor lookup returns only the controller attached to the requested host", () => {
  const editor = { editorReady: true }
  assert.equal(editorFor({ editorController: editor }), editor)
  assert.equal(editorFor({}), null)
  assert.equal(editorFor(null), null)
})

function seamCandidate() {
  return {
    value: "source",
    selectionStart: 0,
    selectionEnd: 0,
    selectionHead: 0,
    selectionRangeCount: 1,
    vimEnabled: false,
    insertMode: true,
    editingMode: "source",
    focus: () => {},
    commitSource: () => {},
    replaceRange: () => {},
    replaceRanges: () => {},
    setSelectionRange: () => {},
    handleVimKey: () => false,
    runKeymap: () => false,
  }
}

test("editor seam guard passes the engine through by identity", () => {
  const candidate = seamCandidate()
  assert.equal(asEditorSeam(candidate), candidate)
})

test("editor seam guard rejects members with the wrong shape", () => {
  assert.equal(asEditorSeam(null), null)
  assert.equal(asEditorSeam({}), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), value: 42 }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), selectionStart: "0" }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), selectionEnd: null }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), selectionHead: "0" }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), selectionRangeCount: "1" }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), vimEnabled: 0 }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), insertMode: 1 }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), editingMode: null }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), focus: null }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), commitSource: true }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), replaceRange: null }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), replaceRanges: "x" }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), setSelectionRange: 0 }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), handleVimKey: null }), null)
  assert.equal(asEditorSeam({ ...seamCandidate(), runKeymap: null }), null)
})

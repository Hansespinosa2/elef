import test from "node:test"
import assert from "node:assert/strict"
import { editorFor } from "@elef/editor-runtime/test-internals"

test("editor lookup returns only the controller attached to the requested host", () => {
  const editor = { editorReady: true }
  assert.equal(editorFor({ editorController: editor }), editor)
  assert.equal(editorFor({}), null)
  assert.equal(editorFor(null), null)
})

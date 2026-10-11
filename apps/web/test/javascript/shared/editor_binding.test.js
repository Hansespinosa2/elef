import assert from "node:assert/strict"
import test from "node:test"

import { createCodeMirrorBinding } from "@elef/editor-runtime/test-internals"

function setup({ editor = null, workId = "work-1", source = "live source", fallback = "fallback source" } = {}) {
  let materialized = 0
  let fallbackValue = fallback
  const applied = []
  const controller = editor === null ? null : {
    sourceValue: source,
    editorReady: true,
    setExternalValue: value => { applied.push(value) }
  }
  const binding = createCodeMirrorBinding({
    getEditor: () => controller,
    getWorkId: () => workId,
    getFallbackValue: () => fallbackValue,
    setFallbackValue: value => { fallbackValue = value },
    waitForEditor: async () => controller,
    materializeEdits: () => { materialized += 1 }
  })
  return { binding, applied, materialized: () => materialized, fallbackValue: () => fallbackValue }
}

test("getText reads the controller buffer with textarea fallback", () => {
  assert.equal(setup({ editor: true }).binding.getText(), "live source")
  assert.equal(setup().binding.getText(), "fallback source")
})

test("setText applies matching sources and materializes first", async () => {
  const { binding, applied, materialized } = setup({ editor: true })
  assert.equal(await binding.setText("new source", { id: "work-1", expectedSource: "live source" }), true)
  assert.deepEqual(applied, ["new source"])
  assert.equal(materialized(), 1)
})

test("setText rejects stale work identity and newer buffer text", async () => {
  const { binding, applied } = setup({ editor: true })
  assert.equal(await binding.setText("stale", { id: "other-work", expectedSource: "live source" }), false)
  assert.equal(await binding.setText("stale", { id: "work-1", expectedSource: "older" }), false)
  assert.deepEqual(applied, [])
})

test("setText falls back to the textarea without a controller", async () => {
  const { binding, fallbackValue } = setup()
  assert.equal(await binding.setText("disk source", { id: "work-1", expectedSource: "fallback source" }), true)
  assert.equal(fallbackValue(), "disk source")
})

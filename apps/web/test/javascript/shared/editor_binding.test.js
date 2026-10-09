import assert from "node:assert/strict"
import test from "node:test"

import { createCodeMirrorBinding } from "../../../app/javascript/lib/editor_binding.js"

function setup({ editor = null, deckId = "deck-1", source = "live source", fallback = "fallback source" } = {}) {
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
    getDeckId: () => deckId,
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
  assert.equal(await binding.setText("new source", { id: "deck-1", expectedSource: "live source" }), true)
  assert.deepEqual(applied, ["new source"])
  assert.equal(materialized(), 1)
})

test("setText rejects stale deck identity and newer buffer text", async () => {
  const { binding, applied } = setup({ editor: true })
  assert.equal(await binding.setText("stale", { id: "other-deck", expectedSource: "live source" }), false)
  assert.equal(await binding.setText("stale", { id: "deck-1", expectedSource: "older" }), false)
  assert.deepEqual(applied, [])
})

test("setText falls back to the textarea without a controller", async () => {
  const { binding, fallbackValue } = setup()
  assert.equal(await binding.setText("disk source", { id: "deck-1", expectedSource: "fallback source" }), true)
  assert.equal(fallbackValue(), "disk source")
})

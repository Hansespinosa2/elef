import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { applyEditorSource } from "@elef/editor-runtime/test-internals"

test("delayed editor readiness preserves a different deck or newer local edits", async () => {
  for (const change of ["deck", "edit"]) {
    const { document } = parseHTML("<html><body><textarea></textarea></body></html>")
    const field = document.querySelector("textarea")
    field.value = "original"
    let owner = "A"
    let ready
    const waiting = new Promise(resolve => { ready = resolve })
    const applying = applyEditorSource("external", {
      id: "A", expectedSource: field.value, getDeckId: () => owner, getSource: () => field.value,
      waitForEditor: () => waiting, setFallback: () => assert.fail("stale fallback")
    })
    if (change === "deck") owner = "B"
    field.value = "newer buffer"
    ready({ setExternalValue: () => assert.fail("stale replacement") })
    assert.equal(await applying, false)
    assert.equal(field.value, "newer buffer")
  }
})

test("matching editor ownership applies the source through the existing controller", async () => {
  let source = "old"
  assert.equal(await applyEditorSource("new", {
    id: "A", expectedSource: source, getDeckId: () => "A", getSource: () => source,
    waitForEditor: async () => ({ setExternalValue: value => { source = value } }),
    setFallback: () => assert.fail("controller available")
  }), true)
  assert.equal(source, "new")
})

test("pending visual input is materialized before delayed replacement's final source check", async () => {
  let source = "old"
  const applied = await applyEditorSource("external", {
    id: "A", expectedSource: source, getDeckId: () => "A", getSource: () => source,
    waitForEditor: async () => ({ setExternalValue: () => assert.fail("pending visual input was discarded") }),
    materializeEdits: () => { source = "pending visual edit" },
    setFallback: () => assert.fail("fallback")
  })
  assert.equal(applied, false)
  assert.equal(source, "pending visual edit")
})

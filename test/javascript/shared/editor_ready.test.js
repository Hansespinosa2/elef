import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { waitForEditorController } from "../../../app/javascript/lib/editor_ready.js"

test("editor readiness resolves after the controller connects", async () => {
  const { document, CustomEvent } = parseHTML("<html><body><div></div></body></html>")
  const field = document.querySelector("div")
  const controller = { editorReady: true }
  let found = null
  const waiting = waitForEditorController(field, () => found, { timeoutMs: 100 })
  found = controller
  field.dispatchEvent(new CustomEvent("elef:editor-ready"))
  assert.equal(await waiting, controller)
})

test("editor readiness times out with a typed, actionable error", async () => {
  const { document } = parseHTML("<html><body><div></div></body></html>")
  await assert.rejects(
    waitForEditorController(document.querySelector("div"), () => null, { timeoutMs: 2 }),
    error => error.code === "editor_unavailable" && error.retryable === true
  )
})


test("a published but partially initialized controller never satisfies readiness", async () => {
  const { document } = parseHTML("<html><body><div></div></body></html>")
  const controller = { editorReady: false }
  await assert.rejects(waitForEditorController(document.querySelector("div"), () => controller, { timeoutMs: 2 }),
    error => error.code === "editor_unavailable")
})

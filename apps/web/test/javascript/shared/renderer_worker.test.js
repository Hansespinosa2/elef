import assert from "node:assert/strict"
import test from "node:test"
import { renderWorkerMessage } from "@elef/editor-runtime/test-internals"

test("renderer worker returns the renderer result with its request id", () => {
  const input = { source: "# Shared" }
  const result = { html: "<h1>Shared</h1>" }
  assert.deepEqual(renderWorkerMessage({ id: 12, input }, value => {
    assert.equal(value, input)
    return result
  }), { id: 12, result })
})

test("renderer worker preserves typed renderer failures", () => {
  const failure = Object.assign(new Error("Renderer timed out"), { code: "render_timeout", retryable: true })
  assert.deepEqual(renderWorkerMessage({ id: 7, input: {} }, () => { throw failure }), {
    id: 7,
    error: { code: "render_timeout", message: "Renderer timed out", retryable: true }
  })
})

test("renderer worker supplies a safe error envelope for unknown failures", () => {
  assert.deepEqual(renderWorkerMessage(null, () => { throw "failure" }), {
    id: undefined,
    error: { code: "render_error", message: "Preview could not be rendered.", retryable: false }
  })
})

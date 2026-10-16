import assert from "node:assert/strict"
import test from "node:test"
import { renderWorkerMessage } from "@elef/editor-runtime/worker"

// The desktop renderer worker runs DOM-less inside a Web Worker: this entry
// must load under plain node, free of the barrel's DOM-at-import side
// effects (Stimulus application start, turbo:load listener).
test("worker entry loads DOM-less and answers a render message", () => {
  assert.equal(typeof document, "undefined")
  assert.deepEqual(
    renderWorkerMessage({ id: 1, input: { source: "# Hi" } }, input => ({ html: input.source })),
    { id: 1, result: { html: "# Hi" } }
  )
})

test("worker entry reports renderer failures with the request id", () => {
  assert.deepEqual(renderWorkerMessage({ id: 2, input: {} }, () => { throw new Error("boom") }), {
    id: 2,
    error: { code: "render_error", message: "boom", retryable: false }
  })
})

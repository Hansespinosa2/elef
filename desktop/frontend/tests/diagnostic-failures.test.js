import assert from "node:assert/strict"
import test from "node:test"
import { createDiagnosticFailures } from "../src/diagnostic-failures.js"

test("diagnostic failure callbacks invoke fixed native commands without exception data", async () => {
  const calls = []
  const callbacks = createDiagnosticFailures((...args) => {
    calls.push(args)
    return Promise.reject(new Error("native diagnostics unavailable"))
  })
  const hostileException = "private-path-and-token-sentinel"

  callbacks.recordPreviewFailure(hostileException)
  callbacks.recordBootstrapFailure(new Error(hostileException))
  await Promise.resolve()

  assert.deepEqual(calls, [["record_preview_failure"], ["record_bootstrap_failure"]])
  assert.ok(!JSON.stringify(calls).includes(hostileException))
})

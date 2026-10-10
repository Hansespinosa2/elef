import assert from "node:assert/strict"
import test from "node:test"

import { createRequestGuard } from "@elef/editor-runtime/test-internals"

test("a superseded request token is stale while the newest stays current", () => {
  const guard = createRequestGuard()
  const first = guard.request()
  const second = guard.request()

  assert.equal(guard.isCurrent(first), false)
  assert.equal(guard.isCurrent(second), true)
  assert.equal(guard.isCurrent(second + 1), false)
})

test("invalidate retires the in-flight request without issuing a token", () => {
  const guard = createRequestGuard()
  const pending = guard.request()
  guard.invalidate()

  assert.equal(guard.isCurrent(pending), false)
  assert.equal(guard.isCurrent(guard.request()), true)
})

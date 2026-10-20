import assert from "node:assert/strict"
import test from "node:test"
import { waitFor } from "./native-quit-smoke.js"

test("native readiness retries transient WebDriver script timeouts within its deadline", async () => {
  let attempts = 0
  await waitFor(() => {
    attempts += 1
    if (attempts === 1) throw new Error("Script execution timed out")
    return true
  }, "frontend ready", 1_000)

  assert.equal(attempts, 2)
})

test("native readiness still fails immediately for non-timeout WebDriver errors", async () => {
  await assert.rejects(
    waitFor(() => { throw new Error("WebDriver session ended") }, "frontend ready", 1_000),
    /WebDriver session ended/
  )
})

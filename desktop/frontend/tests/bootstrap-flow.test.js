import test from "node:test"
import assert from "node:assert/strict"
import { completeBootstrap } from "../src/bootstrap-flow.js"

test("the library paints before editor initialization and update cleanup waits for editor readiness", async () => {
  const order = []
  const callbacks = Object.fromEntries(["initialize", "waitForPaint", "waitForEditor", "confirmReady"].map(name => [name, async () => order.push(name)]))
  await completeBootstrap({ ...callbacks, markInteractive: () => order.push("markInteractive") })
  assert.deepEqual(order, ["initialize", "waitForPaint", "markInteractive", "waitForEditor", "confirmReady"])
})

test("failed replacement bootstrap never acknowledges cleanup readiness", async () => {
  for (const failing of ["initialize", "waitForPaint", "waitForEditor"]) {
    let acknowledged = false
    const callbacks = Object.fromEntries(["initialize", "waitForPaint", "waitForEditor"].map(name => [name, async () => {
      if (name === failing) throw new Error("Failed replacement bootstrap")
    }]))
    await assert.rejects(completeBootstrap({ ...callbacks, markInteractive() {}, confirmReady: async () => { acknowledged = true } }), /Failed replacement/)
    assert.equal(acknowledged, false)
  }
})

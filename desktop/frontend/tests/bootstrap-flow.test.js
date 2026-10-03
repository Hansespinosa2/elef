import test from "node:test"
import assert from "node:assert/strict"
import { completeBootstrap } from "../src/bootstrap-flow.js"

test("update cleanup readiness follows initialization, editor connection, and paint", async () => {
  const order = []
  await completeBootstrap(Object.fromEntries(["initialize", "waitForEditor", "waitForPaint", "confirmReady"].map(name => [name, async () => order.push(name)])))
  assert.deepEqual(order, ["initialize", "waitForEditor", "waitForPaint", "confirmReady"])
})

test("failed replacement bootstrap never acknowledges cleanup readiness", async () => {
  for (const failing of ["initialize", "waitForEditor", "waitForPaint"]) {
    let acknowledged = false
    const callbacks = Object.fromEntries(["initialize", "waitForEditor", "waitForPaint"].map(name => [name, async () => {
      if (name === failing) throw new Error("Failed replacement bootstrap")
    }]))
    await assert.rejects(completeBootstrap({ ...callbacks, confirmReady: async () => { acknowledged = true } }), /Failed replacement/)
    assert.equal(acknowledged, false)
  }
})

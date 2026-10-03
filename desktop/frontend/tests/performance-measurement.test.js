import assert from "node:assert/strict"
import test from "node:test"
import { measurePaintedAction, percentile95 } from "../src/performance-measurement.js"

test("application timing includes the actual operation and painted result", async () => {
  const order = []
  let clock = 10
  const measurement = await measurePaintedAction(async () => {
    order.push("operation")
    clock += 20
    return "loaded"
  }, { now: () => clock, paint: async () => { order.push("paint"); clock += 30 } })
  assert.deepEqual(order, ["operation", "paint"])
  assert.deepEqual(measurement, { milliseconds: 50, result: "loaded" })
})

test("failed operations do not produce a successful measurement", async () => {
  await assert.rejects(measurePaintedAction(() => { throw new Error("load failed") }, {
    now: () => 0, paint: () => assert.fail("paint after failure")
  }), /load failed/)
})

test("p95 uses nearest rank without discarding slow samples or mutating the run list", () => {
  const samples = Array.from({ length: 20 }, (_, index) => 20 - index)
  const original = [...samples]
  assert.equal(percentile95(samples), 19)
  assert.deepEqual(samples, original)
  for (const invalid of [[], Array(19).fill(1), [...Array(19).fill(1), NaN], Array(20).fill(-1)]) {
    assert.throws(() => percentile95(invalid), /at least 20/)
  }
})

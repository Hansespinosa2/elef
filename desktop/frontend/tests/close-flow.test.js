import assert from "node:assert/strict"
import test from "node:test"
import { createCloseFlow } from "../src/close-flow.js"

test("dirty native close or Quit waits for its save before closing", async () => {
  let resolve
  const flushed = new Promise(done => { resolve = done })
  let closes = 0
  let prevented = 0
  const request = createCloseFlow({ isDirty: () => true, flushForClose: () => flushed, close: () => { closes += 1 } })
  const first = request({ preventDefault: () => { prevented += 1 } })
  const repeated = request({ preventDefault: () => { prevented += 1 } })
  assert.equal(prevented, 2)
  assert.equal(closes, 0)
  resolve("saved")
  await Promise.all([first, repeated])
  assert.equal(closes, 1)
})

test("conflicts keep the window open without a native confirmation", async () => {
  let closes = 0
  let confirms = 0
  const request = createCloseFlow({
    isDirty: () => true,
    flushForClose: async () => "conflict",
    close: () => { closes += 1 },
    confirmDiscard: () => { confirms += 1; return true }
  })
  await request({ preventDefault() {} })
  assert.equal(closes, 0)
  assert.equal(confirms, 0)
})

test("failed saves confirm natively before discarding", async () => {
  for (const discard of [true, false]) {
    let closes = 0
    let confirms = 0
    const request = createCloseFlow({
      isDirty: () => true,
      flushForClose: async () => "failed",
      close: () => { closes += 1 },
      confirmDiscard: () => { confirms += 1; return discard }
    })
    await request({ preventDefault() {} })
    assert.equal(confirms, 1)
    assert.equal(closes, discard ? 1 : 0)
  }
})

test("failed saves without a confirmation stay open", async () => {
  let closes = 0
  const request = createCloseFlow({
    isDirty: () => true,
    flushForClose: async () => "failed",
    close: () => { closes += 1 }
  })
  await request({ preventDefault() {} })
  assert.equal(closes, 0)
})

test("flush and confirmation errors keep the window open and report", async () => {
  for (const failing of ["flush", "confirm"]) {
    let closes = 0
    const errors = []
    const failure = new Error(`${failing} failed`)
    const request = createCloseFlow({
      isDirty: () => true,
      flushForClose: failing === "flush" ? async () => { throw failure } : async () => "failed",
      close: () => { closes += 1 },
      confirmDiscard: failing === "confirm" ? async () => { throw failure } : async () => true,
      onError: error => errors.push(error)
    })
    await request({ preventDefault() {} })
    assert.equal(closes, 0)
    assert.deepEqual(errors, [failure])
  }
})

test("a clean close proceeds without flushing or confirming", () => {
  const clean = createCloseFlow({
    isDirty: () => false,
    flushForClose: () => assert.fail("clean flush"),
    close: () => assert.fail("recursive close"),
    confirmDiscard: () => assert.fail("clean confirm")
  })
  clean({ preventDefault: () => assert.fail("clean close prevented") })
})

test("a failed visual-buffer flush prevents closing instead of losing pending input", () => {
  let prevented = false
  let reported = false
  const request = createCloseFlow({
    isDirty: () => { throw new Error("pending visual edit failed") },
    flushForClose: () => assert.fail("save proceeded"),
    close: () => assert.fail("close proceeded"),
    onError: () => { reported = true }
  })
  request({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(reported, true)
})

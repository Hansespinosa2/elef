import assert from "node:assert/strict"
import test from "node:test"
import { createCloseFlow } from "../src/close-flow.js"

test("dirty native close or Quit waits for its save before closing", async () => {
  let resolve
  const save = new Promise(done => { resolve = done })
  let closes = 0
  let prevented = 0
  const request = createCloseFlow({ isDirty: () => true, flushSave: () => save, close: () => { closes += 1 } })
  const first = request({ preventDefault: () => { prevented += 1 } })
  const repeated = request({ preventDefault: () => { prevented += 1 } })
  assert.equal(prevented, 2)
  assert.equal(closes, 0)
  resolve(true)
  await Promise.all([first, repeated])
  assert.equal(closes, 1)
})

test("conflicts and failed saves keep the window open; a clean close proceeds", async () => {
  for (const outcome of [false, new Error("save failed")]) {
    let closes = 0
    const errors = []
    const request = createCloseFlow({ isDirty: () => true, flushSave: async () => {
      if (outcome instanceof Error) throw outcome
      return outcome
    }, close: () => { closes += 1 }, onError: error => errors.push(error) })
    await request({ preventDefault() {} })
    assert.equal(closes, 0)
    assert.equal(errors.length, outcome === false ? 0 : 1)
  }
  const clean = createCloseFlow({ isDirty: () => false, flushSave: () => assert.fail("clean save"), close: () => assert.fail("recursive close") })
  clean({ preventDefault: () => assert.fail("clean close prevented") })
})

test("a failed visual-buffer flush prevents closing instead of losing pending input", () => {
  let prevented = false
  let reported = false
  const request = createCloseFlow({
    isDirty: () => { throw new Error("pending visual edit failed") },
    flushSave: () => assert.fail("save proceeded"),
    close: () => assert.fail("close proceeded"),
    onError: () => { reported = true }
  })
  request({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(reported, true)
})

test("a staged update intercepts a clean close and relaunches only after the safe activation", async () => {
  const events = []
  let prevented = false
  const request = createCloseFlow({
    isDirty: () => false,
    flushSave: () => assert.fail("clean close does not flush"),
    close: () => events.push("close"),
    shouldPrepareClose: () => true,
    prepareClose: async () => { events.push("recheck-and-activate"); return "relaunch" }
  })
  await request({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.deepEqual(events, ["recheck-and-activate"])
})

test("dirty data is flushed before an update can activate, and failed flush leaves the app open", async () => {
  const events = []
  const request = createCloseFlow({
    isDirty: () => true,
    flushSave: async () => { events.push("flush"); return false },
    close: () => events.push("close"),
    shouldPrepareClose: () => true,
    prepareClose: async () => { events.push("activate"); return "relaunch" }
  })
  await request({ preventDefault() {} })
  assert.deepEqual(events, ["flush"])
})

test("a safe-version recheck that defers installation allows ordinary quit", async () => {
  let closes = 0
  const request = createCloseFlow({
    isDirty: () => false,
    flushSave: () => assert.fail("clean close does not flush"),
    close: () => { closes += 1 },
    shouldPrepareClose: () => true,
    prepareClose: async () => "close"
  })
  await request({ preventDefault() {} })
  assert.equal(closes, 1)
})

import assert from "node:assert/strict"
import test from "node:test"

import { checkForDesktopUpdate, createIdleUpdateCheck, installDesktopUpdate } from "../src/update-flow.js"

test("update checks distinguish no update from an announced available update", async () => {
  assert.equal(await checkForDesktopUpdate(async () => null), null)

  let progress
  const result = await checkForDesktopUpdate(async () => ({
    version: "1.2.0",
    body: "Fixes"
  }), async (version, callback) => {
    assert.equal(version, "1.2.0")
    callback({ event: "Progress", data: { chunkLength: 10 } })
    return true
  })
  assert.deepEqual({ version: result.version, notes: result.notes }, { version: "1.2.0", notes: "Fixes" })
  await result.install(event => { progress = event })
  assert.equal(progress.data.chunkLength, 10)
})

test("abandoned updates release their native resource and failed installations never relaunch", async () => {
  let released = 0
  let relaunched = false
  const error = new Error("Invalid update signature")
  const update = await checkForDesktopUpdate(async () => ({
    version: "1.2.0",
    close: async () => { released += 1 }
  }), async () => { throw error })
  await assert.rejects(installDesktopUpdate(update, {
    relaunch: async () => { relaunched = true }
  }), error)
  assert.equal(relaunched, false)
  await update.dispose()
  assert.equal(released, 1)
})

test("unsaved conflicts and cancelled native confirmation prevent installation or relaunch", async () => {
  const calls = []
  const update = { install: async () => { calls.push("install"); return false } }
  const relaunch = async () => calls.push("relaunch")
  assert.equal(await installDesktopUpdate(update, { prepare: async () => false, relaunch }), false)
  assert.deepEqual(calls, [])
  assert.equal(await installDesktopUpdate(update, { relaunch }), false)
  assert.deepEqual(calls, ["install"])
})

test("verified updates relaunch after download and installation", async () => {
  const sequence = []
  const update = { install: async () => sequence.push("installed") }
  await installDesktopUpdate(update, { relaunch: async () => sequence.push("relaunch") })
  assert.deepEqual(sequence, ["installed", "relaunch"])
  await assert.rejects(
    installDesktopUpdate(null, { relaunch: async () => {} }),
    error => error.code === "invalid_input"
  )
})

test("startup update checks wait until the editor is idle and run once", async () => {
  let busy = true
  let runTimer
  let scheduledDelay
  let checks = 0
  const updateCheck = createIdleUpdateCheck(async () => { checks += 1 }, () => busy, {
    setTimer(callback, delay) {
      runTimer = callback
      scheduledDelay = delay
      return 1
    },
    clearTimer() { runTimer = null }
  })

  updateCheck.schedule(10_000)
  assert.equal(scheduledDelay, 10_000)
  runTimer()
  assert.equal(checks, 0)
  busy = false
  assert.equal(await updateCheck.resume(), true)
  assert.equal(await updateCheck.resume(), false)
  assert.equal(checks, 1)
})

test("manual update checks cancel a pending startup check", () => {
  let runTimer
  let checks = 0
  const updateCheck = createIdleUpdateCheck(async () => { checks += 1 }, () => false, {
    setTimer(callback) { runTimer = callback; return 1 },
    clearTimer() { runTimer = null }
  })

  updateCheck.schedule(10_000)
  updateCheck.cancel()
  assert.equal(runTimer, null)
  assert.equal(checks, 0)
})

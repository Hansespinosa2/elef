import assert from "node:assert/strict"
import test from "node:test"

import { checkForDesktopUpdate, createIdleUpdateCheck, installDesktopUpdate } from "../src/update-flow.js"

test("background staging distinguishes no update from a persisted available update", async () => {
  assert.equal(await checkForDesktopUpdate(async () => null), null)
  const result = await checkForDesktopUpdate(async () => ({ version: "1.2.0", notes: "Fixes" }))
  assert.deepEqual({ version: result.version, notes: result.notes }, { version: "1.2.0", notes: "Fixes" })
})

test("failed safe-quit revalidation never relaunches", async () => {
  let relaunched = false
  const update = { version: "1.2.0" }
  assert.equal(await installDesktopUpdate(update, {
    install: async version => {
      assert.equal(version, "1.2.0")
      throw new Error("safe version feed unavailable")
    },
    relaunch: async () => { relaunched = true }
  }).catch(() => false), false)
  assert.equal(relaunched, false)
})

test("a deferred installer does not relaunch", async () => {
  const calls = []
  const update = { version: "1.2.0" }
  const relaunch = async () => calls.push("relaunch")
  assert.equal(await installDesktopUpdate(update, { install: async () => { calls.push("install"); return false }, relaunch }), false)
  assert.deepEqual(calls, ["install"])
})

test("verified staged updates relaunch after safe-quit installation", async () => {
  const sequence = []
  const update = { version: "1.2.0" }
  await installDesktopUpdate(update, {
    install: async version => { sequence.push(`installed:${version}`) },
    relaunch: async () => sequence.push("relaunch")
  })
  assert.deepEqual(sequence, ["installed:1.2.0", "relaunch"])
  await assert.rejects(installDesktopUpdate(null, { install: async () => {}, relaunch: async () => {} }), error => error.code === "invalid_input")
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

test("successful update checks repeat after the configured interval", async () => {
  const timers = []
  let checks = 0
  const updateCheck = createIdleUpdateCheck(async () => { checks += 1 }, () => false, {
    repeatDelayMs: 60_000,
    setTimer(callback, delay) { timers.push({ callback, delay }); return timers.length },
    clearTimer() {}
  })
  updateCheck.schedule(10)
  timers[0].callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 1)
  assert.equal(timers[1].delay, 60_000)
  timers[1].callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 2)
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

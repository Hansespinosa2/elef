import assert from "node:assert/strict"
import test from "node:test"

import { checkForDesktopUpdate, installDesktopUpdate } from "../src/update-flow.js"

test("update checks distinguish no update from an announced available update", async () => {
  assert.equal(await checkForDesktopUpdate(async () => null), null)

  let progress
  const result = await checkForDesktopUpdate(async () => ({
    version: "1.2.0",
    body: "Fixes",
    downloadAndInstall: async callback => {
      callback({ event: "Progress", data: { chunkLength: 10 } })
    }
  }))
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
    close: async () => { released += 1 },
    downloadAndInstall: async () => { throw error }
  }))
  await assert.rejects(installDesktopUpdate(update, {
    relaunch: async () => { relaunched = true }
  }), error)
  assert.equal(relaunched, false)
  await update.dispose()
  assert.equal(released, 1)
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

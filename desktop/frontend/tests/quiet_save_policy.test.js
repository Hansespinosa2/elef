import assert from "node:assert/strict"
import test from "node:test"

import { QUIET_SAVE_DISK_BUDGET_MS, createQuietSavePolicy } from "../src/quiet_save_policy.js"

test("quiet-save policy keeps the autosave delay inside the disk budget", () => {
  const policy = createQuietSavePolicy()
  assert.equal(policy.saveDelay, 2000)
  assert.equal(policy.externalPollMs, 1000)
  assert.ok(policy.saveDelay < QUIET_SAVE_DISK_BUDGET_MS)
})

test("quiet-save policy accepts overrides and rejects non-positive cadences", () => {
  assert.deepEqual(createQuietSavePolicy({ saveDelay: 500 }), { saveDelay: 500, externalPollMs: 1000 })
  assert.throws(() => createQuietSavePolicy({ saveDelay: 0 }), TypeError)
  assert.throws(() => createQuietSavePolicy({ saveDelay: -1 }), TypeError)
  assert.throws(() => createQuietSavePolicy({ externalPollMs: 0 }), TypeError)
  assert.throws(() => createQuietSavePolicy({ externalPollMs: Number.NaN }), TypeError)
})

import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { makeCanonicalScratch } from "./identity-scratch.js"

test("identity scratch resolves symlinked bases like the Rust library store does", () => {
  const farm = mkdtempSync(path.join(realpathSync(tmpdir()), "elef-scratch-farm-"))
  try {
    const target = path.join(farm, "target")
    mkdirSync(target, { recursive: true })
    const link = path.join(farm, "link")
    symlinkSync(target, link, "dir")
    const scratch = makeCanonicalScratch("elef-identity-test-", link)
    assert.equal(scratch, realpathSync(scratch))
    assert.ok(!scratch.startsWith(`${link}${path.sep}`), "the scratch path must not keep the symlinked base")
    assert.ok(scratch.startsWith(`${target}${path.sep}`), "the scratch path must live under the resolved base")
  } finally {
    rmSync(farm, { recursive: true, force: true })
  }
})

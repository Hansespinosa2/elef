import assert from "node:assert/strict"
import test from "node:test"
import { confirmAppReady } from "./packaged-update-smoke.js"

test("packaged app readiness retries until the frontend acknowledges the native ready command", async () => {
  const scripts = []
  let readinessChecks = 0
  await confirmAppReady(async script => {
    scripts.push(script)
    assert.match(script, /nativeReadyAt/)
    return ++readinessChecks === 2
  }, 1_000)

  assert.equal(readinessChecks, 2)
  assert.equal(scripts.length, 2)
})

test("Stable WebDriver config points at the checked-in exclusion scenario", async () => {
  const { readFile, stat } = await import("node:fs/promises")
  const { fileURLToPath } = await import("node:url")
  const configPath = new URL("./wdio.conf.js", import.meta.url)
  const config = await readFile(configPath, "utf8")
  assert.match(config, /\["\.\/stable-exclusions\.spec\.js"\]/)
  await stat(fileURLToPath(new URL("./stable-exclusions.spec.js", import.meta.url)))
})

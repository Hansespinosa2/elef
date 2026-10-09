import assert from "node:assert/strict"
import test from "node:test"
import { confirmAppReady } from "./packaged-update-smoke.js"

test("packaged app readiness retries until the Tauri bridge is available", async () => {
  const scripts = []
  let bridgeChecks = 0
  await confirmAppReady(async script => {
    scripts.push(script)
    if (script.includes("Boolean(window.__TAURI__")) return ++bridgeChecks === 2
    return "ready"
  }, 1_000)

  assert.equal(bridgeChecks, 2)
  assert.equal(scripts.length, 3)
  assert.match(scripts.at(-1), /confirm_app_ready/)
})

test("Stable WebDriver config points at the checked-in exclusion scenario", async () => {
  const { readFile, stat } = await import("node:fs/promises")
  const { fileURLToPath } = await import("node:url")
  const configPath = new URL("./wdio.conf.js", import.meta.url)
  const config = await readFile(configPath, "utf8")
  assert.match(config, /\["\.\/stable-exclusions\.spec\.js"\]/)
  await stat(fileURLToPath(new URL("./stable-exclusions.spec.js", import.meta.url)))
})

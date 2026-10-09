import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const config = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url)))
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)))

test("Tauri dev and production builds both rebuild the Rails-owned frontend", () => {
  const frontendBuild = "cd ../frontend && npm run build"
  assert.equal(config.build.beforeDevCommand.script, frontendBuild)
  assert.equal(config.build.beforeDevCommand.wait, true)
  assert.equal(config.build.beforeBuildCommand, frontendBuild)
  assert.match(packageJson.scripts["tauri:dev"], /tauri dev$/)
  assert.doesNotMatch(packageJson.scripts["tauri:dev"], /npm run build/)
})

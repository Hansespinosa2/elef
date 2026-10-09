import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const config = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url)))
const devConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.dev.conf.json", import.meta.url)))
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)))

test("Tauri Stable and repository Dev builds rebuild their Rails-owned frontend profiles", () => {
  const frontendBuild = "cd ../frontend && npm run build"
  assert.equal(config.build.beforeDevCommand.script, frontendBuild)
  assert.equal(config.build.beforeDevCommand.wait, true)
  assert.equal(config.build.beforeBuildCommand, frontendBuild)
  const devFrontendBuild = `${frontendBuild} -- --profile=dev`
  assert.equal(devConfig.build.beforeDevCommand.script, devFrontendBuild)
  assert.equal(devConfig.build.beforeDevCommand.wait, true)
  assert.equal(devConfig.build.beforeBuildCommand, devFrontendBuild)
  assert.match(packageJson.scripts["tauri:dev"], /tauri dev --features desktop-dev --config src-tauri\/tauri\.dev\.conf\.json$/)
  assert.equal(devConfig.build.frontendDist, "../frontend/dist-dev")
  assert.equal(devConfig.bundle.active, false)
})

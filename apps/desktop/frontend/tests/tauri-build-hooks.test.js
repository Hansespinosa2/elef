import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const config = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url)))
const devConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.dev.conf.json", import.meta.url)))
const e2eConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.e2e.conf.json", import.meta.url)))
const stableConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.e2e-stable.conf.json", import.meta.url)))
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)))

test("Tauri dev and production builds both rebuild the shared frontend", () => {
  const frontendBuild = "cd ../frontend && npm run build"
  assert.equal(config.build.beforeDevCommand.script, frontendBuild)
  assert.equal(config.build.beforeDevCommand.wait, true)
  assert.equal(config.build.beforeBuildCommand, frontendBuild)
  assert.match(packageJson.scripts["tauri:dev"], /--features desktop-dev/)
  assert.match(packageJson.scripts["tauri:dev"], /--config src-tauri\/tauri\.dev\.conf\.json/)
  assert.doesNotMatch(packageJson.scripts["tauri:dev"], /npm run build/)
  assert.equal(devConfig.build.beforeDevCommand, "cd ../frontend && npm run build -- --profile=dev")
})

test("The desktop entry points keep their release-guard rails", () => {
  assert.equal(config.bundle.active, true)
  assert.equal(devConfig.bundle.active, false)
  assert.equal(e2eConfig.productName, "Elef E2E")
  assert.equal(e2eConfig.identifier, "com.elef.desktop.e2e")
  assert.equal(e2eConfig.build.frontendDist, "../frontend/dist-e2e")
  assert.deepEqual(e2eConfig.plugins.updater.endpoints, ["http://127.0.0.1:8888/manifest"])
  assert.equal(e2eConfig.plugins.updater.requireSignedVersion, true)
  assert.equal(e2eConfig.plugins.updater.dangerousInsecureTransportProtocol, true)
  assert.equal(stableConfig.identifier, "com.elef.desktop.e2e.stable")
  assert.equal(stableConfig.build.frontendDist, "../frontend/dist-e2e-stable")
  assert.equal(stableConfig.bundle.active, false)
  assert.deepEqual(stableConfig.app.security.capabilities, ["main-capability", "e2e-stable-webdriver"])
  assert.deepEqual(stableConfig.plugins.updater.endpoints, [])
})

test("Dev, E2E, and Stable E2E builds keep distinct identities and frontends", () => {
  assert.equal(config.identifier, "com.elef.desktop")
  assert.equal(devConfig.identifier, "com.elef.desktop.dev")
  assert.equal(devConfig.build.frontendDist, "../frontend/dist-dev")
  assert.deepEqual(devConfig.app.security.capabilities, ["main-dev-capability"])
  assert.deepEqual(devConfig.plugins.updater.endpoints, [])
  assert.deepEqual(e2eConfig.app.security.capabilities, ["main-dev-capability", "e2e-webdriver"])
  const frontendDists = new Set([
    config.build.frontendDist,
    devConfig.build.frontendDist,
    e2eConfig.build.frontendDist,
    stableConfig.build.frontendDist
  ])
  assert.equal(frontendDists.size, 4)
})

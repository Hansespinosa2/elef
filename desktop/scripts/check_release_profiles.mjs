import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const frontendRoot = path.join(repoRoot, "desktop/frontend")
const inventoryPath = path.join(repoRoot, "test/fixtures/desktop/release-exclusions.json")
const stableMetafilePath = path.join(frontendRoot, "dist/assets/app.metafile.json")
const devMetafilePath = path.join(frontendRoot, "dist-dev/assets/app.metafile.json")
const tauriRoot = path.join(repoRoot, "desktop/src-tauri")

const inventory = JSON.parse(await readFile(inventoryPath, "utf8"))
assert.equal(inventory.schema_version, 1, "unsupported release exclusion inventory schema")
assert.equal(inventory.profile, "stable", "the exclusion inventory must describe Stable")
assert.ok(Array.isArray(inventory.excluded_features) && inventory.excluded_features.length > 0)
assert.ok(Array.isArray(inventory.shared_exceptions))

const [stable, dev] = await Promise.all([
  readMetafile(stableMetafilePath, "Stable"),
  readMetafile(devMetafilePath, "Dev")
])
const [stableConfig, devConfig, e2eConfig, stableCapability, devCapability, macUpdaterCapability, nativeSource, buildSource, packageConfig] = await Promise.all([
  readJson(path.join(tauriRoot, "tauri.conf.json")),
  readJson(path.join(tauriRoot, "tauri.dev.conf.json")),
  readJson(path.join(tauriRoot, "tauri.e2e.conf.json")),
  readJson(path.join(tauriRoot, "capabilities/main.json")),
  readJson(path.join(tauriRoot, "capabilities/main-dev.json")),
  readJson(path.join(tauriRoot, "capabilities/macos-updater.json")),
  readFile(path.join(tauriRoot, "src/lib.rs"), "utf8"),
  readFile(path.join(tauriRoot, "build.rs"), "utf8"),
  readJson(path.join(frontendRoot, "package.json"))
])
const stableInputs = normalizeInputs(stable)
const devInputs = normalizeInputs(dev)

assert.equal(stableConfig.identifier, "com.elef.desktop", "Stable must retain its existing Tauri identifier")
assert.equal(devConfig.identifier, "com.elef.desktop.dev", "repository Dev needs a separate app-data and single-instance identity")
assert.equal(e2eConfig.identifier, "com.elef.desktop.e2e", "E2E must use disposable app state")
assert.equal(devConfig.bundle?.active, false, "repository Dev must not produce an installable bundle")
assert.equal(devConfig.build.frontendDist, "../frontend/dist-dev")
assert.deepEqual(devConfig.app.security.capabilities, ["main-dev-capability"])
assert.deepEqual(stableConfig.app.security.capabilities, ["main-capability", "macos-updater-capability"])
assert.deepEqual(e2eConfig.app.security.capabilities, ["main-dev-capability", "e2e-webdriver"])
assert.deepEqual(devConfig.plugins.updater.endpoints, [], "Dev must not inherit the public Stable update feed")
assert.match(packageConfig.scripts["tauri:dev"], /--features desktop-dev --config src-tauri\/tauri\.dev\.conf\.json/)
assert.match(nativeSource, /#\[cfg\(feature = "desktop-dev"\)\]\s+#\[tauri::command\]\s+fn document_graph/)
assert.match(nativeSource, /#\[cfg\(any\(target_os = "macos", feature = "webdriver"\)\)\]\s+#\[tauri::command\]\s+async fn install_update/)
assert.match(buildSource, /desktop_dev, has_update_command/)
assert.match(nativeSource, /app\.path\(\)\.app_data_dir\(\)\?\.join\("library-root\.json"\)/)
assert.match(nativeSource, /tauri_plugin_single_instance::init/)
assert.match(await readFile(path.join(frontendRoot, "build.mjs"), "utf8"), /profile === "stable" && process\.platform === "darwin"/, "only Stable macOS builds may select the native updater module")
assert.match(await readFile(path.join(frontendRoot, "src/update-runtime-macos.js"), "utf8"), /@tauri-apps\/plugin-updater/)
assert.doesNotMatch(await readFile(path.join(frontendRoot, "src/main.js"), "utf8"), /@tauri-apps\/(?:plugin-updater|plugin-process)/)
const updaterModulePresent = inputs => [...inputs].some(input => input.includes("@tauri-apps/plugin-updater") || input.includes("@tauri-apps/plugin-process"))
assert.equal(updaterModulePresent(stableInputs), process.platform === "darwin", "only Stable on macOS may bundle Tauri updater modules")
assert.ok(!updaterModulePresent(devInputs), "repository Dev must not bundle Tauri updater modules")

const commandPermissions = permissions => new Set(permissions.filter(permission => permission.startsWith("allow-") && !permission.startsWith("core:")).map(permission => permission.slice("allow-".length)))
const stableCommands = commandPermissions(stableCapability.permissions)
const devCommands = commandPermissions(devCapability.permissions)
const macUpdaterCommands = commandPermissions(macUpdaterCapability.permissions)
for (const feature of inventory.excluded_features) {
  for (const command of feature.native_commands || []) {
    assert.ok(!stableCommands.has(command.replaceAll("_", "-")), `Stable capability grants excluded native command ${command}`)
    assert.ok(devCommands.has(command.replaceAll("_", "-")), `Dev capability must retain experimental command ${command}`)
  }
}
assert.deepEqual(macUpdaterCapability.platforms, ["macOS"], "only macOS may receive updater command permissions")
assert.deepEqual(macUpdaterCommands, new Set(["install-update"]))
assert.ok(!devCapability.permissions.some(permission => permission.startsWith("updater:") || permission === "process:allow-restart"))
assert.ok(!stableCapability.permissions.includes("allow-install-update"))

for (const feature of inventory.excluded_features) {
  assert.ok(feature.id && feature.negative_scenario, "each exclusion needs an id and a runtime negative scenario")
  for (const input of feature.module_inputs || []) {
    assert.ok(!stableInputs.has(input), `Stable bundle contains excluded module ${input} (${feature.id})`)
  }
  for (const controller of feature.controllers || []) {
    const input = `app/javascript/controllers/${controller}.js`
    assert.ok(devInputs.has(input), `Dev bundle is missing experimental controller ${input} (${feature.id})`)
  }
  for (const command of feature.native_commands || []) {
    assert.ok(typeof command === "string" && command.length > 0, `invalid native command in ${feature.id}`)
  }
}

for (const exception of inventory.shared_exceptions) {
  assert.ok(exception.module_input && exception.dependent_retained_feature, "each shared exception must explain its dependency")
  assert.ok(exception.stable_constraint && exception.negative_scenario, `shared exception ${exception.module_input} needs a Stable constraint and negative test`)
  if (exception.artifact_path) {
    const [source, artifact] = await Promise.all([
      readFile(path.join(repoRoot, exception.module_input)),
      readFile(path.join(repoRoot, exception.artifact_path))
    ])
    assert.ok(source.equals(artifact), `copied shared artifact differs from its Rails-owned source: ${exception.module_input}`)
  } else {
    assert.ok(stableInputs.has(exception.module_input), `documented shared exception is absent from Stable: ${exception.module_input}`)
  }
}

const stableTransport = await readFile(path.join(frontendRoot, "src/file-library-transport-stable.js"), "utf8")
const devTransport = await readFile(path.join(frontendRoot, "src/file-library-transport.js"), "utf8")
assert.doesNotMatch(stableTransport, /document_graph/)
assert.match(devTransport, /invoke\("document_graph"\)/)

process.stdout.write(
  `Stable/Dev profile graph passed: ${stableInputs.size} Stable inputs, ${devInputs.size} Dev inputs, ` +
  `${inventory.excluded_features.length} exclusions and ${inventory.shared_exceptions.length} shared exceptions.\n`
)

async function readMetafile(filePath, profile) {
  let value
  try {
    value = JSON.parse(await readFile(filePath, "utf8"))
  } catch (error) {
    throw new Error(`Build the ${profile} frontend before checking its release profile (${filePath}): ${error.message}`)
  }
  assert.ok(value.inputs && Object.keys(value.inputs).length > 0, `${profile} metafile has no inputs`)
  return value
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"))
}

function normalizeInputs(metafile) {
  return new Set(Object.keys(metafile.inputs).map(input => path.relative(repoRoot, path.resolve(frontendRoot, input))))
}

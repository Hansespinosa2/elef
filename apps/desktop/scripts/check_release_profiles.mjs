import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Stable/Dev profile gate: proves the release exclusion inventory against
// the built artifacts. Slice absence comes from the packages' own Stable
// metafiles (each Stable entry never imports the excluded slices, and
// esbuild lists even tree-shaken inputs, so absence is proof of no static
// edge); profile selection comes from the desktop bundle metafiles; IPC
// denial comes from capabilities plus cfg gating; UI negatives come from
// the Stable exclusions spec (asserted statically here, exercised in CI).
// Run the package and desktop frontend builds first; bin/check affected
// builds them before this checker.
const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptRoot, "../../..")
const readText = relativePath => readFileSync(path.join(repoRoot, relativePath), "utf8")
const readJson = relativePath => JSON.parse(readText(relativePath))

const inventory = readJson("apps/web/test/fixtures/desktop/release-exclusions.json")
assert.equal(inventory.schema_version, 1, "release-exclusions.json must stay on schema version 1")
assert.equal(inventory.profile, "stable", "the release exclusion inventory must describe the Stable profile")
for (const feature of [...inventory.excluded_features, ...inventory.flag_features]) {
  assert.ok(Array.isArray(feature.proof) && feature.proof.length > 0, `exclusion ${feature.id} must label its proof`)
}

function metafileInputs(relativePath, baseDir) {
  const absolute = path.join(repoRoot, relativePath)
  assert.ok(
    existsSync(absolute),
    `${relativePath} is missing; build the profile packages and frontends first (bin/check affected builds them).`
  )
  const metafile = JSON.parse(readFileSync(absolute, "utf8"))
  return new Set(Object.keys(metafile.inputs).map(input => {
    const resolved = path.resolve(repoRoot, baseDir, input)
    return path.relative(repoRoot, resolved).split(path.sep).join(path.posix.sep)
  }))
}

function metafileOutputs(relativePath) {
  const absolute = path.join(repoRoot, relativePath)
  assert.ok(existsSync(absolute), `${relativePath} is missing; build the profile frontends first.`)
  return Object.keys(JSON.parse(readFileSync(absolute, "utf8")).outputs)
}

const { verification } = inventory
const stableInputs = metafileInputs(verification.stable_metafile, "apps/desktop/frontend")
const devInputs = metafileInputs(verification.dev_metafile, "apps/desktop/frontend")
const stableClientInputs = metafileInputs(verification.package_metafiles.client.stable, "packages/client")
const devClientInputs = metafileInputs(verification.package_metafiles.client.dev, "packages/client")
const stableEditorInputs = metafileInputs(verification.package_metafiles["editor-runtime"].stable, "packages/editor-runtime")
const devEditorInputs = metafileInputs(verification.package_metafiles["editor-runtime"].dev, "packages/editor-runtime")
const stableWorkModelInputs = metafileInputs(verification.package_metafiles["work-model"].stable, "packages/work-model")

function packageMetafiles(modulePath) {
  if (modulePath.startsWith("packages/client/src/")) {
    return { stable: stableClientInputs, dev: devClientInputs, owner: "client" }
  }
  if (modulePath.startsWith("packages/editor-runtime/src/")) {
    return { stable: stableEditorInputs, dev: devEditorInputs, owner: "editor-runtime" }
  }
  if (modulePath.startsWith("packages/work-model/src/")) {
    return { stable: stableWorkModelInputs, dev: null, owner: "work-model" }
  }
  throw new Error(`module_inputs entry ${modulePath} is outside the profile-split packages`)
}

for (const feature of inventory.excluded_features) {
  for (const modulePath of feature.module_inputs) {
    const { stable, dev } = packageMetafiles(modulePath)
    assert.ok(!stable.has(modulePath), `Stable ships the excluded slice ${modulePath} (${feature.id})`)
    if (dev) {
      assert.ok(dev.has(modulePath), `Dev lost the retained slice ${modulePath}; the exclusion must be profile-scoped, not a deletion`)
    }
  }
}

// The work-model barrel keeps subpath slices external, so its Dev presence
// proof is source-level: the Dev barrel re-exports the link module while
// the Stable barrel and dist carry no such reference.
const workModelBarrel = readText("packages/work-model/src/index.ts")
const workModelStableBarrel = readText("packages/work-model/src/index.stable.ts")
assert.ok(workModelBarrel.includes("@elef/work-model/document-links"), "the Dev work-model barrel must re-export the link module")
assert.ok(!workModelStableBarrel.includes("document-links"), "the Stable work-model barrel must not reference the link module")
assert.ok(readText("packages/work-model/dist/elef-work-model.js").includes("document-links"), "the Dev work-model dist must reference the link slice")
assert.ok(!readText("packages/work-model/dist/elef-work-model.stable.js").includes("document-links"), "the Stable work-model dist must not reference the link slice")

// Excluded Stimulus controllers register only in the Dev registration
// source; the Stable registration source must never name them.
const devRegistration = readText("packages/editor-runtime/src/lib/editor_runtime.ts")
const stableRegistration = readText("packages/editor-runtime/src/lib/editor_runtime_stable.ts")
for (const feature of inventory.excluded_features) {
  for (const identifier of feature.controllers) {
    assert.ok(
      devRegistration.includes(`register("${identifier}"`),
      `Dev registration lost the ${identifier} controller; the exclusion must be profile-scoped`
    )
    assert.ok(
      !stableRegistration.includes(`register("${identifier}"`),
      `Stable registration mounts the excluded ${identifier} controller`
    )
  }
}

// Shared exceptions stay reachable from Stable: the retained shell, the
// source editor, the sanitizer chunk, and the canonical renderer.
assert.ok(
  stableEditorInputs.has("packages/editor-runtime/src/lib/editor_view.ts"),
  "Stable lost the retained editor shell"
)
assert.ok(
  stableEditorInputs.has("packages/editor-runtime/src/controllers/editor_controller.ts"),
  "Stable lost the retained source editor"
)
assert.ok(
  stableInputs.has("packages/client/dist/sanitize.js"),
  "Stable lost the shared sanitizer chunk"
)
assert.deepEqual(
  readFileSync(path.join(repoRoot, "packages/renderer/dist/elef-renderer.bundle.js")),
  readFileSync(path.join(repoRoot, "apps/desktop/frontend/dist/assets/renderer.bundle.js")),
  "Stable must copy the canonical renderer bundle byte-identically"
)
const stableChunks = metafileOutputs(verification.stable_metafile).filter(output => output.includes("chunks/preview-core-"))
const devChunks = metafileOutputs(verification.dev_metafile).filter(output => output.includes("chunks/preview-core-"))
assert.equal(stableChunks.length, 1, "Stable must emit the deferred preview-core chunk")
assert.deepEqual(stableChunks, devChunks.map(chunk => chunk.replace("dist-dev/", "dist/")), "the deferred preview chunk must be profile-independent")

// The Stable desktop bundle resolves the bare workspace specifiers to the
// Stable dists and the profile-selected modules to the Stable variants;
// the Dev bundle resolves everything to the full surface.
for (const dist of [
  "packages/editor-runtime/dist/index.stable.js",
  "packages/client/dist/port-session.js",
  "packages/client/dist/sanitize.js",
  "packages/client/dist/vim-preferences.js",
  "packages/work-model/dist/document-map.js",
  "packages/work-model/dist/document-transforms.js"
]) {
  assert.ok(stableInputs.has(dist), `Stable desktop bundle lost the shared input ${dist}`)
}
for (const dist of [
  "packages/editor-runtime/dist/index.js",
  "packages/client/dist/elef-client.js",
  "packages/client/dist/elef-client.stable.js",
  "packages/work-model/dist/elef-work-model.js",
  "packages/work-model/dist/document-links.js"
]) {
  assert.ok(!stableInputs.has(dist), `Stable desktop bundle references the Dev-only input ${dist}`)
}
for (const module of [
  "apps/desktop/frontend/src/file-library-transport-base.js",
  "apps/desktop/frontend/src/file-library-transport-stable.js",
  "apps/desktop/frontend/src/editor-runtime-stable.js",
  "apps/desktop/frontend/src/document-graph-runtime-stable.js"
]) {
  assert.ok(stableInputs.has(module), `Stable desktop bundle lost the Stable module ${module}`)
}
for (const module of [
  "apps/desktop/frontend/src/file-library-transport.js",
  "apps/desktop/frontend/src/editor-runtime-dev.js",
  "apps/desktop/frontend/src/document-graph-runtime-dev.js"
]) {
  assert.ok(!stableInputs.has(module), `Stable desktop bundle references the Dev-only module ${module}`)
}
for (const dist of [
  "packages/editor-runtime/dist/index.js",
  "packages/client/dist/elef-client.js",
  "packages/work-model/dist/elef-work-model.js",
  "packages/work-model/dist/document-links.js"
]) {
  assert.ok(devInputs.has(dist), `Dev desktop bundle lost the full-surface input ${dist}`)
}
for (const input of [...devInputs]) {
  assert.ok(!input.includes(".stable.js") && !input.endsWith("-stable.js"), `Dev desktop bundle references the Stable-only input ${input}`)
}

// The Stable shell opens works in source mode; Dev keeps the visual default.
assert.ok(
  readText(verification.stable_frontend).includes('data-editor-mode="source"'),
  "the Stable shell must default to source mode"
)
assert.ok(
  !readText(verification.stable_frontend).includes('data-editor-mode="visual"'),
  "the Stable shell must not carry the visual default"
)
assert.ok(
  readText(verification.dev_frontend).includes('data-editor-mode="visual"'),
  "the Dev shell must keep the visual default"
)

// IPC denial: the Stable production capability never grants the graph
// command; the Dev capability adds exactly that command.
const stableAcl = readJson(verification.stable_command_acl)
const devAcl = readJson("apps/desktop/src-tauri/capabilities/main-dev.json")
const stableE2eAcl = readJson("apps/desktop/src-tauri/capabilities/e2e-stable.json")
assert.ok(!stableAcl.permissions.includes("allow-document-graph"), "the Stable capability must not grant the graph command")
assert.ok(devAcl.permissions.includes("allow-document-graph"), "the Dev capability must grant the graph command")
assert.deepEqual(
  [...devAcl.permissions].sort(),
  [...stableAcl.permissions, "allow-document-graph"].sort(),
  "the Dev capability must equal Stable plus exactly the graph command"
)
assert.deepEqual(
  stableE2eAcl.permissions,
  ["core:default", "core:window:allow-set-fullscreen", "core:window:allow-version", "allow-export-diagnostics-fixture"],
  "the Stable e2e capability must carry only the WebDriver surface plus the diagnostics fixture"
)

// Native gating: the graph command exists only under desktop-dev, and the
// build manifest gates the same matrix the handler registration implements.
const buildSource = readText("apps/desktop/src-tauri/build.rs")
assert.ok(buildSource.includes("(desktop_dev, webdriver)"), "build.rs must gate commands on the desktop-dev and webdriver matrix")
assert.ok(
  buildSource.includes('command_list!("document_graph", "export_diagnostics_fixture")'),
  "build.rs must grant the graph command to the Dev e2e matrix cell"
)
assert.ok(
  buildSource.includes('command_list!("document_graph")'),
  "build.rs must grant the graph command to the Dev matrix cell"
)
assert.equal(
  buildSource.match(/command_list!\([^)]*"document_graph"/g)?.length || 0,
  2,
  "build.rs must grant the graph command in exactly the two Dev matrix cells"
)
const workFoldersSource = readText("apps/desktop/src-tauri/src/work_folders.rs")
assert.ok(
  workFoldersSource.includes('#[cfg(feature = "desktop-dev")]\n#[tauri::command]\n') &&
    workFoldersSource.includes("pub(crate) fn document_graph("),
  "the graph command must exist only under desktop-dev"
)
const nativeSource = readText("apps/desktop/src-tauri/src/lib.rs")
for (const arm of [
  '#[cfg(all(feature = "desktop-dev", feature = "webdriver"))]\n    let builder = builder.invoke_handler(app_commands!(document_graph, export_diagnostics_fixture));',
  '#[cfg(all(feature = "desktop-dev", not(feature = "webdriver")))]\n    let builder = builder.invoke_handler(app_commands!(document_graph));',
  '#[cfg(all(not(feature = "desktop-dev"), feature = "webdriver"))]\n    let builder = builder.invoke_handler(app_commands!(export_diagnostics_fixture));',
  '#[cfg(all(not(feature = "desktop-dev"), not(feature = "webdriver")))]\n    let builder = builder.invoke_handler(app_commands!());'
]) {
  assert.ok(nativeSource.includes(arm), `lib.rs lost a handler matrix arm: ${arm.split("\n")[0]}`)
}
const cargoManifest = readText("apps/desktop/src-tauri/Cargo.toml")
assert.ok(cargoManifest.includes("desktop-dev = []"), "Cargo.toml must declare the desktop-dev feature")
assert.ok(
  readText("apps/desktop/src-tauri/src/diagnostics.rs").includes('cfg!(feature = "desktop-dev")'),
  "diagnostics must report the Dev profile only under desktop-dev"
)

// Transport split: the Stable transport omits the graph reader while the
// Dev transport keeps it on top of the shared base.
const stableTransport = readText("apps/desktop/frontend/src/file-library-transport-stable.js")
const devTransport = readText("apps/desktop/frontend/src/file-library-transport.js")
assert.ok(!stableTransport.includes("document_graph"), "the Stable transport must not reference the graph command")
assert.ok(devTransport.includes('invoke("document_graph")'), "the Dev transport must keep the graph reader")
assert.ok(
  readText("apps/desktop/frontend/src/file-library-transport-base.js").includes("export_diagnostics"),
  "the shared transport base must keep the diagnostics command"
)

// Desktop entry contract: the shell boots through the profile-selected
// modules and hands the shared application its profile inputs.
const desktopMain = readText("apps/desktop/frontend/src/main.js")
for (const module of ["#desktop/file-library-transport", "#desktop/editor-runtime", "#desktop/document-graph-runtime"]) {
  assert.ok(desktopMain.includes(`from "${module}"`), `main.js must boot through ${module}`)
}
for (const input of ["profile: desktopProfile", "features: desktopFeatures", "featureFlags: desktopFeatureFlags", "documentGraphRuntime", "presentationEditorRuntime"]) {
  assert.ok(desktopMain.includes(input), `main.js must pass ${input} to the shared application`)
}
const desktopProfile = readText("apps/desktop/frontend/src/desktop-profile.js")
for (const flag of ["visualEditing: devEnabled", "presentationEditing: devEnabled", "slideOverview: devEnabled", "documentGraph: devEnabled", "documentLinks: devEnabled"]) {
  assert.ok(desktopProfile.includes(flag), `desktop-profile.js must derive the ${flag} feature from the profile`)
}
assert.ok(desktopProfile.includes("ELEF_ENABLE_REVISIONS: devEnabled"), "desktop-profile.js must derive the revisions flag from the profile")
assert.ok(desktopProfile.includes("ELEF_ENABLE_LINEAGE: devEnabled"), "desktop-profile.js must derive the lineage flag from the profile")
assert.ok(desktopProfile.includes('desktopProfile !== "stable"'), "desktop-profile.js must treat every non-stable profile as Dev")

// Build contract: profile selection, output split, Stable dist resolution,
// profile defines, metafiles, and the Stable shell default.
const desktopBuild = readText("apps/desktop/frontend/build.mjs")
assert.ok(desktopBuild.includes('process.env.ELEF_DESKTOP_PROFILE || profileArgument || separatedProfileArgument || (e2eBuild ? "dev" : "stable")'), "build.mjs must resolve the profile from env, then flags, then e2e-default-dev")
assert.ok(desktopBuild.includes('"dist-e2e-stable"'), "build.mjs must emit the Stable e2e output")
assert.ok(desktopBuild.includes('"dist-dev"'), "build.mjs must emit the Dev output")
assert.ok(desktopBuild.includes("elef-client.stable.js"), "build.mjs must resolve the Stable client dist")
assert.ok(desktopBuild.includes("index.stable.js"), "build.mjs must resolve the Stable editor-runtime dist")
assert.ok(desktopBuild.includes("elef-work-model.stable.js"), "build.mjs must resolve the Stable work-model dist")
assert.ok(desktopBuild.includes("__ELEF_DESKTOP_PROFILE__"), "build.mjs must define the profile for the bundle")
assert.ok(desktopBuild.includes("app.metafile.json"), "build.mjs must persist the bundle metafile")
assert.ok(desktopBuild.includes('data-editor-mode="source"'), "build.mjs must flip the Stable shell default to source mode")

// Config matrix: distinct app identities per profile, bundling off for the
// dev/e2e shapes, and the matching frontend outputs and capabilities.
const productionConf = readJson("apps/desktop/src-tauri/tauri.conf.json")
const devConf = readJson("apps/desktop/src-tauri/tauri.dev.conf.json")
const e2eConf = readJson("apps/desktop/src-tauri/tauri.e2e.conf.json")
const e2eStableConf = readJson("apps/desktop/src-tauri/tauri.e2e-stable.conf.json")
const e2eStableUpdaterConf = readJson("apps/desktop/src-tauri/tauri.e2e-stable-updater.conf.json")
const stableIdentityConf = readJson("apps/desktop/src-tauri/tauri.e2e-stable-identity.conf.json")
const devIdentityConf = readJson("apps/desktop/src-tauri/tauri.e2e-dev-identity.conf.json")
assert.equal(productionConf.identifier, "com.elef.desktop", "production must keep the Stable identifier")
assert.equal(devConf.identifier, "com.elef.desktop.dev", "the Dev config must take the .dev identifier")
assert.equal(e2eConf.identifier, "com.elef.desktop.e2e", "the Dev e2e config must take the .e2e identifier")
assert.equal(e2eStableConf.identifier, "com.elef.desktop.e2e.stable", "the Stable e2e config must take the .e2e.stable identifier")
assert.equal(stableIdentityConf.identifier, "com.elef.desktop", "the Stable identity probe must use the production identifier")
assert.equal(devIdentityConf.identifier, "com.elef.desktop.dev", "the Dev identity probe must use the Dev identifier")
assert.ok(!("identifier" in e2eStableUpdaterConf), "the Stable updater-fixture config must inherit the production identifier")
for (const [name, conf] of [["dev", devConf], ["e2e-stable", e2eStableConf], ["stable-identity", stableIdentityConf], ["dev-identity", devIdentityConf]]) {
  assert.equal(conf.bundle?.active, false, `the ${name} config must not bundle`)
}
assert.equal(e2eConf.productName, "Elef E2E", "the Dev e2e config must brand its bundle")
assert.equal(e2eStableConf.productName, "Elef E2E Stable", "the Stable e2e config must brand its bundle")
assert.equal(devConf.build.frontendDist, "../frontend/dist-dev", "the Dev config must serve the Dev frontend")
assert.equal(e2eStableConf.build.frontendDist, "../frontend/dist-e2e-stable", "the Stable e2e config must serve the Stable e2e frontend")
assert.equal(stableIdentityConf.build.frontendDist, "../frontend/dist-e2e-stable", "the Stable identity probe must serve the Stable e2e frontend")
assert.equal(devIdentityConf.build.frontendDist, "../frontend/dist-dev", "the Dev identity probe must serve the Dev frontend")
assert.deepEqual(devConf.app.security.capabilities, ["main-dev-capability"], "the Dev config must grant the Dev capability")
assert.deepEqual(e2eConf.app.security.capabilities, ["main-dev-capability", "e2e-webdriver"], "the Dev e2e config must grant Dev plus WebDriver")
assert.deepEqual(e2eStableConf.app.security.capabilities, ["main-capability", "e2e-stable-webdriver"], "the Stable e2e config must grant Stable plus the Stable WebDriver surface")
assert.deepEqual(stableIdentityConf.app.security.capabilities, ["main-capability", "e2e-stable-webdriver"], "the Stable identity probe must grant the Stable e2e surface")
assert.deepEqual(devIdentityConf.app.security.capabilities, ["main-dev-capability", "e2e-webdriver"], "the Dev identity probe must grant the Dev e2e surface")
for (const [name, conf] of [["dev", devConf], ["e2e-stable", e2eStableConf], ["stable-identity", stableIdentityConf], ["dev-identity", devIdentityConf]]) {
  assert.deepEqual(conf.plugins?.updater?.endpoints, [], `the ${name} config must disable the update channel`)
}
assert.deepEqual(e2eStableUpdaterConf.bundle?.targets, ["app", "dmg"], "the Stable updater-fixture config must target the macOS bundles")

// Repository entry points: tauri dev boots the Dev identity with the
// desktop-dev feature, and the e2e runner routes profiles to specs.
const frontendPackage = readJson("apps/desktop/frontend/package.json")
assert.ok(
  frontendPackage.scripts["tauri:dev"].includes("--features desktop-dev --config src-tauri/tauri.dev.conf.json"),
  "tauri:dev must boot the Dev identity with the desktop-dev feature"
)
const e2eRunner = readText("apps/desktop/e2e/run.mjs")
assert.ok(e2eRunner.includes("runStableProfileSmoke"), "run.mjs must invoke the Stable profile smoke")
assert.ok(e2eRunner.includes("runIdentityIsolationSmoke"), "run.mjs must invoke the identity isolation smoke")
assert.ok(e2eRunner.includes("createDesktopAppEnvironment"), "run.mjs must isolate app user directories per run")
const wdioConf = readText("apps/desktop/e2e/wdio.conf.js")
assert.ok(wdioConf.includes('ELEF_E2E_PROFILE === "identity"'), "wdio.conf.js must route the identity profile to its spec")
assert.ok(wdioConf.includes("./identity-isolation.spec.js"), "wdio.conf.js must run the identity isolation spec")
assert.ok(wdioConf.includes('ELEF_E2E_PROFILE === "stable"'), "wdio.conf.js must route the stable profile to its spec")
assert.ok(wdioConf.includes("./stable-exclusions.spec.js"), "wdio.conf.js must run the Stable exclusions spec")

// Smoke contracts: the Stable binary never carries desktop-dev, and the
// identity probes build both identities with distinct binaries and bus names.
const stableSmoke = readText("apps/desktop/e2e/stable-profile-smoke.js")
assert.ok(stableSmoke.includes("tauri.e2e-stable.conf.json"), "the Stable smoke must build the Stable e2e config")
assert.deepEqual(
  [...stableSmoke.matchAll(/"--features",\s*"([^"]+)"/g)].map(match => match[1]),
  ["webdriver"],
  "the Stable smoke must build with exactly the webdriver feature, never desktop-dev"
)
assert.ok(stableSmoke.includes('ELEF_E2E_PROFILE: "stable"'), "the Stable smoke must run the stable spec")
const identitySmoke = readText("apps/desktop/e2e/identity-isolation-smoke.js")
assert.ok(identitySmoke.includes("tauri.e2e-stable-identity.conf.json"), "the identity smoke must build the Stable identity")
assert.ok(identitySmoke.includes("tauri.e2e-dev-identity.conf.json"), "the identity smoke must build the Dev identity")
assert.ok(identitySmoke.includes('"desktop-dev,webdriver"'), "the identity smoke must build Dev with the desktop-dev feature")
assert.ok(identitySmoke.includes("Promise.allSettled"), "the identity probes must launch concurrently")
assert.ok(identitySmoke.includes("org.com_elef_desktop.SingleInstance"), "the identity smoke must expect the Stable bus name")
assert.ok(identitySmoke.includes("org.com_elef_desktop_dev.SingleInstance"), "the identity smoke must expect the Dev bus name")
const identitySpec = readText("apps/desktop/e2e/identity-isolation.spec.js")
assert.ok(identitySpec.includes("ELEF_E2E_IDENTITY_EXPECTED_ROOT"), "the identity spec must pin the per-identity library root")
assert.ok(identitySpec.includes("ELEF_E2E_IDENTITY_EXPECTED_BUS_NAME"), "the identity spec must pin the per-identity bus name")

// Spec contracts: the Stable exclusions spec pins every UI negative from
// the inventory plus the source-mode, save, export, diagnostics, rich
// rendering, and presentation behaviors CI exercises.
const stableSpec = readText("apps/desktop/e2e/stable-exclusions.spec.js")
for (const feature of inventory.excluded_features) {
  for (const selector of feature.ui_selectors) {
    assert.ok(stableSpec.includes(selector), `the Stable spec must pin the ${selector} negative (${feature.id})`)
  }
}
for (const pin of [
  'invoke("document_graph")',
  'sendNativeText("[[")',
  "STABLE_PROFILE_KEYBOARD_SOURCE",
  'editorMode, "source"',
  "saveStatus()",
  'invoke("export_elef"',
  'exportAndVerifyDiagnostics(browser, "stable")',
  "RICH_RENDERING_TITLE",
  "presenting-work",
  ".slide-frame",
  "imageLoaded",
  "elefRevisionsEnabled",
  "elefLineageEnabled"
]) {
  assert.ok(stableSpec.includes(pin), `the Stable spec must pin ${pin}`)
}
assert.ok(!stableSpec.includes("stage_update"), "the Stable updater boundary lands with slice B, not here")

// Deferred features stay flag-kept: desktop defaults off, register rows
// present, and no lineage controller on either desktop profile.
const flagDefaults = readText("packages/editor-runtime/src/lib/feature_flags.ts")
assert.ok(flagDefaults.includes("ELEF_ENABLE_REVISIONS: false"), "the revisions desktop default must stay off")
assert.ok(flagDefaults.includes("ELEF_ENABLE_LINEAGE: false"), "the lineage desktop default must stay off")
const flagRegister = readText("docs/desktop/feature-flags.md")
assert.ok(flagRegister.includes("ELEF_ENABLE_REVISIONS"), "the flag register must row the revisions flag")
assert.ok(flagRegister.includes("ELEF_ENABLE_LINEAGE"), "the flag register must row the lineage flag")
assert.ok(!devRegistration.includes("lineage-graph"), "Dev registration must not mount the deferred lineage graph")
assert.ok(!stableRegistration.includes("lineage-graph"), "Stable registration must not mount the deferred lineage graph")

// Native keyboard coverage stays behind the platform helpers the Stable
// keyboard flow depends on.
const nativeKeyboard = readText("apps/desktop/e2e/native-keyboard.js")
assert.ok(nativeKeyboard.includes("xdotool"), "native keyboard input must drive Linux through xdotool")
assert.ok(nativeKeyboard.includes("keystroke"), "native keyboard input must drive macOS through keystroke")

console.log("Stable/Dev release profiles: exclusions prove bundle-absent with Dev presence, IPC denial, and spec negatives.")


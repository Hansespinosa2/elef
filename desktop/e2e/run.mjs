import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { PIXEL_PNG_MARKDOWN } from "./scenarios/media-fixture.js"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../..")
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-desktop-e2e-"))
const libraryRoot = path.join(temporaryRoot, "Elef")
const seedDeck = path.join(libraryRoot, "E2E seed")
const archiveFixture = path.join(temporaryRoot, "E2E archive seed")
const importArchive = path.join(temporaryRoot, "E2E archive seed.elef")
const expectedSource = `# Saved by shared scenario\n\nThe editor autosaved this text.\n\n${PIXEL_PNG_MARKDOWN}`

function normalizeLineEndings(source) {
  return source.replace(/\r\n/g, "\n")
}
const webTitle = `Desktop E2E ${randomUUID()}`
let presentationId = null
let documentIds = []
const env = {
  ...process.env,
  ELEF_E2E_LIBRARY_ROOT: libraryRoot,
  ELEF_E2E_APP_BINARY: path.join(repoRoot, "desktop", "target", "debug", "elef-desktop"),
  ELEF_E2E_IMPORT_ARCHIVE: importArchive
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
  await writeFile(path.join(seedDeck, "presentation.md"), "# Before E2E\n\nSeed paragraph.\n")
  await writeFile(path.join(seedDeck, "elef.json"), JSON.stringify({
    id: "a3d0f020-6605-4f9e-a96d-d825ee4b13f1",
    schema_version: 1
  }))
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
      `presentation = Presentation.create!(title: ${JSON.stringify(webTitle)}, source: "# Before E2E\\n\\nSeed paragraph.\\n"); document = Document.create!(source: "# E2E document\\n\\nSee [[E2E linked]].\\n"); linked = Document.create!(source: "# E2E linked\\n\\nTarget document.\\n"); puts "ELEF_E2E_PRESENTATION_ID=#{presentation.id}"; puts "ELEF_E2E_DOCUMENT_IDS=#{[document.id, linked.id].join(',')}"`
    )
    const id = seeded.match(/^ELEF_E2E_PRESENTATION_ID=(\d+)$/m)?.[1]
    assert.match(id, /^\d+$/, "Rails fixture command should return the presentation id")
    presentationId = id
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
  assert.equal(normalizeLineEndings(desktopSource), expectedSource)
  assert.equal(
    await readFile(path.join(libraryRoot, "E2E archive seed", "presentation.md"), "utf8"),
    "# Imported from Elef\n\nPortable archive fixture.\n"
  )
  if (presentationId) {
    const persisted = runRails(
      "presentation = Presentation.find(" + presentationId + "); puts \"ELEF_E2E_SOURCE=#{presentation.source.to_json}\"; presentation.destroy!; Document.where(id: [" + documentIds.map(Number).join(",") + "]).destroy_all"
    )
    const savedSource = persisted.match(/^ELEF_E2E_SOURCE=(.*)$/m)?.[1]
    assert.ok(savedSource, "Rails fixture command should return the persisted source")
    assert.equal(normalizeLineEndings(JSON.parse(savedSource)), expectedSource)
  }
} finally {
  if (presentationId) {
    try {
      runRails(`Presentation.find_by(id: ${presentationId})&.destroy!`)
      runRails(`Document.where(id: [${documentIds.map(Number).join(",")}]).destroy_all`)
    } catch (_error) {
      // Preserve the browser/test failure while making fixture cleanup best-effort.
    }
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}

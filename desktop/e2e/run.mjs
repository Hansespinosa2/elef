import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../..")
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-desktop-e2e-"))
const libraryRoot = path.join(temporaryRoot, "Elef")
const seedDeck = path.join(libraryRoot, "E2E seed")
const expectedSource = "# Saved by shared scenario\n\nThe editor autosaved this text.\n"
const webTitle = `Desktop E2E ${randomUUID()}`
let presentationId = null
const env = {
  ...process.env,
  ELEF_E2E_LIBRARY_ROOT: libraryRoot,
  ELEF_E2E_APP_BINARY: path.join(repoRoot, "desktop", "target", "debug", "elef-desktop")
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

  if (process.env.CI) {
    const seeded = runRails(
      `presentation = Presentation.create!(title: ${JSON.stringify(webTitle)}, source: "# Before E2E\\n\\nSeed paragraph.\\n"); puts "ELEF_E2E_PRESENTATION_ID=#{presentation.id}"`
    )
    const id = seeded.match(/^ELEF_E2E_PRESENTATION_ID=(\d+)$/m)?.[1]
    assert.match(id, /^\d+$/, "Rails fixture command should return the presentation id")
    presentationId = id
    env.ELEF_E2E_PRESENTATION_ID = id
    env.ELEF_E2E_START_WEB_SERVER = "1"
  }

  const playwright = path.join(e2eRoot, "node_modules", ".bin", "playwright")
  const projects = presentationId ? ["web", "desktop"] : ["desktop"]
  const result = spawnSync(playwright, ["test", ...projects.flatMap(project => ["--project", project])], {
    cwd: e2eRoot,
    env,
    stdio: "inherit"
  })
  if (result.error) throw result.error
  const testsPassed = result.status === 0
  if (!testsPassed) process.exitCode = result.status || 1

  if (testsPassed) {
    assert.equal(await readFile(path.join(seedDeck, "presentation.md"), "utf8"), expectedSource)
    if (presentationId) {
      const persisted = runRails(
        `presentation = Presentation.find(${presentationId}); puts "ELEF_E2E_SOURCE=#{presentation.source.to_json}"; presentation.destroy!`
      )
      const savedSource = persisted.match(/^ELEF_E2E_SOURCE=(.*)$/m)?.[1]
      assert.ok(savedSource, "Rails fixture command should return the persisted source")
      assert.equal(JSON.parse(savedSource), expectedSource)
    }
  }
} finally {
  if (presentationId) {
    try {
      runRails(`Presentation.find_by(id: ${presentationId})&.destroy!`)
    } catch (_error) {
      // Preserve the browser/test failure while making fixture cleanup best-effort.
    }
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}

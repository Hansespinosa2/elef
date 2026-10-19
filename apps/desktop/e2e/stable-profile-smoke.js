import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createDesktopAppEnvironment } from "./desktop-app-environment.js"
import { reserveWebdriverPort } from "./webdriver-port.js"
import { runWdio } from "./wdio-smoke.js"
import { STABLE_PROFILE_KEYBOARD_SOURCE, STABLE_PROFILE_SOURCE, STABLE_PROFILE_WORK_TITLE } from "./stable-profile-fixture.js"
import { RICH_RENDERING_SOURCE, RICH_RENDERING_TITLE } from "../../../apps/web/test/e2e/scenarios/rich-rendering-media.js"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../../..")

function writeWorkFixture(libraryRoot, title, source, sourceFile) {
  const workFolder = path.join(libraryRoot, title)
  mkdirSync(workFolder, { recursive: true })
  writeFileSync(path.join(workFolder, sourceFile), source)
  writeFileSync(path.join(workFolder, "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))
  return workFolder
}

function executableExists(binaryPath) {
  try {
    return existsSync(binaryPath)
  } catch {
    return false
  }
}

export async function runStableProfileSmoke(env) {
  const binary = process.platform === "win32" ? "elef-desktop.exe" : "elef-desktop"
  const application = process.env.ELEF_E2E_STABLE_APP_BINARY
    || path.join(repoRoot, "target", "debug", binary)
  // The Stable e2e binary carries the webdriver feature but never
  // desktop-dev: document_graph stays unregistered and the Stable capability
  // denies it, which the exclusions spec asserts from inside the app.
  execFileSync("npm", ["run", "build", "--prefix", "apps/desktop/frontend"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ELEF_E2E_BUILD: "1", ELEF_DESKTOP_PROFILE: "stable" }
  })
  const build = spawnSync("npm", [
    "run",
    "tauri:build",
    "--prefix",
    "apps/desktop/frontend",
    "--",
    "--debug",
    "--config",
    "src-tauri/tauri.e2e-stable.conf.json",
    "--features",
    "webdriver"
  ], { cwd: repoRoot, stdio: "inherit", env: process.env })
  if (build.error) throw build.error
  if (build.status !== 0 || !executableExists(application)) {
    throw new Error("The Stable profile smoke could not build the e2e-stable desktop binary.")
  }

  const scratch = mkdtempSync(path.join(tmpdir(), "elef-stable-profile-"))
  const home = path.join(scratch, "home")
  const config = path.join(scratch, "config")
  const data = path.join(scratch, "data")
  const cache = path.join(scratch, "cache")
  for (const directory of [home, config, data, cache]) mkdirSync(directory, { recursive: true })
  const libraryRoot = path.join(scratch, "library")
  // Documents carry document-link affordances on Dev, so the Stable fixture
  // is a document: its Stable absence is meaningful rather than vacuous.
  writeWorkFixture(libraryRoot, STABLE_PROFILE_WORK_TITLE, STABLE_PROFILE_SOURCE, "document.md")
  const richWorkFolder = writeWorkFixture(libraryRoot, RICH_RENDERING_TITLE, RICH_RENDERING_SOURCE, "presentation.md")
  // The rich fixture references a work-relative image; seed the committed
  // release pixel so the loaded-image assertion is deterministic.
  mkdirSync(path.join(richWorkFolder, "images"), { recursive: true })
  copyFileSync(
    path.join(repoRoot, "apps/web/test/fixtures/desktop/release/images/release-pixel.png"),
    path.join(richWorkFolder, "images/release-pixel.png")
  )
  const exportPath = path.join(scratch, "stable-profile.elef")

  const port = await reserveWebdriverPort()
  runWdio({
    ...createDesktopAppEnvironment(env, { home, config, data, cache }),
    ELEF_E2E_APP_BINARY: application,
    ELEF_E2E_LIBRARY_ROOT: libraryRoot,
    ELEF_E2E_EXPORT_PATH: exportPath,
    TAURI_WEBDRIVER_PORT: String(port),
    ELEF_E2E_PROFILE: "stable"
  })
  // The spec exports after editing: the archive must unzip to the exact
  // saved bytes, unknown directive and literal link included.
  const exportedWork = path.join(scratch, "stable-profile-exported")
  mkdirSync(exportedWork, { recursive: true })
  execFileSync("unzip", ["-q", "-o", exportPath, "-d", exportedWork])
  const normalizeLineEndings = source => source.replace(/\r\n|\r/g, "\n")
  assert.equal(
    normalizeLineEndings(readFileSync(path.join(exportedWork, "document.md"), "utf8")),
    normalizeLineEndings(STABLE_PROFILE_KEYBOARD_SOURCE),
    "the Stable export must preserve the edited source byte-for-byte"
  )
  assert.ok(existsSync(path.join(exportedWork, "elef.json")), "the Stable export must carry the work manifest")
  // The scratch holds the app's XDG cache dir: Mesa/WebKit can still flush
  // shader-cache files while the tree is being removed (ENOTEMPTY rmdir).
  // Retry the removal instead of failing an otherwise green run.
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

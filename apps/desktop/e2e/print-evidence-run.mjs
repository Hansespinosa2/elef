// Print-evidence orchestrator (dispatch-only): seeds a pristine fixed
// fixture library, launches the updater fixture server exactly as run.mjs
// does, then runs ONLY the print-evidence wdio spec against the real
// desktop binary. Invoked by the dispatch-only `pdf-export-evidence`
// workflow; never part of the normal suites.
//
// Seeded fixtures (byte-identical sources to run.mjs):
// - "E2E seed" (presentation.md) — the shared e2e presentation fixture.
// - "E2E linked" (document.md) — its link target.
// - "E2E document" (document.md) — the shared e2e document fixture.
// The capture spec opens each print fixture ("E2E seed", "E2E document")
// with no prior editing, so the sources stay pristine and fixed.
import { spawn, spawnSync } from "node:child_process"
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { e2eDocumentSource, e2eLinkedDocumentSource } from "./fixtures/seeds.mjs"
import { createDesktopAppEnvironment } from "./desktop-app-environment.js"
import { reserveWebdriverPort } from "./webdriver-port.js"

const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../../..")

const evidenceDir = process.argv[process.argv.indexOf("--evidence-dir") + 1]
if (!evidenceDir) throw new Error("print-evidence-run.mjs requires --evidence-dir <path>")

const SEED_PRESENTATION_SOURCE = "# Before E2E\n\nSeed paragraph.\n\nSee [[E2E linked]].\n"
const SEED_WORK_ID = "a3d0f020-6605-4f9e-a96d-d825ee4b13f1"

const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "elef-print-evidence-")))
const libraryRoot = path.join(temporaryRoot, "Elef")
const isolated = {
  home: path.join(temporaryRoot, "home"),
  config: path.join(temporaryRoot, "config"),
  data: path.join(temporaryRoot, "data"),
  cache: path.join(temporaryRoot, "cache"),
}
for (const directory of [libraryRoot, isolated.home, isolated.config, isolated.data, isolated.cache]) {
  await mkdir(directory, { recursive: true })
}

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
    built_in: false,
  }],
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
    built_in: false,
  }],
}))

async function seedWorkFolder(name, sourceFile, source, id) {
  const folder = path.join(libraryRoot, name)
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, sourceFile), source)
  await writeFile(path.join(folder, "elef.json"), JSON.stringify({ id, schema_version: 1 }))
}

const linkedId = randomUUID()
await seedWorkFolder("E2E seed", "presentation.md", SEED_PRESENTATION_SOURCE, SEED_WORK_ID)
await seedWorkFolder("E2E linked", "document.md", e2eLinkedDocumentSource, linkedId)
await seedWorkFolder("E2E document", "document.md", e2eDocumentSource, randomUUID())

const env = {
  ...process.env,
  ELEF_E2E_LIBRARY_ROOT: libraryRoot,
  ELEF_E2E_APP_BINARY: process.env.ELEF_E2E_APP_BINARY
    || path.join(repoRoot, "target", "debug", process.platform === "win32" ? "elef-desktop.exe" : "elef-desktop"),
  ELEF_E2E_SEED_WORK_ID: SEED_WORK_ID,
  ELEF_E2E_DESKTOP_LINKED_DOCUMENT_ID: linkedId,
  ELEF_E2E_PRINT_EVIDENCE_DIR: path.resolve(evidenceDir),
}
await mkdir(env.ELEF_E2E_PRINT_EVIDENCE_DIR, { recursive: true })

const updaterServer = spawn(process.execPath, [path.join(e2eRoot, "updater-fixture-server.mjs")], {
  env,
  stdio: ["ignore", "inherit", "inherit", "ipc"],
})
try {
  env.ELEF_E2E_UPDATER_PUBLIC_KEY = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Updater fixture server did not start")), 10_000)
    updaterServer.once("message", message => { clearTimeout(timer); resolve(message.publicKey) })
    updaterServer.once("error", reject)
    updaterServer.once("exit", code => reject(new Error(`Updater fixture server exited before readiness (${code})`)))
  })
  const webdriverio = path.join(e2eRoot, "node_modules", ".bin", "wdio")
  const result = spawnSync(webdriverio, ["run", "wdio.conf.js"], {
    cwd: e2eRoot,
    env: {
      ...createDesktopAppEnvironment(env, isolated),
      ELEF_E2E_PROFILE: "print-evidence",
      TAURI_WEBDRIVER_PORT: String(await reserveWebdriverPort()),
    },
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Print-evidence capture failed with status ${result.status}`)
  console.log(`Print-evidence captures written to ${env.ELEF_E2E_PRINT_EVIDENCE_DIR}`)
} finally {
  updaterServer.kill("SIGTERM")
}

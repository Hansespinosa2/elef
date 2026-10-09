import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { safeMacosManifest, serializeLedger, validateLedger } from "./ledger.mjs"

const NO_SAFE_UPDATE = Object.freeze({
  version: "0.0.0",
  notes: "No eligible Elef Desktop update is published.",
  platforms: {}
})

/** Return the only two mutable Pages files from one validated ledger snapshot. */
export function pagesStateFiles(ledger) {
  validateLedger(ledger)
  const latest = safeMacosManifest(ledger) || NO_SAFE_UPDATE
  return {
    "desktop/stable/state.json": serializeLedger(ledger),
    "desktop/stable/latest.json": `${JSON.stringify(latest, null, 2)}\n`
  }
}

/** Materialize both derived files. The caller commits them together as one git commit. */
export async function writePagesStateFiles(outputRoot, ledger) {
  const files = pagesStateFiles(ledger)
  const releaseDirectory = path.join(outputRoot, "desktop", "stable")
  await mkdir(releaseDirectory, { recursive: true })
  const temporaryDirectory = await mkdtemp(path.join(releaseDirectory, ".release-state-"))
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const filename = path.basename(relativePath)
      await writeFile(path.join(temporaryDirectory, filename), contents, { mode: 0o600 })
    }
    await rename(path.join(temporaryDirectory, "state.json"), path.join(releaseDirectory, "state.json"))
    await rename(path.join(temporaryDirectory, "latest.json"), path.join(releaseDirectory, "latest.json"))
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
  return Object.keys(files)
}

export async function readPagesLedger(pagesRoot) {
  const filename = path.join(pagesRoot, "desktop", "stable", "state.json")
  return readFile(filename, "utf8")
}

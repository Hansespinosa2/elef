import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { RICH_RENDERING_SOURCE, RICH_RENDERING_TITLE } from "../../../apps/web/test/e2e/scenarios/rich-rendering-media.js"

// The rich release fixture is seeded on demand inside its own tests, not
// upfront in run.mjs: the shared library-count assertions (5 / 3 / 2) pin the
// upfront seed, so a sixth upfront work breaks them on both hosts.
const e2eRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(e2eRoot, "../../..")
const pixelPath = path.join(repoRoot, "apps/web/test/fixtures/desktop/release/images/release-pixel.png")

export function richRenderingWorkFolder(libraryRoot) {
  return path.join(libraryRoot, RICH_RENDERING_TITLE)
}

export async function setupRichRenderingWork(libraryRoot) {
  const folder = richRenderingWorkFolder(libraryRoot)
  await mkdir(path.join(folder, "images"), { recursive: true })
  await writeFile(path.join(folder, "presentation.md"), RICH_RENDERING_SOURCE)
  await writeFile(path.join(folder, "images/release-pixel.png"), await readFile(pixelPath))
  await writeFile(path.join(folder, "elef.json"), JSON.stringify({ id: randomUUID(), schema_version: 1 }))
  return folder
}

export async function teardownRichRenderingWork(libraryRoot) {
  await rm(richRenderingWorkFolder(libraryRoot), { recursive: true, force: true })
}

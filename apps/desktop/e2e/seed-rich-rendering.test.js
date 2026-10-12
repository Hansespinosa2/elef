import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { RICH_RENDERING_SOURCE, RICH_RENDERING_TITLE } from "../../../apps/web/test/e2e/scenarios/rich-rendering-media.js"
import { richRenderingWorkFolder, setupRichRenderingWork, teardownRichRenderingWork } from "./seed-rich-rendering.mjs"

test("rich rendering seeding creates and removes exactly one isolated work", async () => {
  const libraryRoot = await mkdtemp(path.join(os.tmpdir(), "elef-rich-seed-"))
  try {
    const folder = await setupRichRenderingWork(libraryRoot)
    assert.equal(folder, richRenderingWorkFolder(libraryRoot))
    assert.equal(await readFile(path.join(folder, "presentation.md"), "utf8"), RICH_RENDERING_SOURCE)
    const manifest = JSON.parse(await readFile(path.join(folder, "elef.json"), "utf8"))
    assert.equal(manifest.schema_version, 1)
    assert.match(manifest.id, /^[0-9a-f-]{36}$/)
    assert.ok((await readFile(path.join(folder, "images/release-pixel.png"))).length > 0)
    assert.deepEqual(await readdir(libraryRoot), [RICH_RENDERING_TITLE])
    await teardownRichRenderingWork(libraryRoot)
    assert.deepEqual(await readdir(libraryRoot), [])
  } finally {
    await rm(libraryRoot, { recursive: true, force: true })
  }
})

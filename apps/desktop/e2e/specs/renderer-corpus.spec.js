import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Same exact-byte corpus as the Node fixtures test, evaluated in Chromium
// against the shipped bundle. Needs no Rails server.
const e2eRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(e2eRoot, "../..")
const inputs = JSON.parse(await readFile(path.join(repoRoot, "test/javascript/fixtures/renderer-inputs.json"), "utf8"))
const outputs = JSON.parse(await readFile(path.join(repoRoot, "test/javascript/fixtures/renderer-outputs.json"), "utf8"))
const bundlePath = path.join(repoRoot, "vendor/javascript/elef-renderer.bundle.js")

test.describe("renderer corpus in Chromium", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent("<!doctype html><html><body></body></html>")
    await page.addScriptTag({ path: bundlePath })
  })

  for (const [index, { name, input }] of inputs.entries()) {
    test(`exact bytes: ${name}`, async ({ page }) => {
      const expected = outputs[index]
      expect(expected.name).toBe(name)
      const blockHtml = await page.evaluate(
        ({ source, mediaMap, allowRemoteMedia }) =>
          window.ElefRenderer.renderMarkdownBlock(source, { mediaMap, allowRemoteMedia }),
        { source: input.source, mediaMap: input.mediaMap || {}, allowRemoteMedia: input.allowRemoteMedia === true }
      )
      expect(blockHtml).toBe(expected.blockHtml)
      const preview = await page.evaluate(input => window.ElefRenderer.renderPreview(input), input)
      expect(preview).toEqual(expected.preview)
      const again = await page.evaluate(input => window.ElefRenderer.renderPreview(input), input)
      expect(again).toEqual(preview)
    })
  }
})

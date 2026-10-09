import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SlideOverview } from "../../../packages/client/src/features/overview/overview.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const overviewUrl = new URL("../../../packages/client/src/features/overview/overview.js", import.meta.url).href
const source = (await readFile(path.join(root, "app/javascript/controllers/slide_overview_controller.js"), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { SlideOverview } from "@elef/client"', `import { SlideOverview } from "${overviewUrl}"`)
const adapter = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("the slide-overview adapter exposes the shared source math before and after connect", () => {
  const controller = new adapter.default()
  assert.deepEqual(controller.sourceRanges("One\n---\nTwo"), [])

  controller.overview = new SlideOverview({})
  const ranges = controller.sourceRanges("One\n---\nTwo")
  assert.equal(ranges.length, 2)
  assert.deepEqual(ranges[0], { start: 0, end: 4 })
})

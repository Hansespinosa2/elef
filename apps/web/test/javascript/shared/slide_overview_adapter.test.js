import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SlideOverview } from "@elef/client"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
const overviewUrl = import.meta.resolve("@elef/client")
const source = (await readFile(path.join(root, "packages/editor-runtime/dist/controllers/slide_overview_controller.js"), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { SlideOverview } from "@elef/client"', `import { SlideOverview } from "${overviewUrl}"`)
  .replace('import { bindEditorAction } from "../lib/editor_actions.js"', "const bindEditorAction = (...args) => { (globalThis.__overviewBinds ||= []).push(args); return () => {} }")
const adapter = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("the slide-overview adapter exposes the shared source math before and after connect", () => {
  const controller = new adapter.default()
  assert.deepEqual(controller.sourceRanges("One\n---\nTwo"), [])

  controller.overview = new SlideOverview({})
  const ranges = controller.sourceRanges("One\n---\nTwo")
  assert.equal(ranges.length, 2)
  assert.deepEqual(ranges[0], { start: 0, end: 4 })
})

test("the slide-overview adapter binds the neutral card contract", () => {
  globalThis.__overviewBinds = []
  const warnings = { hidden: true, querySelector: () => ({ replaceChildren() {}, append() {} }) }
  const controller = new adapter.default()
  Object.assign(controller, {
    element: { dataset: {}, querySelector: () => null },
    hasGridTarget: false,
    gridTarget: null,
    hasCountTarget: false,
    countTarget: null,
    hasWarningsTarget: true,
    warningsTarget: warnings
  })
  controller.connect()

  assert.equal(globalThis.__overviewBinds.length, 1)
  const [root, action, handler] = globalThis.__overviewBinds[0]
  assert.equal(action, "overview-select")
  handler({ currentTarget: {}, target: { closest: () => ({ dataset: { slideIndex: "2" } }) } })
  assert.equal(controller.overview.selectedIndex, 2)
  assert.equal(root, controller.element)
  delete globalThis.__overviewBinds
})

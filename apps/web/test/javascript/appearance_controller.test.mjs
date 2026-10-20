import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadPackageSource } from "./shared/package_source.mjs"

const testPath = fileURLToPath(import.meta.url)
const importmapPath = path.resolve(path.dirname(testPath), "../../config/importmap.rb")
const styleVocabUrl = import.meta.resolve("@elef/work-model/style-vocab")
const source = (await loadPackageSource("packages/editor-runtime/src/controllers/appearance_controller.ts"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { withAppearanceValue } from "@elef/work-model/style-vocab"', `import { withAppearanceValue } from "${styleVocabUrl}"`)
const appearance = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("Rails importmap pins the shared appearance source mapper", async () => {
  const importmap = await readFile(importmapPath, "utf8")
  assert.match(importmap, /pin "@elef\/work-model", to: "work-model\/dist\/elef-work-model\.js"/)
  assert.match(importmap, /pin "@elef\/work-model\/art-source", to: "work-model\/dist\/art-source\.js"/)
  assert.match(importmap, /pin "@elef\/work-model\/style-vocab", to: "work-model\/dist\/style-vocab\.js"/)
})

test("the shared appearance controller commits selected styles to Markdown", () => {
  const body = "# Shared work\n\nKeep this body.\n"
  const sourceField = { value: body }
  const applied = []
  const editor = {
    setExternalValue(value) {
      applied.push(value)
      sourceField.value = value
    }
  }
  const sourceWrapper = { editorController: editor }
  const listeners = {}
  const form = {
    dataset: { editorMode: "visual" },
    addEventListener(type, listener) { listeners[type] = listener },
    removeEventListener() {},
    querySelector(selector) {
      if (selector === '[name$="[source]"]') return sourceField
      if (selector === ".source-field") return sourceWrapper
      return null
    }
  }
  const themeTarget = { value: "", disabled: false }
  const typographyTarget = { value: "", disabled: false }
  const controller = new appearance.default()
  Object.assign(controller, {
    element: { closest: () => form },
    hasPanelContainerTarget: false,
    hasThemeFieldTarget: false,
    hasTypographyFieldTarget: false,
    hasHintTarget: false,
    themeTarget,
    typographyTarget
  })

  controller.connect()
  themeTarget.value = "dark"
  listeners.change({ target: themeTarget })

  assert.equal(applied.length, 1)
  assert.equal(applied[0], `---\ntheme: dark\n---\n${body}`)
  assert.equal(sourceField.value, applied[0])

  typographyTarget.value = "technical"
  listeners.change({ target: typographyTarget })
  assert.equal(sourceField.value, `---\ntheme: dark\ntypography: technical\n---\n${body}`)
})

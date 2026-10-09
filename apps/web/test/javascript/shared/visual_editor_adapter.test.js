import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseHTML } from "linkedom"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
const clientStubUrl = `data:text/javascript;base64,${Buffer.from(`
export class DocumentEditor {
  constructor(options) { this.options = options; this.calls = [] }
  connect() { this.calls.push("connect") }
  disconnect() { this.calls.push("disconnect") }
  blockFocus() { this.calls.push("blockFocus") }
  blockBlur() { this.calls.push("blockBlur") }
  projectionInput() { this.calls.push("projectionInput") }
  projectionKeydown() { this.calls.push("projectionKeydown") }
  alignmentChanged() { this.calls.push("alignmentChanged") }
  positionControlOpened() { this.calls.push("positionControlOpened") }
  positionControlKeydown() { this.calls.push("positionControlKeydown") }
  flushPendingProjectionEdits() { this.calls.push("flushPendingProjectionEdits") }
  captureCaret() { this.calls.push("captureCaret"); return "caret" }
  restoreCaret() { this.calls.push("restoreCaret"); return true }
}
`).toString("base64")}`
const source = (await readFile(path.join(root, "apps/web/app/javascript/controllers/visual_editor_controller.js"), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { DocumentEditor } from "@elef/client"', `import { DocumentEditor } from "${clientStubUrl}"`)
  .replace(/^import \{[^}]*\} from "lib\/editor_controller_lookup";?$/m, "const editorFor = () => null")
  .replace(/^import \{[^}]*\} from "lib\/editor_view";?$/m, "const enableVisualModeAfterPreview = () => ({}); const enableVisualModeFromInstalledPreview = () => ({})")
  .replace(/^import \{[^}]*\} from "lib\/presentation_editor_host";?$/m, 'const documentEditorDeps = () => ({ marker: "deps" })')
const adapter = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("the visual-editor adapter wires the shared feature with host seams", () => {
  const { document } = parseHTML("<html><body><form><div class=\"projection\"></div></form></body></html>")
  const form = document.querySelector("form")
  const controller = new adapter.default()
  Object.assign(controller, {
    element: form,
    hasProjectionTarget: true,
    projectionTarget: form.querySelector(".projection"),
    kindValue: "document",
    focusTitleValue: false
  })

  controller.connect()

  assert.equal(form.visualEditorController, controller)
  const options = controller.editor.options
  assert.equal(options.element, form)
  assert.equal(options.projection, form.querySelector(".projection"))
  assert.equal(options.kind, "document")
  assert.equal(options.focusTitle, false)
  assert.deepEqual(options.deps, { marker: "deps" })
  for (const seam of ["lookupEditor", "afterPreview", "restorePreviewToggle"]) {
    assert.equal(typeof options[seam], "function")
  }
  assert.deepEqual(controller.editor.calls, ["connect"])

  for (const action of ["blockFocus", "blockBlur", "projectionInput", "projectionKeydown", "alignmentChanged", "positionControlOpened", "positionControlKeydown", "flushPendingProjectionEdits"]) {
    controller[action]({})
  }
  assert.equal(controller.captureCaret(), "caret")
  assert.equal(controller.restoreCaret(3, "b1"), true)
  for (const action of ["blockFocus", "blockBlur", "projectionInput", "projectionKeydown", "alignmentChanged", "positionControlOpened", "positionControlKeydown", "flushPendingProjectionEdits", "captureCaret", "restoreCaret"]) {
    assert.ok(controller.editor.calls.includes(action), `${action} delegates`)
  }

  controller.disconnect()
  assert.ok(controller.editor.calls.includes("disconnect"))
  assert.equal(form.visualEditorController, undefined)
})

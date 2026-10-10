import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const syntaxSource = await readFile(new URL("../../app/javascript/controllers/mermaid_syntax.js", import.meta.url), "utf8")
const syntaxUrl = `data:text/javascript;base64,${Buffer.from(syntaxSource).toString("base64")}`
const controllerSource = (await readFile(new URL("../../app/javascript/controllers/mermaid_assist_controller.js", import.meta.url), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { editorFor } from "lib/editor_controller_lookup"', "const editorFor = () => null")
  .replace('import { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } from "controllers/mermaid_syntax"',
    `const { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } = await import("${syntaxUrl}")`)
const mermaidAssist = await import(`data:text/javascript;base64,${Buffer.from(controllerSource).toString("base64")}`)

test("a stale Mermaid palette closes without editing a destroyed editor", () => {
  let edits = 0
  const controller = new mermaidAssist.default()
  const editor = {
    destroyed: true,
    view: { destroyed: true },
    editingMode: "source",
    selectionStart: 0,
    selectionEnd: 0,
    replaceRange() { edits += 1 },
    replaceRangeWithSelection() { edits += 1 }
  }
  Object.assign(controller, {
    editorController: editor,
    paletteTarget: {
      hidden: false,
      replaceChildren() {}
    },
    hasPaletteTarget: true,
    model: { kind: "diagram-command", from: 0, to: 5, query: "/diag" },
    modelKey: "diagram-command:0:5:/diag",
    matches: [{ id: "diagram", label: "/diagram" }],
    selectedIndex: 0
  })

  controller.keydown({ key: "Enter", defaultPrevented: false, preventDefault() {}, stopPropagation() {} })

  assert.equal(edits, 0)
  assert.equal(controller.paletteTarget.hidden, true)
  assert.equal(controller.model, null)
})

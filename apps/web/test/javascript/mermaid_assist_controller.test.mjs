import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const distControllers = new URL("../../../../packages/editor-runtime/dist/controllers/", import.meta.url)
const syntaxUrl = new URL("mermaid_syntax.js", distControllers).href
const controllerSource = (await readFile(new URL("mermaid_assist_controller.js", distControllers), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus";', "class Controller {}")
  .replace('import { editorFor } from "../lib/editor_controller_lookup.js";', "const editorFor = () => null")
  .replace('import { forwardEscapeToVim } from "../lib/vim_escape.js";', "const forwardEscapeToVim = () => false")
  .replace(
    'import { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } from "./mermaid_syntax.js";',
    `import { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } from "${syntaxUrl}";`
  )
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

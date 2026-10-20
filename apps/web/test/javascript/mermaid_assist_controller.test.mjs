import assert from "node:assert/strict"
import test from "node:test"
import { loadPackageSource } from "./shared/package_source.mjs"

// mermaid_syntax.ts is import-free, so the assist suite inlines the real
// module source exactly as it inlines visual_assist below.
const mermaidSyntaxSource = await loadPackageSource("packages/editor-runtime/src/controllers/mermaid_syntax.ts")
const visualAssistSource = await loadPackageSource("packages/editor-runtime/src/lib/visual_assist.ts")
const controllerSource = (await loadPackageSource("packages/editor-runtime/src/controllers/mermaid_assist_controller.ts"))
  .replace('import { Controller } from "@hotwired/stimulus";', "class Controller {}")
  .replace('import { editorFor } from "../lib/editor_controller_lookup.js";', "const editorFor = () => null")
  .replace('import { assistsInMode, mirrorPopupAccessibility, placePaletteBelow, placeVisualCaret, projectionHostFor, visualCaretRect } from "../lib/visual_assist.js";', () => visualAssistSource)
  .replace('import { forwardEscapeToVim } from "../lib/vim_escape.js";', "const forwardEscapeToVim = () => false")
  .replace(
    'import { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } from "./mermaid_syntax.js";',
    () => mermaidSyntaxSource
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

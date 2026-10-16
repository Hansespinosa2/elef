import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"

// Component evidence only: real browser propagation and native Selection,
// without a host, CodeMirror mount, or persistence adapter.
let controllerSource = await readFile(new URL("../../../../packages/editor-runtime/dist/controllers/editor_controller.js", import.meta.url), "utf8")
controllerSource = controllerSource.replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\s*/gm, "")
const prelude = `
class Controller {}
const tags = { processingInstruction: {} }
const EditorView = { theme: () => [] }
`

test("projection navigation is observed before a form capture handler moves the native selection", async ({ page }) => {
  await page.setContent(`<form><div class="editor-projection"><p contenteditable="true">First</p><p contenteditable="true">Second</p></div></form>`)
  const result = await page.evaluate(async source => {
    const { default: Controller } = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`)
    const form = document.querySelector("form")
    const [first, second] = form.querySelectorAll("p")
    const selection = window.getSelection()
    selection.setPosition(first.firstChild, 0)
    const controller = new Controller()
    Object.assign(controller, {
      form, editingMode: "visual", projectionNavigationOccurred: false,
      view: { state: { doc: { length: 12, sliceString: () => "First\nSecond" } } }
    })
    // Deliberately register the mutating form listener first: connection
    // order cannot determine which handler captures the original caret.
    form.addEventListener("keydown", event => {
      selection.setPosition(second.firstChild, 0)
      event.preventDefault()
    }, true)
    controller.observeProjectionNavigation()
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
    await new Promise(requestAnimationFrame)
    const moved = controller.projectionNavigationOccurred
    const nativeMoved = selection.focusNode === second.firstChild
    controller.stopObservingProjectionNavigation()
    controller.projectionNavigationOccurred = false
    selection.setPosition(first.firstChild, 0)
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
    await new Promise(requestAnimationFrame)
    return { moved, nativeMoved, stopped: !controller.projectionNavigationOccurred }
  }, prelude + controllerSource)
  expect(result).toEqual({ moved: true, nativeMoved: true, stopped: true })
})

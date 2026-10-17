import { expect, test } from "@playwright/test"
import { build } from "esbuild"

// Component evidence only: real browser propagation and native Selection,
// without a host, CodeMirror mount, or persistence adapter. Bundles the
// exports-mapped @elef/client/editor-test-internals entry to a single
// self-contained ESM string (CodeMirror included: no bare specifiers, no
// globals to stub) and imports it via data: URL, since page scripts
// cannot import filesystem paths. Deep dist reads are forbidden; the
// mapped test seam is the only sanctioned source.
const bundled = await build({
  entryPoints: ["../../../../packages/client/src/features/editor/test_internals.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  absWorkingDir: import.meta.dirname,
})
const engineSource = bundled.outputFiles[0].text

test("projection navigation is observed before a form capture handler moves the native selection", async ({ page }) => {
  await page.setContent(`<form><div class="editor-projection"><p contenteditable="true">First</p><p contenteditable="true">Second</p></div></form>`)
  const result = await page.evaluate(async source => {
    const { EditorEngine } = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`)
    const form = document.querySelector("form")
    const [first, second] = form.querySelectorAll("p")
    const selection = window.getSelection()
    selection.setPosition(first.firstChild, 0)
    const engine = new EditorEngine(form)
    Object.assign(engine, {
      form, editingMode: "visual", projectionNavigationOccurred: false,
      view: { state: { doc: { length: 12, sliceString: () => "First\nSecond" } } }
    })
    // Deliberately register the mutating form listener first: connection
    // order cannot determine which handler captures the original caret.
    form.addEventListener("keydown", event => {
      selection.setPosition(second.firstChild, 0)
      event.preventDefault()
    }, true)
    engine.observeProjectionNavigation()
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
    await new Promise(requestAnimationFrame)
    const moved = engine.projectionNavigationOccurred
    const nativeMoved = selection.focusNode === second.firstChild
    engine.stopObservingProjectionNavigation()
    engine.projectionNavigationOccurred = false
    selection.setPosition(first.firstChild, 0)
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
    await new Promise(requestAnimationFrame)
    return { moved, nativeMoved, stopped: !engine.projectionNavigationOccurred }
  }, engineSource)
  expect(result).toEqual({ moved: true, nativeMoved: true, stopped: true })
})

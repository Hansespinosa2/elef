import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseHTML } from "linkedom"

const source = (await readFile(new URL("../../../app/javascript/controllers/editor_math.js", import.meta.url), "utf8"))
  .replace('from "katex"', `from "${new URL("../../../node_modules/katex/dist/katex.mjs", import.meta.url).href}"`)
const editorMath = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("active display math keeps its source delimiters and is editable immediately", () => {
  const { document } = parseHTML("<html><body></body></html>")
  globalThis.document = document

  const sourceText = ["  \\[", "", "x=1", "  \\]"].join("\n")
  const active = editorMath.createActiveMathSpan(sourceText, {
    source: "\n\nx=1\n  ",
    open: "\\[",
    close: "\\]",
    display: true
  })

  assert.equal(active.textContent, sourceText)
  assert.equal(active.dataset.editorMathOpen, "\\[")
  assert.equal(active.dataset.editorMathClose, "\\]")
  assert.equal(active.dataset.editorMathSource, "\n\nx=1\n  ")
  assert.equal(active.dataset.editorMathActive, "true")
  assert.equal(active.contentEditable, true)
  assert.ok(active.classList.contains("editor-live-math-display"))
})

test("completed math renders through the imported KaTeX module", () => {
  const { document } = parseHTML("<html><body></body></html>")
  globalThis.document = document
  const active = editorMath.createActiveMathSpan("$x^2$", { source: "x^2" })
  document.body.append(active)

  const rendered = editorMath.reRenderMath(active)

  assert.ok(rendered.classList.contains("katex"))
  assert.match(rendered.textContent, /x2/)
  delete globalThis.document
})

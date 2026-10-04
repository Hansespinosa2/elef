import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseHTML } from "linkedom"

const source = (await readFile(new URL("../../../app/javascript/controllers/editor_math.js", import.meta.url), "utf8"))
  .replace(/^import "katex"\n/, "")
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

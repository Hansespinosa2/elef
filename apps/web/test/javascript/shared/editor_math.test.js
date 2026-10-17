import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseHTML } from "linkedom"

const source = (await readFile(new URL("../../../../../packages/editor-runtime/dist/controllers/editor_math.js", import.meta.url), "utf8"))
  .replace('import katex from "katex"', "const katex = { renderToString: () => '<span class=katex>x^2</span>' }")
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
  assert.equal(rendered.textContent, "x^2")
  delete globalThis.document
})

test("click retargeted off math by a focus reflow still activates the pressed math", () => {
  const { document } = parseHTML("<html><body><div id=root><p>before <span class=katex data-editor-math-source=x^2><i>x</i></span> after</p></div></body></html>")
  globalThis.document = document
  globalThis.window = { getSelection: () => null }
  const root = document.querySelector("#root")
  const inner = root.querySelector("i")
  const paragraph = root.querySelector("p")

  editorMath.recordMathMousedown({ target: inner, clientX: 100, clientY: 200 }, root)
  const handled = editorMath.handleMathClick(
    { target: paragraph, clientX: 101, clientY: 201, preventDefault: () => {} }, root
  )

  assert.equal(handled, true)
  assert.ok(root.querySelector(".editor-math-active"))
  delete globalThis.document
  delete globalThis.window
})

test("press-and-drag across math does not derender it", () => {
  const { document } = parseHTML("<html><body><div id=root><p>before <span class=katex data-editor-math-source=x^2><i>x</i></span> after</p></div></body></html>")
  globalThis.document = document
  globalThis.window = { getSelection: () => null }
  const root = document.querySelector("#root")
  const inner = root.querySelector("i")
  const paragraph = root.querySelector("p")

  editorMath.recordMathMousedown({ target: inner, clientX: 100, clientY: 200 }, root)
  const handled = editorMath.handleMathClick(
    { target: paragraph, clientX: 160, clientY: 200, preventDefault: () => {} }, root
  )

  assert.equal(handled, false)
  assert.equal(root.querySelector(".editor-math-active"), null)
  delete globalThis.document
  delete globalThis.window
})

test("caretSideOfSpan preserves the caret side across deactivation", () => {
  const { document } = parseHTML("<html><body><div id=root>before <span id=math>x</span> after</div><div id=far>t</div></body></html>")
  const root = document.querySelector("#root")
  const span = document.querySelector("#math")
  const beforeText = root.childNodes[0]
  const afterText = root.childNodes[2]
  const farText = document.querySelector("#far").childNodes[0]
  const spanText = span.childNodes[0]

  assert.equal(editorMath.caretSideOfSpan(span, root, 2), "after")
  assert.equal(editorMath.caretSideOfSpan(span, afterText, 0), "after")
  assert.equal(editorMath.caretSideOfSpan(span, root, 1), "before")
  assert.equal(editorMath.caretSideOfSpan(span, beforeText, 6), "before")
  assert.equal(editorMath.caretSideOfSpan(span, span, 0), null)
  assert.equal(editorMath.caretSideOfSpan(span, spanText, 1), null)
  assert.equal(editorMath.caretSideOfSpan(span, farText, 0), null)
  assert.equal(editorMath.caretSideOfSpan(span, null, 0), null)
})

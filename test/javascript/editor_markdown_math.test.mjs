import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseHTML } from "linkedom"

const source = (await readFile(new URL("../../app/javascript/controllers/editor_markdown.js", import.meta.url), "utf8"))
  .replace('from "katex"', `from "${new URL("../../node_modules/katex/dist/katex.mjs", import.meta.url).href}"`)
const editorMarkdown = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("active display math preserves its block delimiters and line breaks", () => {
  for (const [opening, closing] of [["$$", "$$"], ["\\[", "\\]"]]) {
    const expected = `${opening}\nx=1\n${closing}`
    const activeMath = {
      dataset: { editorMathActive: "true", editorMathOpen: opening, editorMathClose: closing },
      textContent: expected
    }
    const block = {
      querySelectorAll(selector) {
        return selector.includes(":not([data-editor-math-active])") ? [] : [activeMath]
      }
    }

    assert.equal(
      editorMarkdown.markdownForVisibleText(`${opening}\n\n${closing}`, expected, "paragraph", block),
      expected
    )
  }
})

test("inline math renders through the imported KaTeX module without a global", () => {
  const { document } = parseHTML("<html><body></body></html>")
  globalThis.document = document
  globalThis.NodeFilter = { SHOW_TEXT: 4 }
  globalThis.window = { getSelection: () => null }
  const element = document.createElement("p")
  element.textContent = "Inline $x^2$ math"

  const renderedCount = editorMarkdown.renderInlineMath(element)

  assert.equal(renderedCount, 1)
  assert.ok(element.querySelector(".katex"))
  delete globalThis.document
  delete globalThis.NodeFilter
  delete globalThis.window
})

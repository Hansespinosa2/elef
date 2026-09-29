import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = (await readFile(new URL("../../app/javascript/controllers/editor_markdown.js", import.meta.url), "utf8"))
  .replace(/^import "katex"\n/, "")
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

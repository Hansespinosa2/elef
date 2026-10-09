import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const moduleSource = await readFile(new URL("../../app/javascript/controllers/editor_markdown.js", import.meta.url), "utf8")
assert.match(moduleSource, /^import katex from "katex"/)
assert.doesNotMatch(moduleSource, /globalThis\.katex/)
const source = moduleSource.replace('import katex from "katex"', "const katex = { renderToString: () => '<span class=katex>x^2</span>' }")
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
  const mathClasses = new Set()
  const mathNode = { dataset: {}, classList: { add: name => mathClasses.add(name) }, contentEditable: null }
  const sourceNode = {
    textContent: "Inline $x^2$ math",
    parentElement: null,
    replaceWith(fragment) { this.replacement = fragment }
  }
  let treeWalkerUsed = false
  const fragments = []
  globalThis.document = {
    createTreeWalker() {
      return {
        nextNode() {
          if (treeWalkerUsed) return false
          treeWalkerUsed = true
          this.currentNode = sourceNode
          return true
        }
      }
    },
    createDocumentFragment() {
      const fragment = { children: [], append(node) { this.children.push(node) } }
      fragments.push(fragment)
      return fragment
    },
    createTextNode(textContent) { return { textContent } },
    createElement() {
      const wrapper = { firstElementChild: null }
      Object.defineProperty(wrapper, "innerHTML", {
        set(value) {
          assert.equal(value, "<span class=katex>x^2</span>")
          wrapper.firstElementChild = mathNode
        }
      })
      return wrapper
    }
  }
  globalThis.NodeFilter = { SHOW_TEXT: 4 }
  globalThis.window = { getSelection: () => null }

  try {
    assert.equal(editorMarkdown.renderInlineMath({}), 1)
    assert.equal(mathNode.dataset.editorMathSource, "x^2")
    assert.equal(mathClasses.has("editor-live-math-display"), false)
    assert.equal(Object.hasOwn(globalThis, "katex"), false)
    assert.equal(fragments.length, 1)
  } finally {
    delete globalThis.document
    delete globalThis.NodeFilter
    delete globalThis.window
  }
})

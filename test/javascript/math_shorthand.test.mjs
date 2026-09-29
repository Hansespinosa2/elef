import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = (await readFile(new URL("../../app/javascript/controllers/math_shorthand_controller.js", import.meta.url), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { syntaxTree } from "@codemirror/language"', "const syntaxTree = (state) => state.tree")
  .replace('import { editorFor } from "controllers/editor_controller"', "const editorFor = () => null")
const math = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("serializes only the supported v1 math transforms", () => {
  assert.equal(math.expandMathShorthand("x.b"), "\\mathbf{x}")
  assert.equal(math.expandMathShorthand("\\alpha.b"), "\\boldsymbol{\\alpha}")
  assert.equal(math.expandMathShorthand("@a.b"), "\\boldsymbol{\\alpha}")
  assert.equal(math.expandMathShorthand("R.bb"), "\\mathbb{R}")
  assert.equal(math.expandMathShorthand("x.vec"), "\\vec{x}")
  assert.equal(math.expandMathShorthand("A.t"), "A^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.T"), "A^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.inv"), "A^{-1}")
  assert.equal(math.expandMathShorthand("x.b.vec.t"), "\\vec{\\mathbf{x}}^{\\mathsf{T}}")
})

test("preserves mathematical postfix sequence and rejects deferred grammar", () => {
  assert.equal(math.expandMathShorthand("A.inv.t"), "\\left(A^{-1}\\right)^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.t.inv"), "\\left(A^{\\mathsf{T}}\\right)^{-1}")
  assert.notEqual(math.expandMathShorthand("A.inv.t"), math.expandMathShorthand("A.t.inv"))
  for (const source of ["x.invalid", "x.hat", "x.abs", "x.sqrt", "x.b.bb", "x.vec.vec"]) {
    assert.equal(math.expandMathShorthand(source), null)
  }
})

test("finds a complete active chain at a cursor inside its source", () => {
  assert.deepEqual(
    (({ start, end, source, expansion }) => ({ start, end, source, expansion }))(math.mathShorthandAt("$x.b.vec.t$", 4)),
    { start: 1, end: 10, source: "x.b.vec.t", expansion: "\\vec{\\mathbf{x}}^{\\mathsf{T}}" }
  )
  assert.equal(math.mathShorthandAt("`$x.b$`", 4), null)
  assert.equal(math.mathShorthandAt("```\n$x.b$\n```", 7), null)
})

test("pairs, promotes, and skips math delimiters without touching code or escapes", () => {
  assert.equal(math.mathDollarAction("text", 4), "pair")
  assert.equal(math.mathDollarAction("$$", 1), "promote")
  assert.equal(math.mathDollarAction("$$$$", 2), "skip")
  assert.equal(math.mathDollarAction("`code`", 3), "literal")
  assert.equal(math.mathDollarAction("```\ncode\n```", 6), "literal")
  assert.equal(math.mathDollarAction("\\", 1), "literal")
  assert.equal(math.mathDollarAction("$x$", 2), "skip")
})

test("keeps a chain active while the author inserts another operation", () => {
  const listeners = new Map()
  const editor = {
    value: "$x.b$",
    selectionStart: 4,
    selectionEnd: 4,
    insertMode: true,
    lineSeparator: "\n",
    dom: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: () => {}
    },
    form: null,
    replaceRange(insert, from, to = from) {
      this.value = this.value.slice(0, from) + insert + this.value.slice(to)
      this.selectionStart = this.selectionEnd = from + insert.length
    },
    setSelectionRange(from, to = from) { this.selectionStart = from; this.selectionEnd = to }
  }
  const doc = {
    get length() { return editor.value.length },
    lineAt(position) {
      const from = editor.value.lastIndexOf("\n", position - 1) + 1
      const nextLine = editor.value.indexOf("\n", position)
      const to = nextLine === -1 ? editor.value.length : nextLine
      return { from, to, text: editor.value.slice(from, to) }
    },
    sliceString(from, to, separator = "\n") { return editor.value.slice(from, to).replaceAll("\n", separator) }
  }
  editor.view = { state: { doc, tree: { resolveInner: () => ({ name: "Paragraph", from: 0, parent: null }) } } }
  const controller = new math.default()
  controller.editorController = editor
  controller.setupEditor()

  const type = (character) => {
    const keydown = { key: character, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    listeners.get("keydown")(keydown)
    if (!keydown.defaultPrevented) {
      editor.value = editor.value.slice(0, editor.selectionStart) + character + editor.value.slice(editor.selectionEnd)
      editor.selectionStart = editor.selectionEnd = editor.selectionStart + character.length
    }
    listeners.get("keyup")({ key: character })
  }

  for (const character of ".vec.t") type(character)
  assert.equal(editor.value, "$x.b.vec.t$")

  const commit = { key: "Tab", defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  listeners.get("keydown")(commit)
  assert.equal(commit.defaultPrevented, true)
  assert.equal(editor.value, "$\\vec{\\mathbf{x}}^{\\mathsf{T}}$")
})

test("distinguishes source, inline math, display math, code, and Mermaid contexts", () => {
  assert.equal(math.mathContextAt("text", 2), null)
  assert.equal(math.mathContextAt("$x$", 2), "inline_math")
  assert.equal(math.mathContextAt("$$x$$", 3), "display_math")
  assert.equal(math.sourceContextAt("`code`", 3), "code_span")
  assert.equal(math.sourceContextAt("```text\nx\n```", 8), "code_fence")
  assert.equal(math.sourceContextAt("```mermaid\nflowchart TD", 20), "mermaid")
})

test("runs 1,000 math assist edits in a 5,000-character active region within the latency gate", () => {
  const prefix = `$${"x+".repeat(2498)}`
  const state = { tree: { resolveInner: () => ({ name: "Paragraph", from: 0, parent: null }) } }
  const doc = {
    text: `${prefix}x.b`,
    get length() { return this.text.length },
    lineAt(position) {
      const from = this.text.lastIndexOf("\n", position - 1) + 1
      const nextLine = this.text.indexOf("\n", position)
      const to = nextLine === -1 ? this.text.length : nextLine
      return { from, to, text: this.text.slice(from, to) }
    },
    sliceString(from, to, separator = "\n") { return this.text.slice(from, to).replaceAll("\n", separator) }
  }
  state.doc = doc
  const editor = { view: { state } }
  const timings = []
  for (let index = 0; index < 1000; index += 1) {
    doc.text = `${prefix}${index % 2 ? "x.b.vec.t" : "x.b.vec"}`
    const caret = doc.length
    const before = performance.now()
    assert.equal(math.editorInsideMath(editor, caret), true)
    assert.ok(math.mathShorthandAtEditor(editor, caret))
    timings.push(performance.now() - before)
  }
  const sorted = timings.toSorted((left, right) => left - right)
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)]
  const max = sorted.at(-1)
  assert.ok(p95 < 5, `p95 was ${p95.toFixed(3)} ms`)
  assert.ok(p99 < 10, `p99 was ${p99.toFixed(3)} ms`)
  assert.ok(max < 16, `maximum was ${max.toFixed(3)} ms`)
})

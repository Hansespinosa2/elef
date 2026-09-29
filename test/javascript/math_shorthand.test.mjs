import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = (await readFile(new URL("../../app/javascript/controllers/math_shorthand_controller.js", import.meta.url), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { syntaxTree } from "@codemirror/language"', "const syntaxTree = (state) => state.tree")
  .replace('import { editorFor } from "controllers/editor_controller"', "const editorFor = () => null")
const math = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)
globalThis.__mathTestHelpers = math
const paletteSource = (await readFile(new URL("../../app/javascript/controllers/math_shortcut_palette_controller.js", import.meta.url), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { editorFor } from "controllers/editor_controller"', "const editorFor = () => null")
  .replace('import { application } from "controllers/application"', "const application = { getControllerForElementAndIdentifier: () => null }")
  .replace('import { editorInsideMath, mathShorthandAtEditor, parseMathShorthand } from "controllers/math_shorthand_controller"', "const { editorInsideMath, mathShorthandAtEditor, parseMathShorthand } = globalThis.__mathTestHelpers")
  .replace('import { authoringRegistryFor } from "controllers/authoring_registry"', "const authoringRegistryFor = () => []")
const mathPalette = await import(`data:text/javascript;base64,${Buffer.from(paletteSource).toString("base64")}`)
delete globalThis.__mathTestHelpers

test("serializes v1 math transforms and the existing bar decoration", () => {
  assert.equal(math.expandMathShorthand("x.b"), "\\mathbf{x}")
  assert.equal(math.expandMathShorthand("\\alpha.b"), "\\boldsymbol{\\alpha}")
  assert.equal(math.expandMathShorthand("@a.b"), "\\boldsymbol{\\alpha}")
  assert.equal(math.expandMathShorthand("R.bb"), "\\mathbb{R}")
  assert.equal(math.expandMathShorthand("x.vec"), "\\vec{x}")
  assert.equal(math.expandMathShorthand("x.bar"), "\\bar{x}")
  assert.equal(math.expandMathShorthand("x.bar.b"), "\\bar{\\mathbf{x}}")
  assert.equal(math.expandMathShorthand("A.t"), "A^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.T"), "A^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.inv"), "A^{-1}")
  assert.equal(math.expandMathShorthand("x.b.vec.t"), "\\vec{\\mathbf{x}}^{\\mathsf{T}}")
})

test("supports local hat and tilde decorations in valid postfix chains", () => {
  assert.equal(math.expandMathShorthand("x.hat"), "\\hat{x}")
  assert.equal(math.expandMathShorthand("x.tilde"), "\\tilde{x}")
  assert.equal(math.expandMathShorthand("@a.hat"), "\\hat{\\alpha}")
  assert.equal(math.expandMathShorthand("x.b.hat"), "\\hat{\\mathbf{x}}")
  assert.equal(math.expandMathShorthand("x.tilde.t"), "\\tilde{x}^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("x.hat.tilde"), null)
})

test("preserves mathematical postfix sequence and rejects deferred grammar", () => {
  assert.equal(math.expandMathShorthand("A.inv.t"), "\\left(A^{-1}\\right)^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.t.inv"), "\\left(A^{\\mathsf{T}}\\right)^{-1}")
  assert.notEqual(math.expandMathShorthand("A.inv.t"), math.expandMathShorthand("A.t.inv"))
  for (const source of ["x.invalid", "x.abs", "x.sqrt", "x.b.bb", "x.vec.bar", "x.vec.vec"]) {
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
    editingMode: "source",
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

test("keeps a chain active while the caret moves inside it and commits after leaving", () => {
  const listeners = new Map()
  const editor = {
    value: "$x.vec.t$",
    selectionStart: 8,
    selectionEnd: 8,
    editingMode: "source",
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

  const move = (key, caret) => {
    listeners.get("keydown")({ key, defaultPrevented: false })
    editor.setSelectionRange(caret)
    listeners.get("keyup")({ key })
  }

  move("ArrowLeft", 7)
  assert.equal(editor.value, "$x.vec.t$")
  assert.equal(controller.pendingChain.source, "x.vec.t")

  move("End", editor.value.length)
  assert.equal(editor.value, "$\\vec{x}^{\\mathsf{T}}$")
  assert.equal(controller.pendingChain, null)
})

test("distinguishes source, inline math, display math, code, and Mermaid contexts", () => {
  assert.equal(math.mathContextAt("text", 2), null)
  assert.equal(math.mathContextAt("$x$", 2), "inline_math")
  assert.equal(math.mathContextAt("$$x$$", 3), "display_math")
  assert.equal(math.sourceContextAt("`code`", 3), "code_span")
  assert.equal(math.sourceContextAt("```text\nx\n```", 8), "code_fence")
  assert.equal(math.sourceContextAt("```mermaid\nflowchart TD", 20), "mermaid")
})

test("uses the editor syntax tree to classify code and scan only the active math block", () => {
  const prose = "unrelated prose\n".repeat(1000)
  const text = `${prose}$x.b`
  const from = prose.length
  const doc = {
    length: text.length,
    lineAt(position) {
      const lineFrom = text.lastIndexOf("\n", position - 1) + 1
      const nextLine = text.indexOf("\n", position)
      const to = nextLine === -1 ? text.length : nextLine
      return { from: lineFrom, to, text: text.slice(lineFrom, to) }
    },
    sliceString(start, end, separator = "\n") {
      this.lastSlice = [start, end]
      return text.slice(start, end).replaceAll("\n", separator)
    }
  }
  const editor = {
    view: { state: { doc, tree: { resolveInner: () => ({ name: "Text", from, parent: { name: "Paragraph", from, parent: null } }) } } }
  }

  assert.equal(math.editorInsideMath(editor, text.length), true)
  assert.deepEqual(doc.lastSlice, [from, text.length])

  const fencedEditor = {
    view: {
      state: {
        doc: { length: 30, lineAt: () => ({ text: "```mermaid" }) },
        tree: { resolveInner: () => ({ name: "CodeText", parent: { name: "FencedCode", from: 0, parent: null } }) }
      }
    }
  }
  assert.equal(math.editorSourceContextAt(fencedEditor, 15), "mermaid")
  assert.equal(math.editorInsideMath(fencedEditor, 15), false)
})

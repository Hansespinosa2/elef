import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { performance } from "node:perf_hooks"

async function importVendoredModule(filename, imports = {}) {
  const vendorRoot = new URL("../../vendor/javascript/", import.meta.url)
  let moduleSource = await readFile(new URL(filename, vendorRoot), "utf8")
  for (const [specifier, url] of Object.entries(imports)) {
    moduleSource = moduleSource.replaceAll(JSON.stringify(specifier), JSON.stringify(url))
  }
  const url = `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`
  return { url, module: await import(url) }
}

const lezerCommon = await importVendoredModule("@lezer--common.js")
const findClusterBreak = await importVendoredModule("@marijn--find-cluster-break.js")
const lezerHighlight = await importVendoredModule("@lezer--highlight.js", { "@lezer/common": lezerCommon.url })
const lezerMarkdown = await importVendoredModule("@lezer--markdown.js", {
  "@lezer/common": lezerCommon.url,
  "@lezer/highlight": lezerHighlight.url
})
const codemirrorState = await importVendoredModule("@codemirror--state.js", {
  "@marijn/find-cluster-break": findClusterBreak.url
})

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
  .replace('import { editorInsideMath, expandMathShorthand, mathShorthandAtEditor, parseMathShorthand } from "controllers/math_shorthand_controller"', "const { editorInsideMath, expandMathShorthand, mathShorthandAtEditor, parseMathShorthand } = globalThis.__mathTestHelpers")
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

test("chains shorthand modifiers after an already-expanded head", () => {
  assert.equal(math.expandMathShorthand("\\mathbf{x}^{\\mathsf{T}}.tilde"), "\\tilde{\\mathbf{x}}^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("\\boldsymbol{\\theta}^{\\mathsf{T}}.tilde"), "\\tilde{\\boldsymbol{\\theta}}^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("\\left(\\bar{\\mathbf{x}}^{\\mathsf{T}}\\right)^{-1}.hat"), null)
  assert.equal(math.parseMathShorthand("\\left(\\bar{\\mathbf{x}}^{\\mathsf{T}}\\right)^{-1}.hat")?.status, "invalid")
})

test("transforms supported existing canonical LaTeX atoms from their visible source", () => {
  assert.equal(math.expandMathShorthand("x.t"), "x^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("\\mathbf{x}.t"), "\\mathbf{x}^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("\\vec{x}.t"), "\\vec{x}^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("x.inv"), "x^{-1}")
  assert.equal(math.expandMathShorthand("\\mathbf{x}.inv"), "\\mathbf{x}^{-1}")
  assert.equal(math.expandMathShorthand("\\vec{x}.inv"), "\\vec{x}^{-1}")
  assert.equal(math.expandMathShorthand("\\mathbf{x+y}.t"), null)
  assert.equal(math.expandMathShorthand("(x+y).t"), null)
})

test("preserves mathematical postfix sequence and rejects deferred grammar", () => {
  assert.equal(math.expandMathShorthand("A.inv.t"), "\\left(A^{-1}\\right)^{\\mathsf{T}}")
  assert.equal(math.expandMathShorthand("A.t.inv"), "\\left(A^{\\mathsf{T}}\\right)^{-1}")
  assert.notEqual(math.expandMathShorthand("A.inv.t"), math.expandMathShorthand("A.t.inv"))
  for (const source of ["x.invalid", "x.abs", "x.sqrt", "x.b.bb", "x.vec.bar", "x.vec.vec"]) {
    assert.equal(math.expandMathShorthand(source), null)
  }
})

test("validates merged modifier classes and expands in canonical order", () => {
  assert.equal(math.expandMathShorthand("x.b.bb"), null)
  assert.equal(math.expandMathShorthand("x.b.t.bb"), null)
  assert.equal(math.expandMathShorthand("x.b.t.inv.hat"), "\\left(\\hat{\\mathbf{x}}^{\\mathsf{T}}\\right)^{-1}")
  assert.equal(math.expandMathShorthand("x.b.t.tilde.inv"), "\\left(\\tilde{\\mathbf{x}}^{\\mathsf{T}}\\right)^{-1}")
  assert.equal(math.expandMathShorthand("x.b.hat.t.inv.tilde"), null)
})

test("parses expanded font, accent, and postfix wrappers idempotently", () => {
  const vectors = [
    "x.b",
    "x.b.t",
    "x.b.t.inv",
    "x.b.t.inv.hat",
    "@a.b.tilde.t",
    "\\mathbf{x}^{\\mathsf{T}}.tilde",
    "\\left(\\tilde{\\mathbf{x}}^{\\mathsf{T}}\\right)^{-1}",
    "\\mathcal{A}.t",
    "\\mathrm{x}.t"
  ]

  for (const source of vectors) {
    const expansion = math.expandMathShorthand(source)
    assert.ok(expansion, `${source} should parse`)
    assert.equal(math.parseMathShorthand(expansion)?.status, "valid", `${expansion} should parse as an expanded head`)
    assert.equal(math.expandMathShorthand(expansion), expansion, `${source} should reach a stable expansion`)
  }

  const parsed = math.parseMathShorthand("\\mathbf{x}^{\\mathsf{T}}.tilde")
  assert.equal(parsed.base, "x")
  assert.deepEqual(parsed.modifiers, ["bold", "transpose", "tilde"])
})

test("unknown LaTeX wrappers are not treated as chainable atoms", () => {
  assert.equal(math.parseMathShorthand("\\overline{x}.t"), null)
  assert.equal(math.expandMathShorthand("\\overline{x}.t"), null)
})

test("palette extracts and previews a full expanded math chain", () => {
  const text = "$\\left(\\mathbf{x}^{\\mathsf{T}}\\right)^{-1}.ti$"
  const caret = text.length - 1
  const doc = {
    length: text.length,
    lineAt: () => ({ from: 0, to: text.length, text }),
    sliceString: (from, to, separator = "\n") => text.slice(from, to).replaceAll("\n", separator)
  }
  const editor = {
    editingMode: "source",
    selectionStart: caret,
    selectionEnd: caret,
    view: { state: { doc, tree: { resolveInner: () => ({ name: "Text", parent: { name: "Paragraph", from: 0, parent: null } }) } } }
  }
  const palette = new mathPalette.default()
  palette.editorController = editor

  const query = palette.queryAtCaret()
  assert.deepEqual(query, {
    prefix: ".",
    text: "ti",
    start: 1,
    base: "\\left(\\mathbf{x}^{\\mathsf{T}}\\right)^{-1}",
    baseStart: 1
  })
  assert.equal(palette.previewExpansion({ prefix: ".", aliases: ["tilde"], expansion: "\\tilde{${1:x}}" }, query), "\\left(\\tilde{\\mathbf{x}}^{\\mathsf{T}}\\right)^{-1}")
})

test("finds a complete active chain at a cursor inside its source", () => {
  assert.deepEqual(
    (({ start, end, source, expansion }) => ({ start, end, source, expansion }))(math.mathShorthandAt("$x.b.vec.t$", 4)),
    { start: 1, end: 10, source: "x.b.vec.t", expansion: "\\vec{\\mathbf{x}}^{\\mathsf{T}}" }
  )
  assert.equal(math.mathShorthandAt("`$x.b$`", 4), null)
  assert.equal(math.mathShorthandAt("```\n$x.b$\n```", 7), null)
  assert.deepEqual(
    (({ start, end, source, expansion }) => ({ start, end, source, expansion }))(math.mathShorthandAt("$\\mathbf{x}.t$", 13)),
    { start: 1, end: 13, source: "\\mathbf{x}.t", expansion: "\\mathbf{x}^{\\mathsf{T}}" }
  )
  const expandedPostfixChain = "$\\left(\\mathbf{x}^{\\mathsf{T}}\\right)^{-1}.tilde$"
  const expandedChain = math.mathShorthandAt(expandedPostfixChain, expandedPostfixChain.length - 1)
  assert.equal(expandedChain.source, "\\left(\\mathbf{x}^{\\mathsf{T}}\\right)^{-1}.tilde")
  assert.equal(expandedChain.expansion, "\\left(\\tilde{\\mathbf{x}}^{\\mathsf{T}}\\right)^{-1}")

  const text = "$\\vec{x}.inv$"
  const doc = {
    length: text.length,
    lineAt: () => ({ from: 0, to: text.length, text }),
    sliceString: (from, to, separator = "\n") => text.slice(from, to).replaceAll("\n", separator)
  }
  const editor = { view: { state: { doc, tree: { resolveInner: () => ({ name: "Text", parent: { name: "Paragraph", from: 0, parent: null } }) } } } }
  const chain = math.mathShorthandAtEditor(editor, text.length - 1)
  assert.equal(chain.source, "\\vec{x}.inv")
  assert.equal(chain.expansion, "\\vec{x}^{-1}")
})

test("commits canonical atom chains on an explicit whole-editor commit", () => {
  const editor = {
    value: "$\\mathbf{x}.t$ and $\\vec{y}.inv$",
    replaceRanges(changes) {
      for (const change of [...changes].sort((left, right) => right.from - left.from)) {
        this.value = `${this.value.slice(0, change.from)}${change.insert}${this.value.slice(change.to)}`
      }
    }
  }
  const controller = new math.default()
  controller.editorController = editor
  controller.commitAll()

  assert.equal(editor.value, "$\\mathbf{x}^{\\mathsf{T}}$ and $\\vec{y}^{-1}$")
})

test("commitAll leaves already-expanded chains unchanged", () => {
  const committed = "$\\left(\\tilde{\\mathbf{x}}^{\\mathsf{T}}\\right)^{-1}$ and $\\boldsymbol{\\theta}^{\\mathsf{T}}$"
  const editor = {
    value: committed,
    replaceRanges() { throw new Error("already-expanded chains should not be replaced") }
  }
  const controller = new math.default()
  controller.editorController = editor
  controller.commitAll()

  assert.equal(editor.value, committed)
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

test("Enter in an empty paired display-math delimiter creates a blank body line", () => {
  const listeners = new Map()
  const editor = {
    value: "$$$$",
    selectionStart: 2,
    selectionEnd: 2,
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
  let inCodeFence = false
  editor.view = {
    state: {
      doc,
      tree: {
        resolveInner: () => inCodeFence
          ? ({ name: "CodeText", parent: { name: "FencedCode", from: 0, parent: null } })
          : ({ name: "Text", parent: { name: "Paragraph", from: 0, parent: null } })
      }
    }
  }
  const controller = new math.default()
  controller.editorController = editor
  controller.setupEditor()

  const event = { key: "Enter", defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  listeners.get("keydown")(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(editor.value, "$$\n\n$$")
  assert.equal(editor.selectionStart, 3)
  assert.equal(editor.selectionEnd, 3)

  editor.value = "$x$"
  editor.setSelectionRange(2)
  const inlineEnter = { key: "Enter", defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  listeners.get("keydown")(inlineEnter)
  assert.equal(inlineEnter.defaultPrevented, false)
  assert.equal(editor.value, "$x$")

  editor.value = "```\n$$$$\n```"
  editor.setSelectionRange(6)
  inCodeFence = true
  const codeEnter = { key: "Enter", defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  listeners.get("keydown")(codeEnter)
  assert.equal(codeEnter.defaultPrevented, false)
  assert.equal(editor.value, "```\n$$$$\n```")
})

test("keeps a chain active while the author inserts another operation", () => {
  const listeners = new Map()
  const editor = {
    value: "$x$",
    selectionStart: 2,
    selectionEnd: 2,
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

  for (const character of ".b.t") type(character)
  assert.equal(editor.value, "$x.b.t$")

  const commit = { key: "Tab", defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  listeners.get("keydown")(commit)
  assert.equal(commit.defaultPrevented, true)
  assert.equal(editor.value, "$\\mathbf{x}^{\\mathsf{T}}$")

  for (const character of ".tilde") type(character)
  assert.equal(editor.value, "$\\mathbf{x}^{\\mathsf{T}}.tilde$")

  const expandedCommit = { key: "Tab", defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  listeners.get("keydown")(expandedCommit)
  assert.equal(expandedCommit.defaultPrevented, true)
  assert.equal(editor.value, "$\\tilde{\\mathbf{x}}^{\\mathsf{T}}$")
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

test("keeps synchronous math assist within the performance gate during 1,000 real editor-state edits", (t) => {
  const { EditorState } = codemirrorState.module
  const body = "x + ".repeat(1250)
  const source = `$$${body}$$`
  assert.equal(body.length, 5000)

  let editorState = EditorState.create({ doc: source })
  let viewState = { doc: editorState.doc, tree: lezerMarkdown.module.parser.parse(editorState.doc.toString()) }
  const editor = { view: { get state() { return viewState } } }
  const editPosition = 2 + 4500
  const measurements = []

  for (let edit = 0; edit < 1100; edit += 1) {
    const replacement = edit % 2 === 0 ? "y" : "x"
    editorState = editorState.update({
      changes: { from: editPosition, to: editPosition + 1, insert: replacement }
    }).state
    viewState = {
      doc: editorState.doc,
      tree: lezerMarkdown.module.parser.parse(editorState.doc.toString())
    }

    const startedAt = performance.now()
    const chain = math.mathShorthandAtEditor(editor, editPosition + 1)
    const elapsed = performance.now() - startedAt
    assert.equal(chain, null)
    if (edit >= 100) measurements.push(elapsed)
  }

  const sorted = measurements.toSorted((a, b) => a - b)
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1]
  const maximum = sorted.at(-1)
  t.diagnostic(`Math assist: p95 ${p95.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${maximum.toFixed(3)} ms`)
  assert.ok(p95 < 5, `p95 was ${p95.toFixed(3)} ms (limit 5 ms)`)
  assert.ok(p99 < 10, `p99 was ${p99.toFixed(3)} ms (limit 10 ms)`)
  assert.ok(maximum < 16, `maximum was ${maximum.toFixed(3)} ms (limit 16 ms)`)
})

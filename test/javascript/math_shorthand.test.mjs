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
  .replace('import { snippetStopsEffect } from "controllers/snippet_stops"', "const snippetStopsEffect = { of: (value) => value }")
const mathPalette = await import(`data:text/javascript;base64,${Buffer.from(paletteSource).toString("base64")}`)
delete globalThis.__mathTestHelpers

test("rejects unknown @ shortcuts instead of wrapping their source text", () => {
  assert.equal(math.expandMathShorthand("@alpha.b"), null)
})

test("rejects lowercase operands for the blackboard font", () => {
  assert.equal(math.expandMathShorthand("x.bb"), null)
})

test("refuses fonts on atomic LaTeX commands instead of emitting silent wrappers", async (t) => {
  for (const command of ["Im", "Re", "wp", "ell", "hbar", "nabla", "partial", "infty"]) {
    await t.test(`\\${command}`, () => {
      assert.equal(math.expandMathShorthand(`\\${command}.b`), null)
    })
  }
})

test("matches the curated parser acceptance rows", () => {
  const cases = [
    ["x.bb.tilde.inv", null],
    ["@a.b.hat.t", "\\hat{\\boldsymbol{\\alpha}}^\\top"],
    ["@g.bb.vec.inv", null],
    ["@r.tilde.t.inv", "\\left(\\tilde{\\rho}^\\top\\right)^{-1}"],
    ["@n.bar.inv.t", "\\left(\\bar{\\nu}^{-1}\\right)^\\top"],
    ["\\alpha.bb.hat.t", null],
    ["\\Omega.b.vec.inv", "\\vec{\\boldsymbol{\\Omega}}^{-1}"],
    ["\\nabla.b.t", null],
    ["\\partial.inv", "\\partial^{-1}"],
    ["\\infty.t", "\\infty^\\top"],
    ["\\ell.bb", null],
    ["\\hbar.hat", "\\hat{\\hbar}"],
    ["\\Re.t", "\\Re^\\top"],
    ["\\mathbf{x}.bar.inv", "\\bar{\\mathbf{x}}^{-1}"],
    ["\\mathbb{R}.hat.t", "\\hat{\\mathbb{R}}^\\top"],
    ["\\vec{v}.bb", null],
    ["\\hat{x}.b.inv", "\\hat{\\mathbf{x}}^{-1}"],
    ["\\tilde{\\alpha}.vec.t", "\\vec{\\tilde{\\alpha}}^\\top"],
    ["x.v.t", "\\vec{x}^\\top"],
    ["x.bb.b", null],
    ["@a.b.b", "\\boldsymbol{\\alpha}"],
    ["x.bar.hat", "\\hat{\\bar{x}}"],
    ["x.tilde.vec", "\\vec{\\tilde{x}}"],
    ["x.bar.bar", "\\bar{x}"],
    ["A.T.T", "\\left(A^\\top\\right)^\\top"],
    ["A.inv.T.inv", null],
    ["x.inv.t.inv", null],
    ...["x.bold", "x.blackboard", "x.vector", "x.transpose", "x.inverse", "x.Hat", "x.VEC", "x.b2", "x.2b", "x.b_b", "x..b"].map((source) => [source, null]),
    ...["xy.b", "xyz.tilde", "2.b", "x.2", "\\sum.t", "\\prod.b", "\\log.b", "\\sin.t", "\\frac12.b", "\\mathbf{xy}.t", "\\vec{ab}.inv", "\\hat{}.b"].map((source) => [source, null]),
    ...["@e.b", "@theta.vec", "@lambda.t", "@x.inv", "@foo.bb.bar"].map((source) => [source, null]),
    ["x.v", "\\vec{x}"],
    ["x.T", "x^\\top"],
    ["x.b.vec.t.inv", "\\left(\\vec{\\mathbf{x}}^\\top\\right)^{-1}"],
    ["@a.b.t", "\\boldsymbol{\\alpha}^\\top"],
    ["@a.t.b", "\\boldsymbol{\\alpha}^\\top"],
    ["x.hat.bb", null],
    ["\\mathbf{x}.t.inv", "\\left(\\mathbf{x}^\\top\\right)^{-1}"],
    ["@D.bb", null],
    ["@a.b.c", null],
    ["x.b.", null],
    ["x_i.b", "\\mathbf{x}_i"],
    ["x^i.b", "\\mathbf{x}^i"],
    ["x^2.b", "\\mathbf{x}^2"],
    ["A_i.t", "A_i^\\top"],
    ["x_{ij}.b", "\\mathbf{x}_{ij}"],
    ["\\eta_\\mu.t", "\\eta_\\mu^\\top"],
    ["x^{i.b}", "x^{\\mathbf{i}}"],
    ["x.b.bar.b", "\\bar{\\mathbf{x}}"],
    ["x.hat.hat", "\\hat{x}"],
    ["x.vec.dot", "\\dot{\\vec{x}}"],
    ["x.dot", "\\dot{x}"],
    ["x.ddot", "\\ddot{x}"],
    ["A.dag", "A^\\dagger"],
    ["A.dagger", "A^\\dagger"],
    ["x.star", "x^\\star"],
    ["A.prime", "A'"],
    ["A.prime.t", "\\left(A'\\right)^\\top"],
    ["L.rm", "\\mathrm{L}"],
    ["x.b.hat.t", "\\hat{\\mathbf{x}}^\\top"],
    ["\\mathbf{x}.hat", "\\hat{\\mathbf{x}}"],
    ["\\boldsymbol{\\alpha}.vec", "\\vec{\\boldsymbol{\\alpha}}"],
    ["E.bb", "\\mathbb{E}"]
  ]

  for (const [source, expected] of cases) {
    assert.equal(math.expandMathShorthand(source), expected, source)
  }
})

function palettePreview(shortcut, query) {
  return new mathPalette.default().expansionPreview(shortcut, query)
}

function stubElement() {
  return {
    id: "",
    title: "",
    type: "",
    role: "",
    className: "",
    textContent: "",
    dataset: {},
    attributes: {},
    children: [],
    hidden: true,
    setAttribute(name, value) { this.attributes[name] = value },
    getAttribute(name) { return this.attributes[name] ?? null },
    addEventListener() {},
    append(...nodes) { this.children.push(...nodes) },
    replaceChildren() { this.children = [] },
    querySelectorAll() { return [] },
    querySelector() { return null },
    getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, width: 0, height: 0 } }
  }
}

function renderPaletteOption(shortcut, query) {
  const previousDocument = globalThis.document
  globalThis.document = { createElement: () => stubElement() }
  try {
    const controller = new mathPalette.default()
    controller.paletteTarget = stubElement()
    controller.matches = [shortcut]
    controller.query = query
    controller.render()
    return controller.paletteTarget.children.at(0)
  } finally {
    globalThis.document = previousDocument
  }
}

const INVERSE_SHORTCUT = { id: "default-inverse", name: "Inverse", aliases: ["inv", "inverse"], prefix: ".", description: "Take the inverse of an object", expansion: "${1}^{-1}", built_in: true }
const BOLD_SHORTCUT = { id: "default-bold", name: "Bold", aliases: ["b"], prefix: ".", description: "Bold mathematical symbols", expansion: "\\mathbf{${1}}", built_in: true }
const FRACTION_SHORTCUT = { id: "default-frac", name: "Fraction", aliases: ["frac", "fraction"], prefix: "@", description: "Fraction with numerator and denominator", expansion: "\\frac{${1}}{${2}}", built_in: true }

function transformQuery(text, base) {
  return { prefix: ".", text, start: 0, base, baseStart: 0 }
}

function createMathEditor(value, caret) {
  const listeners = new Map()
  const editor = {
    value,
    selectionStart: caret,
    selectionEnd: caret,
    editingMode: "source",
    insertMode: true,
    lineSeparator: "\n",
    dom: {
      addEventListener(name, listener) { listeners.set(name, listener) },
      removeEventListener() {}
    },
    form: null,
    replaceRange(insert, from, to = from) {
      this.value = this.value.slice(0, from) + insert + this.value.slice(to)
      this.selectionStart = this.selectionEnd = from + insert.length
    },
    replaceRanges(changes) {
      let cursor = 0
      const output = []
      for (const change of [...changes].sort((left, right) => left.from - right.from)) {
        output.push(this.value.slice(cursor, change.from), change.insert)
        cursor = change.to
      }
      output.push(this.value.slice(cursor))
      this.value = output.join("")
    },
    setSelectionRange(from, to = from) {
      this.selectionStart = from
      this.selectionEnd = to
    }
  }
  const doc = {
    get length() { return editor.value.length },
    lineAt(position) {
      const from = editor.value.lastIndexOf("\n", Math.max(0, position - 1)) + 1
      const nextLine = editor.value.indexOf("\n", position)
      const to = nextLine === -1 ? editor.value.length : nextLine
      return { from, to, text: editor.value.slice(from, to) }
    },
    sliceString(from, to, separator = "\n") {
      return editor.value.slice(from, to).replaceAll("\n", separator)
    }
  }
  const tree = {
    resolveInner(position) {
      const codeContext = math.sourceContextAt(editor.value, position)
      if (codeContext === "code_span") return { name: "InlineCode", from: 0, parent: null }
      if (codeContext === "code_fence" || codeContext === "mermaid") {
        const lineStart = editor.value.lastIndexOf("\n", Math.max(0, position - 1)) + 1
        return { name: "CodeText", from: position, parent: { name: "FencedCode", from: lineStart, parent: null } }
      }
      return { name: "Text", from: 0, parent: { name: "Paragraph", from: 0, parent: null } }
    }
  }
  editor.view = { state: { doc, tree } }

  const controller = new math.default()
  controller.editorController = editor
  controller.setupEditor()
  return { editor, controller, listeners }
}

function pressMathKey(context, key, options = {}) {
  const { editor, listeners } = context
  const event = {
    key,
    code: options.code,
    isComposing: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true }
  }
  listeners.get("keydown")(event)
  if (!event.defaultPrevented) {
    const insertion = key === "Enter" ? editor.lineSeparator : key === " " ? " " : key.length === 1 ? key : null
    if (insertion !== null) editor.replaceRange(insertion, editor.selectionStart, editor.selectionEnd)
  }
  listeners.get("keyup")(event)
  return event
}

test("serializes v1 math transforms and the existing bar decoration", () => {
  assert.equal(math.expandMathShorthand("x.b"), "\\mathbf{x}")
  assert.equal(math.expandMathShorthand("\\alpha.b"), "\\boldsymbol{\\alpha}")
  assert.equal(math.expandMathShorthand("@a.b"), "\\boldsymbol{\\alpha}")
  assert.equal(math.expandMathShorthand("R.bb"), "\\mathbb{R}")
  assert.equal(math.expandMathShorthand("x.vec"), "\\vec{x}")
  assert.equal(math.expandMathShorthand("x.bar"), "\\bar{x}")
  assert.equal(math.expandMathShorthand("x.bar.b"), "\\bar{\\mathbf{x}}")
  assert.equal(math.expandMathShorthand("A.t"), "A^\\top")
  assert.equal(math.expandMathShorthand("A.T"), "A^\\top")
  assert.equal(math.expandMathShorthand("A.inv"), "A^{-1}")
  assert.equal(math.expandMathShorthand("x.b.vec.t"), "\\vec{\\mathbf{x}}^\\top")
})

test("supports local hat and tilde decorations in valid postfix chains", () => {
  assert.equal(math.expandMathShorthand("x.hat"), "\\hat{x}")
  assert.equal(math.expandMathShorthand("x.tilde"), "\\tilde{x}")
  assert.equal(math.expandMathShorthand("@a.hat"), "\\hat{\\alpha}")
  assert.equal(math.expandMathShorthand("x.b.hat"), "\\hat{\\mathbf{x}}")
  assert.equal(math.expandMathShorthand("x.tilde.t"), "\\tilde{x}^\\top")
  assert.equal(math.expandMathShorthand("x.hat.tilde"), "\\tilde{\\hat{x}}")
})

test("supports calligraphic and roman font modifiers in valid postfix chains", () => {
  assert.equal(math.expandMathShorthand("x.cal"), "\\mathcal{x}")
  assert.equal(math.expandMathShorthand("x.calligraphic"), "\\mathcal{x}")
  assert.equal(math.expandMathShorthand("x.rm"), "\\mathrm{x}")
  assert.equal(math.expandMathShorthand("x.roman"), "\\mathrm{x}")
  assert.equal(math.expandMathShorthand("@q.rm"), "\\mathrm{\\theta}")
  assert.equal(math.expandMathShorthand("x.cal.t"), "\\mathcal{x}^\\top")
  assert.equal(math.expandMathShorthand("x.cal.bb"), null)
  assert.equal(math.expandMathShorthand("x.b.cal"), null)
})

test("chains shorthand modifiers after an already-expanded head", () => {
  assert.equal(math.expandMathShorthand("\\mathbf{x}^\\top.tilde"), "\\tilde{\\mathbf{x}}^\\top")
  assert.equal(math.expandMathShorthand("\\boldsymbol{\\theta}^\\top.tilde"), "\\tilde{\\boldsymbol{\\theta}}^\\top")
  assert.equal(math.expandMathShorthand("\\left(\\bar{\\mathbf{x}}^\\top\\right)^{-1}.hat"), "\\left(\\hat{\\bar{\\mathbf{x}}}^\\top\\right)^{-1}")
  assert.equal(math.parseMathShorthand("\\left(\\bar{\\mathbf{x}}^\\top\\right)^{-1}.hat")?.status, "valid")
})

test("transforms supported existing canonical LaTeX atoms from their visible source", () => {
  assert.equal(math.expandMathShorthand("x.t"), "x^\\top")
  assert.equal(math.expandMathShorthand("\\mathbf{x}.t"), "\\mathbf{x}^\\top")
  assert.equal(math.expandMathShorthand("\\vec{x}.t"), "\\vec{x}^\\top")
  assert.equal(math.expandMathShorthand("x.inv"), "x^{-1}")
  assert.equal(math.expandMathShorthand("\\mathbf{x}.inv"), "\\mathbf{x}^{-1}")
  assert.equal(math.expandMathShorthand("\\vec{x}.inv"), "\\vec{x}^{-1}")
  assert.equal(math.expandMathShorthand("\\mathbf{x+y}.t"), null)
  assert.equal(math.expandMathShorthand("(x+y).t"), null)
})

test("preserves mathematical postfix sequence and rejects deferred grammar", () => {
  assert.equal(math.expandMathShorthand("A.inv.t"), "\\left(A^{-1}\\right)^\\top")
  assert.equal(math.expandMathShorthand("A.t.inv"), "\\left(A^\\top\\right)^{-1}")
  assert.notEqual(math.expandMathShorthand("A.inv.t"), math.expandMathShorthand("A.t.inv"))
  for (const source of ["x.invalid", "x.abs", "x.sqrt", "x.b.bb", "x.hat.vec.dot", "x.bar.hat.tilde"]) {
    assert.equal(math.expandMathShorthand(source), null)
  }
})

test("previews the full shorthand expansion the palette will commit", () => {
  const controller = new mathPalette.default()
  const query = transformQuery("inv", "x.bar.b.t")

  assert.equal(controller.triggerFor(INVERSE_SHORTCUT, query), "x.bar.b.t.inv")
  assert.deepEqual(
    palettePreview(INVERSE_SHORTCUT, query),
    { text: "\\left(\\bar{\\mathbf{x}}^\\top\\right)^{-1}", full: "\\left(\\bar{\\mathbf{x}}^\\top\\right)^{-1}" }
  )
  assert.equal(palettePreview(INVERSE_SHORTCUT, query).full, math.expandMathShorthand("x.bar.b.t.inv"))
})

test("keeps placeholder previews for empty, unparsable, and invalid operator chains", () => {
  assert.deepEqual(palettePreview(INVERSE_SHORTCUT, transformQuery("inv", "")), { text: "x^{-1}", full: "x^{-1}" })
  assert.deepEqual(palettePreview(INVERSE_SHORTCUT, transformQuery("inv", "foo.bar")), { text: "foo.bar^{-1}", full: "foo.bar^{-1}" })
  assert.deepEqual(palettePreview(BOLD_SHORTCUT, transformQuery("b", "x.b")), { text: "\\mathbf{x}", full: "\\mathbf{x}" })
  assert.deepEqual(
    palettePreview(FRACTION_SHORTCUT, { prefix: "@", text: "frac", start: 0, base: "", baseStart: 0 }),
    { text: "\\frac{x}{y}", full: "\\frac{x}{y}" }
  )
})

test("middle-truncates over-budget previews while keeping the full expansion readable", () => {
  const budget = mathPalette.MAX_PREVIEW_LENGTH
  assert.equal(budget, 48)

  const option = renderPaletteOption(INVERSE_SHORTCUT, transformQuery("inv", "\\varphi.b.vec.t"))
  const full = math.expandMathShorthand("\\varphi.b.vec.t.inv")
  const [trigger, name, expansion] = option.children

  assert.equal(trigger.textContent, "\\varphi.b.vec.t.inv")
  assert.equal(name.textContent, "Inverse")
  assert.equal(expansion.textContent, "\\left(\\vec{\\boldsymbol{\\…rphi}}^\\top\\right)^{-1}")
  assert.equal(expansion.textContent.length, budget)
  assert.equal(expansion.textContent.startsWith("\\left(\\vec{\\boldsymbol{\\"), true)
  assert.equal(expansion.textContent.endsWith("\\top\\right)^{-1}"), true)
  assert.equal(option.title, `Take the inverse of an object: ${full}`)
  assert.equal(option.getAttribute("aria-label"), `\\varphi.b.vec.t.inv inserts ${full}, Inverse`)
})

test("labels short previews with the untruncated expansion", () => {
  const option = renderPaletteOption(INVERSE_SHORTCUT, transformQuery("inv", "x.bar.b.t"))
  const [, , expansion] = option.children

  assert.equal(expansion.textContent, "\\left(\\bar{\\mathbf{x}}^\\top\\right)^{-1}")
  assert.equal(expansion.textContent.length < mathPalette.MAX_PREVIEW_LENGTH, true)
  assert.equal(option.title, "Take the inverse of an object: \\left(\\bar{\\mathbf{x}}^\\top\\right)^{-1}")
  assert.equal(option.getAttribute("aria-label"), "x.bar.b.t.inv inserts \\left(\\bar{\\mathbf{x}}^\\top\\right)^{-1}, Inverse")
})

test("validates merged modifier classes and expands in canonical order", () => {
  assert.equal(math.expandMathShorthand("x.b.bb"), null)
  assert.equal(math.expandMathShorthand("x.b.t.bb"), null)
  assert.equal(math.expandMathShorthand("x.b.t.inv.hat"), "\\left(\\hat{\\mathbf{x}}^\\top\\right)^{-1}")
  assert.equal(math.expandMathShorthand("x.b.t.tilde.inv"), "\\left(\\tilde{\\mathbf{x}}^\\top\\right)^{-1}")
  assert.equal(math.expandMathShorthand("x.b.hat.t.inv.tilde"), "\\left(\\tilde{\\hat{\\mathbf{x}}}^\\top\\right)^{-1}")
})

test("parses expanded font, accent, and postfix wrappers idempotently", () => {
  const vectors = [
    "x.b",
    "x.b.t",
    "x.b.t.inv",
    "x.b.t.inv.hat",
    "@a.b.tilde.t",
    "\\mathbf{x}^\\top.tilde",
    "\\left(\\tilde{\\mathbf{x}}^\\top\\right)^{-1}",
    "\\mathcal{A}.t",
    "\\mathrm{x}.t"
  ]

  for (const source of vectors) {
    const expansion = math.expandMathShorthand(source)
    assert.ok(expansion, `${source} should parse`)
    assert.equal(math.parseMathShorthand(expansion)?.status, "valid", `${expansion} should parse as an expanded head`)
    assert.equal(math.expandMathShorthand(expansion), expansion, `${source} should reach a stable expansion`)
  }

  const parsed = math.parseMathShorthand("\\mathbf{x}^\\top.tilde")
  assert.equal(parsed.base, "x")
  assert.deepEqual(parsed.modifiers, ["bold", "transpose", "tilde"])
})

test("unknown LaTeX wrappers are not treated as chainable atoms", () => {
  assert.equal(math.parseMathShorthand("\\overline{x}.t"), null)
  assert.equal(math.expandMathShorthand("\\overline{x}.t"), null)
})

test("palette extracts and previews a full expanded math chain", () => {
  const text = "$\\left(\\mathbf{x}^\\top\\right)^{-1}.ti$"
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
    base: "\\left(\\mathbf{x}^\\top\\right)^{-1}",
    baseStart: 1
  })
  assert.equal(palette.previewExpansion({ prefix: ".", aliases: ["tilde"], expansion: "\\tilde{${1:x}}" }, query), "\\left(\\tilde{\\mathbf{x}}^\\top\\right)^{-1}")

  const greekText = "$@b$"
  const greekEditor = {
    ...editor,
    selectionStart: greekText.length - 1,
    selectionEnd: greekText.length - 1,
    view: {
      state: {
        doc: {
          length: greekText.length,
          lineAt: () => ({ from: 0, to: greekText.length, text: greekText }),
          sliceString: (from, to, separator = "\n") => greekText.slice(from, to).replaceAll("\n", separator)
        },
        tree: { resolveInner: () => ({ name: "Text", parent: { name: "Paragraph", from: 0, parent: null } }) }
      }
    }
  }
  palette.editorController = greekEditor
  assert.equal(palette.queryAtCaret().start, 1)
})

test("finds a complete active chain at a cursor inside its source", () => {
  assert.deepEqual(
    (({ start, end, source, expansion }) => ({ start, end, source, expansion }))(math.mathShorthandAt("$x.b.vec.t$", 4)),
    { start: 1, end: 10, source: "x.b.vec.t", expansion: "\\vec{\\mathbf{x}}^\\top" }
  )
  assert.equal(math.mathShorthandAt("`$x.b$`", 4), null)
  assert.equal(math.mathShorthandAt("```\n$x.b$\n```", 7), null)
  assert.deepEqual(
    (({ start, end, source, expansion }) => ({ start, end, source, expansion }))(math.mathShorthandAt("$\\mathbf{x}.t$", 13)),
    { start: 1, end: 13, source: "\\mathbf{x}.t", expansion: "\\mathbf{x}^\\top" }
  )
  const expandedPostfixChain = "$\\left(\\mathbf{x}^\\top\\right)^{-1}.tilde$"
  const expandedChain = math.mathShorthandAt(expandedPostfixChain, expandedPostfixChain.length - 1)
  assert.equal(expandedChain.source, "\\left(\\mathbf{x}^\\top\\right)^{-1}.tilde")
  assert.equal(expandedChain.expansion, "\\left(\\tilde{\\mathbf{x}}^\\top\\right)^{-1}")

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

  const expanded = "$\\hat{x}$"
  const expandedDoc = {
    length: expanded.length,
    lineAt: () => ({ from: 0, to: expanded.length, text: expanded }),
    sliceString: (from, to, separator = "\n") => expanded.slice(from, to).replaceAll("\n", separator)
  }
  const expandedEditor = {
    view: { state: { doc: expandedDoc, tree: { resolveInner: () => ({ name: "Text", parent: { name: "Paragraph", from: 0, parent: null } }) } } }
  }
  assert.equal(math.parseMathShorthand("\\hat{x}")?.status, "valid")
  assert.equal(math.mathShorthandAtEditor(expandedEditor, expanded.length - 1), null)
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

  assert.equal(editor.value, "$\\mathbf{x}^\\top$ and $\\vec{y}^{-1}$")
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

test("commits live chains at the curated token boundaries", () => {
  const cases = [
    ["$x.b$", 4, " ", "$\\mathbf{x} $"],
    ["$x.b$", 4, "Tab", "$\\mathbf{x}$"],
    ["$x.b$", 4, "Enter", "$\\mathbf{x}\n$"],
    ["$ax.b$", 5, " ", "$ax.b $"],
    ["$3.14$", 3, " ", "$3. 14$"],
    ["$v = 3.14$", 8, " ", "$v = 3.1 4$"],
    ["$x.b$", 4, "_", "$\\mathbf{x}_$"],
    ["$f(x).b$", 6, " ", "$f(x). b$"],
    ["$$\nx.b\n$$", 6, " ", "$$\n\\mathbf{x} \n$$"],
    ["$x.b$ and $y.t$", 4, " ", "$\\mathbf{x} $ and $y.t$"],
    ["\x60$x.b$\x60", 4, " ", "\x60$x. b$\x60"],
    ["\x60\x60\x60\n$x.b$\n\x60\x60\x60", 7, " ", "\x60\x60\x60\n$x. b$\n\x60\x60\x60"],
    ["$x.b", 4, "$", "$\\mathbf{x}$"],
    ["$$x.b$$", 2, "Enter", "$$\\mathbf{x}\n$$"],
    ["$$x.b$$", 0, "Enter", "\n$$x.b$$"],
    ["$x.b", 4, " ", "$\\mathbf{x} "],
    ["$$x.b$$ and $$y.t$$", 5, " ", "$$\\mathbf{x} $$ and $$y.t$$"],
    ["$x.b$ and $y.t$", 4, "!", "$\\mathbf{x}!$ and $y.t$"]
  ]

  for (const [source, caret, key, expected] of cases) {
    const context = createMathEditor(source, caret)
    pressMathKey(context, key, { code: key === " " ? "Space" : undefined })
    assert.equal(context.editor.value, expected, source + " + " + key)
  }

  const subscript = createMathEditor("$x.b$", 4)
  pressMathKey(subscript, "_")
  pressMathKey(subscript, "2")
  assert.equal(subscript.editor.value, "$\\mathbf{x}_2$")
})

test("commits on every decided chain-breaking key and keeps minus undecided", () => {
  for (const key of ["_", "^", "[", "(", "\\", "!", "+"]) {
    const context = createMathEditor("$x.b$", 4)
    pressMathKey(context, key)
    assert.equal(context.editor.value, "$\\mathbf{x}" + key + "$", key)
  }

  const minus = createMathEditor("$x.b$", 4)
  pressMathKey(minus, "-")
  pressMathKey(minus, "c")
  assert.equal(minus.editor.value, "$x.b-c$")
})

test("eagerly expands each known atomic @ shortcut when its dot is typed", () => {
  const shortcuts = [
    ["@a", "\\alpha"], ["@b", "\\beta"], ["@g", "\\gamma"], ["@m", "\\mu"],
    ["@n", "\\nu"], ["@q", "\\theta"], ["@r", "\\rho"], ["@D", "\\Delta"]
  ]
  for (const [shortcut, expansion] of shortcuts) {
    const context = createMathEditor("$" + shortcut + "$", shortcut.length + 1)
    pressMathKey(context, ".")
    assert.equal(context.editor.value, "$" + expansion + ".$", shortcut)
  }
})

test("keeps the modifier suggestion query available after invalid modifier attempts", () => {
  for (const [source, caret, expectedBase, expectedText] of [
    ["$x.zz$", 5, "x", "zz"],
    ["$x.b.bb$", 7, "x.b", "bb"]
  ]) {
    const context = createMathEditor(source, caret)
    const palette = new mathPalette.default()
    palette.editorController = context.editor
    assert.deepEqual(
      (({ prefix, base, text }) => ({ prefix, base, text }))(palette.queryAtCaret()),
      { prefix: ".", base: expectedBase, text: expectedText }
    )
  }
})

test("Escape cancels the pending chain and the focusout sweep leaves it literal", () => {
  const context = createMathEditor("$x.b$", 4)
  pressMathKey(context, "Escape")
  assert.equal(context.editor.value, "$x.b$")
  context.listeners.get("focusout")({})
  assert.equal(context.editor.value, "$x.b$")
})

test("commits every live math chain during the document-wide focusout sweep", () => {
  const cases = [
    ["$x.b$ and $y.t$", "$\\mathbf{x}$ and $y^\\top$"],
    ["$x.b!$", "$\\mathbf{x}!$"],
    ["$ax.b$", "$ax.b$"],
    ["$x.b$ and $3.14$", "$\\mathbf{x}$ and $3.14$"],
    ["\x60$x.b$\x60 and $y.t$", "\x60$x.b$\x60 and $y^\\top$"],
    ["$$\nx.b\n$$", "$$\n\\mathbf{x}\n$$"],
    ["\\begin{aligned}\nx.b\n\\end{aligned}", "\\begin{aligned}\n\\mathbf{x}\n\\end{aligned}"],
    ["$x.b$", "$\\mathbf{x}$"]
  ]
  for (const [source, expected] of cases) {
    const context = createMathEditor(source, 0)
    context.listeners.get("focusout")({})
    assert.equal(context.editor.value, expected, source)
  }
})

test("keeps commitAll responsive on a 100 KB math document", () => {
  const source = "$$" + "x + ".repeat(24995) + "x.b" + "$$"
  const editor = {
    value: source,
    replaceRanges(changes) {
      let cursor = 0
      const output = []
      for (const change of changes) {
        output.push(this.value.slice(cursor, change.from), change.insert)
        cursor = change.to
      }
      output.push(this.value.slice(cursor))
      this.value = output.join("")
    }
  }
  const controller = new math.default()
  controller.editorController = editor
  const startedAt = performance.now()
  controller.commitAll()
  const elapsed = performance.now() - startedAt

  assert.ok(elapsed < 2000, "100 KB commitAll took " + elapsed.toFixed(1) + " ms")
  assert.ok(editor.value.endsWith("\\mathbf{x}$$"))
})

test("keeps dollar-pairing behavior independent from shorthand commits", () => {
  const cases = [
    ["", 0, "$$", 1],
    ["$$", 1, "$$$$", 2],
    ["$$", 2, "$$$$", 3],
    ["$$$", 2, "$$$$$", 3],
    ["$$$$", 2, "$$$$", 3],
    ["$x$", 2, "$x$", 3]
  ]
  for (const [source, caret, expected, expectedCaret] of cases) {
    const context = createMathEditor(source, caret)
    pressMathKey(context, "$")
    assert.equal(context.editor.value, expected, source + " at " + caret)
    assert.equal(context.editor.selectionStart, expectedCaret, source + " caret")
  }
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
  assert.equal(editor.value, "$\\mathbf{x}^\\top$")

  for (const character of ".tilde") type(character)
  assert.equal(editor.value, "$\\mathbf{x}^\\top.tilde$")

  const expandedCommit = { key: "Tab", defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  listeners.get("keydown")(expandedCommit)
  assert.equal(expandedCommit.defaultPrevented, true)
  assert.equal(editor.value, "$\\tilde{\\mathbf{x}}^\\top$")
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
  assert.equal(editor.value, "$\\vec{x}^\\top$")
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

test("recognizes LaTeX math environments as math context", () => {
  const source = "\\begin{aligned}\nx.b\n\\end{aligned}"
  const caret = source.indexOf("x.b") + 3
  assert.equal(math.mathContextAt(source, caret), "display_math")
  assert.equal(math.mathShorthandAt(source, caret).expansion, "\\mathbf{x}")
  assert.equal(math.mathShorthandAt("x.b", 3), null)
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

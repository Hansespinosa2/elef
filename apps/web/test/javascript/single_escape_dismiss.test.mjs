import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

// Single-Escape dismissal: one Escape press closes any open fuzzy popup
// (`:`/`/` snippet, `@`/`.` math shortcut, `/diagram` mermaid, YAML
// front-matter metadata, `[[` document link) AND lands the editor in Vim
// Normal mode when Vim mode is on. Previously each popup's capture-phase
// keydown handler swallowed Escape, so Vim never saw it and authors had to
// press Escape twice.
const dist = (path) => new URL(`../../../../packages/editor-runtime/dist/${path}`, import.meta.url)

async function loadDist(path, replacements = {}) {
  let source = await readFile(dist(path), "utf8")
  for (const [from, to] of Object.entries(replacements)) source = source.replace(from, to)
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)
}

const STIMULUS_STUB = 'import { Controller } from "@hotwired/stimulus";'
const CONTROLLER_BASE = "class Controller {}"
const EDITOR_FOR = 'import { editorFor } from "../lib/editor_controller_lookup.js";'
const EDITOR_FOR_STUB = "const editorFor = () => null"
const VIM_ESCAPE_IMPORT = 'import { forwardEscapeToVim } from "../lib/vim_escape.js";'
// Merged controllers also position popups against the visual projection;
// inline the real helper so Escape dismissal runs its true close path.
const visualAssistSource = await readFile(dist("lib/visual_assist.js"), "utf8")
const VISUAL_ASSIST_6 = 'import { assistsInMode, mirrorPopupAccessibility, placePaletteBelow, placeVisualCaret, projectionHostFor, visualCaretRect } from "../lib/visual_assist.js";'
const VISUAL_ASSIST_LINK = 'import { mirrorPopupAccessibility, placePaletteBelow, placeVisualCaret, projectionHostFor, visualCaretRect } from "../lib/visual_assist.js";'
const VISUAL_ASSIST_SHORT = 'import { assistsInMode, projectionHostFor } from "../lib/visual_assist.js";'

function escapeEvent(overrides = {}) {
  return {
    key: "Escape",
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true },
    propagationStopped: false,
    ...overrides,
  }
}

function stubPaletteTarget() {
  return {
    hidden: false,
    children: [],
    style: {},
    id: "palette",
    replaceChildren(...nodes) { this.children = nodes },
    append() {},
    setAttribute() {},
    addEventListener() {},
    querySelector() { return null },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } },
  }
}

function popupElement(open) {
  return {
    querySelectorAll: (selector) => (selector === '[role="listbox"]' ? [{ hidden: !open }] : []),
  }
}

function vimEditor(overrides = {}) {
  return {
    editingMode: "source",
    insertMode: true,
    vimEnabled: true,
    vim: { __cm: true },
    selectionStart: 5,
    selectionEnd: 5,
    element: popupElement(false),
    ...overrides,
  }
}

// Real shared helper (Vim engine stubbed): proves the forward contract.
const vimEscape = await loadDist("lib/vim_escape.js", {
  'import { Vim } from "@replit/codemirror-vim";':
    "const Vim = { handleKey(...args) { globalThis.__vimHandleKeyCalls.push(args) } }\n",
})

test("forwardEscapeToVim sends one Escape to Vim in insert mode", () => {
  globalThis.__vimHandleKeyCalls = []
  const editor = vimEditor()
  const event = escapeEvent()

  assert.equal(vimEscape.forwardEscapeToVim(editor, event), true)
  assert.deepEqual(globalThis.__vimHandleKeyCalls, [[editor.vim, "<Esc>", "user"]])
  assert.equal(event.elefEscapeForwarded, true)
})

test("forwardEscapeToVim forwards at most once per keypress", () => {
  globalThis.__vimHandleKeyCalls = []
  const editor = vimEditor()
  const event = escapeEvent()

  assert.equal(vimEscape.forwardEscapeToVim(editor, event), true)
  assert.equal(vimEscape.forwardEscapeToVim(editor, event), false)
  assert.equal(globalThis.__vimHandleKeyCalls.length, 1)
})

test("forwardEscapeToVim stays quiet when Vim mode is off", () => {
  globalThis.__vimHandleKeyCalls = []
  const event = escapeEvent()

  assert.equal(vimEscape.forwardEscapeToVim(vimEditor({ vimEnabled: false, vim: null }), event), false)
  assert.equal(globalThis.__vimHandleKeyCalls.length, 0)
})

test("forwardEscapeToVim stays quiet when already in Normal mode", () => {
  globalThis.__vimHandleKeyCalls = []
  const event = escapeEvent()

  assert.equal(vimEscape.forwardEscapeToVim(vimEditor({ insertMode: false }), event), false)
  assert.equal(globalThis.__vimHandleKeyCalls.length, 0)
})

test("forwardEscapeToVim never throws without a Vim instance", () => {
  const event = escapeEvent()

  assert.equal(vimEscape.forwardEscapeToVim(vimEditor({ vim: null }), event), false)
  assert.equal(vimEscape.forwardEscapeToVim(null, escapeEvent()), false)
})

test("editorPopupOpen reports any visible listbox popup", () => {
  assert.equal(vimEscape.editorPopupOpen(vimEditor({ element: popupElement(true) })), true)
  assert.equal(vimEscape.editorPopupOpen(vimEditor({ element: popupElement(false) })), false)
  assert.equal(vimEscape.editorPopupOpen(vimEditor({ element: null })), false)
  assert.equal(vimEscape.editorPopupOpen(null), false)
})

const snippet = await loadDist("controllers/snippet_palette_controller.js", {
  [STIMULUS_STUB]: CONTROLLER_BASE,
  [EDITOR_FOR]: EDITOR_FOR_STUB,
  [VIM_ESCAPE_IMPORT]: "const forwardEscapeToVim = (...args) => { globalThis.__forwardEscapeCalls.push(args) }\n",
  [VISUAL_ASSIST_6]: visualAssistSource,
  'import { editorInsideCode, editorInsideMath } from "./math_shorthand_controller.js";':
    "const editorInsideCode = () => false\nconst editorInsideMath = () => false\n",
  'import { authoringRegistryFor } from "./authoring_registry.js";': "const authoringRegistryFor = () => []\n",
  'import { snippetStopsEffect } from "./snippet_stops.js";': "const snippetStopsEffect = { of: (value) => value }\n",
  'import { expandSnippet } from "@elef/work-model/document-transforms";': "const expandSnippet = () => null\n",
})

test(":/ snippet popup closes and forwards one Escape to Vim", () => {
  globalThis.__forwardEscapeCalls = []
  const editor = vimEditor()
  const controller = new snippet.default()
  controller.editorController = editor
  controller.paletteTarget = stubPaletteTarget()
  controller.matches = [{ id: "x", trigger: "fig", name: "Figure" }]
  controller.selectedIndex = 0
  controller.query = ""
  controller.queryStart = 5
  controller.queryPrefix = "/"
  controller.stops = []
  controller.directiveQueryAtCaret = () => null
  controller.queryAtCaret = () => ({ prefix: "/", text: "", start: 5 })
  const event = escapeEvent()

  controller.keydown(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(controller.paletteTarget.hidden, true)
  assert.equal(globalThis.__forwardEscapeCalls.length, 1)
  assert.deepEqual(globalThis.__forwardEscapeCalls[0], [editor, event])
})

test(":/ snippet popup ends snippet stops on the same Escape", () => {
  globalThis.__forwardEscapeCalls = []
  const editor = vimEditor()
  const controller = new snippet.default()
  controller.editorController = editor
  controller.paletteTarget = stubPaletteTarget()
  controller.matches = [{ id: "x", trigger: "fig", name: "Figure" }]
  controller.selectedIndex = 0
  controller.query = ""
  controller.queryStart = 5
  controller.queryPrefix = ":"
  controller.stops = [{ start: 1, end: 2 }]
  let ended = 0
  controller.endStops = () => { ended += 1 }
  controller.directiveQueryAtCaret = () => null
  controller.queryAtCaret = () => ({ prefix: ":", text: "", start: 5 })

  controller.keydown(escapeEvent())

  assert.equal(ended, 1)
  assert.equal(globalThis.__forwardEscapeCalls.length, 1)
})

const mathShortcut = await loadDist("controllers/math_shortcut_palette_controller.js", {
  [STIMULUS_STUB]: CONTROLLER_BASE,
  [EDITOR_FOR]: EDITOR_FOR_STUB,
  [VIM_ESCAPE_IMPORT]: "const forwardEscapeToVim = (...args) => { globalThis.__forwardEscapeCalls.push(args) }\n",
  [VISUAL_ASSIST_6]: visualAssistSource,
  'import { application } from "./application.js";':
    "const application = { getControllerForElementAndIdentifier: () => null }\n",
  'import { editorInsideMath, expandMathShorthand, innermostMathChainWindow, mathShorthandAtEditor, parseMathShorthand } from "./math_shorthand_controller.js";':
    "const editorInsideMath = () => true\nconst expandMathShorthand = () => null\nconst innermostMathChainWindow = () => null\nconst mathShorthandAtEditor = () => null\nconst parseMathShorthand = () => null\n",
  'import { authoringRegistryFor } from "./authoring_registry.js";': "const authoringRegistryFor = () => []\n",
  'import { snippetStopsEffect } from "./snippet_stops.js";': "const snippetStopsEffect = { of: (value) => value }\n",
})

test("@/. math shortcut popup closes and forwards one Escape to Vim", () => {
  globalThis.__forwardEscapeCalls = []
  const editor = vimEditor()
  const controller = new mathShortcut.default()
  controller.editorController = editor
  controller.paletteTarget = stubPaletteTarget()
  controller.matches = [{ id: "frac", namespace: "@", trigger: "frac", name: "Fraction" }]
  controller.selectedIndex = 0
  controller.query = { prefix: "@", text: "", start: 5 }
  controller.stops = []
  const event = escapeEvent()

  controller.keydown(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(controller.paletteTarget.hidden, true)
  assert.equal(globalThis.__forwardEscapeCalls.length, 1)
  assert.deepEqual(globalThis.__forwardEscapeCalls[0], [editor, event])
})

const documentLink = await loadDist("controllers/document_link_palette_controller.js", {
  [STIMULUS_STUB]: CONTROLLER_BASE,
  [EDITOR_FOR]: EDITOR_FOR_STUB,
  [VIM_ESCAPE_IMPORT]: "const forwardEscapeToVim = (...args) => { globalThis.__forwardEscapeCalls.push(args) }\n",
  [VISUAL_ASSIST_LINK]: visualAssistSource,
})

test("[[ document link popup closes and forwards one Escape to Vim", () => {
  globalThis.__forwardEscapeCalls = []
  const editor = vimEditor()
  const controller = new documentLink.default()
  controller.editorController = editor
  controller.editorTarget = {}
  controller.paletteTarget = stubPaletteTarget()
  controller.matches = ["Target doc"]
  controller.selectedIndex = 0
  const event = escapeEvent()

  controller.keydown(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(controller.paletteTarget.hidden, true)
  assert.equal(globalThis.__forwardEscapeCalls.length, 1)
  assert.deepEqual(globalThis.__forwardEscapeCalls[0], [editor, event])
})

const mermaid = await loadDist("controllers/mermaid_assist_controller.js", {
  [STIMULUS_STUB]: CONTROLLER_BASE,
  [EDITOR_FOR]: EDITOR_FOR_STUB,
  [VIM_ESCAPE_IMPORT]: "const forwardEscapeToVim = (...args) => { globalThis.__forwardEscapeCalls.push(args) }\n",
  [VISUAL_ASSIST_6]: visualAssistSource,
  'import { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } from "./mermaid_syntax.js";':
    "const diagramTemplate = () => null\nconst mermaidCompletion = () => null\nconst mermaidEnterEdit = () => null\nconst mermaidTabEdit = () => null\nconst MERMAID_DIAGRAMS = []\nconst slashDiagramQuery = () => null\n",
})

test("/diagram mermaid popup closes and forwards one Escape to Vim", () => {
  globalThis.__forwardEscapeCalls = []
  const editor = vimEditor({ selectionStart: 9, selectionEnd: 9, view: { destroyed: false } })
  const controller = new mermaid.default()
  controller.editorController = editor
  controller.hasPaletteTarget = true
  controller.element = { querySelectorAll: () => [] }
  controller.paletteTarget = stubPaletteTarget()
  controller.matches = [{ id: "flowchart", label: "Flowchart" }]
  controller.selectedIndex = 0
  controller.model = { kind: "diagram-types", from: 0, to: 9, query: "" }
  controller.modelStillMatches = () => true
  const event = escapeEvent()

  controller.keydown(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(controller.paletteTarget.hidden, true)
  assert.equal(globalThis.__forwardEscapeCalls.length, 1)
  assert.deepEqual(globalThis.__forwardEscapeCalls[0], [editor, event])
})

const metadata = await loadDist("controllers/metadata_assist_controller.js", {
  [STIMULUS_STUB]: CONTROLLER_BASE,
  [EDITOR_FOR]: EDITOR_FOR_STUB,
  [VIM_ESCAPE_IMPORT]: "const forwardEscapeToVim = (...args) => { globalThis.__forwardEscapeCalls.push(args) }\n",
  [VISUAL_ASSIST_6]: visualAssistSource,
  [`import {
  fieldScore,
  metadataCandidatesFor,
  metadataQueryAt,
  rankMetadataCandidates
} from "../lib/metadata_assist.js";`]:
    "const fieldScore = () => 0\nconst metadataCandidatesFor = () => []\nconst metadataQueryAt = () => ({ kind: \"key\", text: \"\", start: 5 })\nconst rankMetadataCandidates = (candidates) => candidates\n",
})

test("YAML front-matter popup closes and forwards one Escape to Vim", () => {
  globalThis.__forwardEscapeCalls = []
  const editor = vimEditor({ value: "---\ntitle: \n---\n", selectionStart: 5, selectionEnd: 5 })
  const controller = new metadata.default()
  controller.editorController = editor
  controller.paletteTarget = stubPaletteTarget()
  controller.matches = ["title"]
  controller.selectedIndex = 0
  controller.query = { kind: "key", text: "" }
  controller.queryStart = 5
  const event = escapeEvent()

  controller.keydown(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(controller.paletteTarget.hidden, true)
  assert.equal(globalThis.__forwardEscapeCalls.length, 1)
  assert.deepEqual(globalThis.__forwardEscapeCalls[0], [editor, event])
})

globalThis.__vimEscape = vimEscape
const shorthand = await loadDist("controllers/math_shorthand_controller.js", {
  [STIMULUS_STUB]: CONTROLLER_BASE,
  'import { syntaxTree } from "@codemirror/language";': "const syntaxTree = (state) => state.tree\n",
  [EDITOR_FOR]: EDITOR_FOR_STUB,
  'import { editorPopupOpen } from "../lib/vim_escape.js";': "const { editorPopupOpen } = globalThis.__vimEscape\n",
  [VISUAL_ASSIST_SHORT]: visualAssistSource,
})
delete globalThis.__vimEscape

function shorthandEditor(value, caret, { popup = false } = {}) {
  const editor = {
    value,
    selectionStart: caret,
    selectionEnd: caret,
    editingMode: "source",
    insertMode: true,
    vimEnabled: true,
    vim: { __cm: true },
    lineSeparator: "\n",
    element: popupElement(popup),
    normalizeLineEndings(value) { return value.replace(/\r\n?/g, "\n") },
    dom: { addEventListener() {}, removeEventListener() {} },
    form: null,
    replaceRange(insert, from, to = from) {
      this.value = this.value.slice(0, from) + insert + this.value.slice(to)
      this.selectionStart = this.selectionEnd = from + insert.length
    },
    setSelectionRange(from, to = from) { this.selectionStart = from; this.selectionEnd = to },
  }
  const doc = {
    get length() { return editor.value.length },
    lineAt(position) {
      const from = editor.value.lastIndexOf("\n", Math.max(0, position - 1)) + 1
      const nextLine = editor.value.indexOf("\n", position)
      const to = nextLine === -1 ? editor.value.length : nextLine
      return { from, to, text: editor.value.slice(from, to) }
    },
    sliceString(from, to, separator = "\n") { return editor.value.slice(from, to).replaceAll("\n", separator) },
  }
  editor.view = {
    state: { doc, tree: { resolveInner: () => ({ name: "Text", from: 0, parent: { name: "Paragraph", from: 0, parent: null } }) } },
  }
  return editor
}

test("Escape with a pending math chain and no popup cancels without entering Normal mode", () => {
  const editor = shorthandEditor("$x.vec.t$", 8)
  const controller = new shorthand.default()
  controller.editorController = editor
  const event = escapeEvent()

  controller.keydown(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(controller.cancelledChains.length, 1)
})

test("Escape with a pending math chain and an open popup cancels and lets one Escape reach Normal mode", () => {
  const editor = shorthandEditor("$x.vec.t$", 8, { popup: true })
  const controller = new shorthand.default()
  controller.editorController = editor
  const event = escapeEvent()

  controller.keydown(event)

  assert.equal(event.defaultPrevented, false)
  assert.equal(controller.cancelledChains.length, 1)
})

test("Escape already forwarded by a popup still drops the pending math chain", () => {
  const editor = shorthandEditor("$x.vec.t$", 8)
  const controller = new shorthand.default()
  controller.editorController = editor
  const event = escapeEvent({ elefEscapeForwarded: true })

  controller.keydown(event)

  assert.equal(event.defaultPrevented, false)
  assert.equal(controller.cancelledChains.length, 1)
})

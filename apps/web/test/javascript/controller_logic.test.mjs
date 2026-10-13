import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

// Ported from dev's controller_logic suite: web-host controllers load from
// the host tree, shared controllers from the editor-runtime dist bundle.
// The retired presentation-canvas scale case lives with attachCanvasScaling
// (packages/client/test/presentation.test.ts); both map-shift cases moved to
// the unified DocumentEditor (shared/document_editor.test.js).
const hostControllerPath = new URL("../../app/javascript/controllers/", import.meta.url)
const sharedControllerPath = new URL("../../../../packages/editor-runtime/dist/controllers/", import.meta.url)

async function loadController(name, { base = hostControllerPath, overrides = {} } = {}) {
  let source = await readFile(new URL(`${name}_controller.js`, base), "utf8")
  source = source.replace(/^import\s+[\s\S]*?\s+from\s+["']([^"']+)["'];?\s*/gm, (_statement, specifier) => {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier]
    return specifier === "@hotwired/stimulus" ? "class Controller {}\n" : ""
  })
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  return (await import(url)).default
}

function replaceGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous)
    else delete globalThis[name]
  }
}

const CommandPaletteController = await loadController("command_palette")
const SnippetPaletteController = await loadController("snippet_palette", {
  base: sharedControllerPath,
  overrides: {
    "../lib/editor_controller_lookup.js": "const editorFor = element => element.currentEditor\n"
  }
})
const MathShortcutPaletteController = await loadController("math_shortcut_palette", {
  base: sharedControllerPath,
  overrides: {
    "../lib/editor_controller_lookup.js": "const editorFor = element => element.currentEditor\n"
  }
})
const DocumentPagesController = await loadController("document_pages", { base: sharedControllerPath })
const LineageGraphController = await loadController("lineage_graph")
const MermaidDiagramsController = await loadController("mermaid_diagrams", {
  base: sharedControllerPath,
  overrides: {
    "./mermaid_runtime.js": "const renderMermaidDiagrams = element => globalThis.__renderMermaidDiagrams(element)\n"
  }
})

test("command search sends its selected type and displays the returned results", async () => {
  const requests = []
  const restoreWindow = replaceGlobal("window", { location: { origin: "https://elef.test" } })
  const restoreFetch = replaceGlobal("fetch", async url => {
    requests.push(new URL(url))
    return { ok: true, json: async () => ({ results: [{ title: "One result" }] }) }
  })
  const controller = new CommandPaletteController()
  let renders = 0
  let status = ""
  Object.assign(controller, {
    mode: "search",
    dialogTarget: { open: true },
    searchUrlValue: "/search",
    searchType: "documents",
    searchSequence: 4,
    resultsData: [],
    renderResults() { renders += 1 },
    setStatus(value) { status = value }
  })

  try {
    await controller.search("notes", 4)
  } finally {
    restoreFetch()
    restoreWindow()
  }

  assert.equal(requests.length, 1)
  assert.equal(requests[0].searchParams.get("q"), "notes")
  assert.equal(requests[0].searchParams.get("type"), "documents")
  assert.deepEqual(controller.resultsData, [{ title: "One result" }])
  assert.equal(renders, 1)
  assert.equal(status, "1 result")
})

test("command search discards a response from an older query sequence", async () => {
  const restoreWindow = replaceGlobal("window", { location: { origin: "https://elef.test" } })
  const restoreFetch = replaceGlobal("fetch", async () => ({ ok: true, json: async () => ({ results: [{ title: "Stale" }] }) }))
  const controller = new CommandPaletteController()
  let renders = 0
  Object.assign(controller, {
    mode: "search",
    dialogTarget: { open: true },
    searchUrlValue: "/search",
    searchType: "all",
    searchSequence: 8,
    resultsData: [{ title: "Current" }],
    renderResults() { renders += 1 },
    setStatus() {}
  })

  try {
    await controller.search("old query", 7)
  } finally {
    restoreFetch()
    restoreWindow()
  }

  assert.deepEqual(controller.resultsData, [{ title: "Current" }])
  assert.equal(renders, 0)
})

test("snippet scoring prefers an exact alias to a partial name match", () => {
  const controller = new SnippetPaletteController()
  controller.query = "pic"

  const score = controller.score({
    trigger: "figure",
    aliases: ["pic"],
    name: "Picture block",
    description: "Insert a picture",
    category: "Media"
  })

  assert.equal(score, 9500)
})

for (const [name, PaletteController] of [
  ["snippet", SnippetPaletteController],
  ["math shortcut", MathShortcutPaletteController]
]) {
  test(`${name} palette rebinds editor events when the editor instance changes`, () => {
    const editor = () => {
      const listeners = new Map()
      const listen = (target) => ({
        addEventListener(type, listener, capture) {
          listeners.set(`${target}:${type}:${Boolean(capture)}`, listener)
        },
        removeEventListener(type, listener, capture) {
          const key = `${target}:${type}:${Boolean(capture)}`
          if (listeners.get(key) === listener) listeners.delete(key)
        }
      })
      return {
        listeners,
        dom: listen("dom"),
        scrollElement: listen("scroll")
      }
    }
    const previousEditor = editor()
    const nextEditor = editor()
    const controller = new PaletteController()
    let stopsCleared = 0
    let paletteClosed = 0
    Object.assign(controller, {
      element: { currentEditor: previousEditor },
      editorController: previousEditor,
      positionPalette() {},
      setupAccessibility() {},
      endStops() { stopsCleared += 1 },
      close() { paletteClosed += 1 },
      schedule() {}
    })

    controller.setupEditor()
    controller.element.currentEditor = nextEditor
    controller.setupEditor()

    assert.equal(previousEditor.listeners.size, 0)
    assert.ok(nextEditor.listeners.has("scroll:scroll:false"))
    assert.ok([...nextEditor.listeners.keys()].some(key => key.startsWith("dom:keydown:")))
    assert.equal(controller.editorController, nextEditor)
    assert.equal(stopsCleared, 1)
    assert.equal(paletteClosed, 1)
  })
}

test("document page units keep a heading with its following block and source anchors", () => {
  const block = (tagName, sourceAnchor = false) => ({
    tagName,
    matches(selector) { return selector === ".document-source-anchor" && sourceAnchor },
    querySelector() { return null }
  })
  const controller = new DocumentPagesController()
  const anchorBefore = block("SPAN", true)
  const heading = block("H2")
  const followingParagraph = block("P")
  const anchorAfter = block("SPAN", true)
  const nextParagraph = block("P")

  assert.deepEqual(controller.pageUnits([anchorBefore, heading, followingParagraph, anchorAfter, nextParagraph]), [
    [anchorBefore, heading, followingParagraph],
    [anchorAfter, nextParagraph]
  ])
})

test("lineage layout places a continuation in the next column of its parent's lane", () => {
  const restoreOption = replaceGlobal("Option", class Option { constructor(text, value) { this.text = text; this.value = value } })
  const restoreDocument = replaceGlobal("document", {
    createElement(tagName) { return { tagName, style: {}, className: "", textContent: "" } }
  })
  const rootElement = { style: {} }
  const childElement = { style: {} }
  const root = { element: rootElement, id: "1", parentId: null, title: "Root", date: "2026-01-02", timestamp: 1, type: "continuation" }
  const child = { element: childElement, id: "2", parentId: "1", title: "Child", date: "2026-01-02", timestamp: 2, type: "continuation" }
  const controller = new LineageGraphController()
  Object.assign(controller, {
    nodes: [root, child],
    positions: new Map([[root.id, root], [child.id, child]]),
    axisTarget: { replaceChildren() {}, append() {} },
    dateTarget: { replaceChildren() {}, add() {} },
    contentTarget: { style: {} }
  })

  try {
    controller.layout()
  } finally {
    restoreDocument()
    restoreOption()
  }

  assert.equal(root.lane, child.lane)
  assert.equal(root.column, 0)
  assert.equal(child.column, 1)
  assert.equal(rootElement.style.left, "40px")
  assert.equal(childElement.style.left, "332px")
  assert.equal(controller.width, 624)
})

test("command palette saves the previously focused element on open and restores it on close", () => {
  const previouslyFocused = { isConnected: true, focused: 0, focus() { this.focused += 1 } }
  const restoreDocument = replaceGlobal("document", { activeElement: previouslyFocused })
  const controller = new CommandPaletteController()
  Object.assign(controller, {
    previouslyFocusedElement: null,
    dialogTarget: {
      open: false,
      hasAttribute: () => false,
      showModal() { this.open = true },
      close() { this.open = false },
      removeAttribute() {}
    },
    inputTarget: { value: "", focus() {}, setAttribute() {}, removeAttribute() {} },
    cancelSearch() {},
    setModeChrome() {},
    updateFilterSelection() {},
    renderCurrentMode() {},
    setStatus() {}
  })

  try {
    controller.openMode("commands")
    assert.equal(controller.previouslyFocusedElement, previouslyFocused)
    controller.close()
    assert.equal(previouslyFocused.focused, 1)
    assert.equal(controller.previouslyFocusedElement, null)
  } finally {
    restoreDocument()
  }
})

test("command palette does not overwrite the saved element when switching modes while open", () => {
  const first = { isConnected: true, focus() {} }
  const inDialog = { isConnected: true, focus() {} }
  const fakeDocument = { activeElement: first }
  const restoreDocument = replaceGlobal("document", fakeDocument)
  const controller = new CommandPaletteController()
  Object.assign(controller, {
    previouslyFocusedElement: null,
    dialogTarget: {
      open: false,
      hasAttribute() { return this.open },
      showModal() { this.open = true }
    },
    inputTarget: { value: "", focus() {} },
    cancelSearch() {},
    setModeChrome() {},
    updateFilterSelection() {},
    renderCurrentMode() {},
    setStatus() {}
  })

  try {
    controller.openMode("commands")
    fakeDocument.activeElement = inDialog
    controller.openMode("search")
    assert.equal(controller.previouslyFocusedElement, first)
  } finally {
    restoreDocument()
  }
})

test("command palette skips restore when the saved element left the DOM", () => {
  const controller = new CommandPaletteController()
  let focusCalls = 0
  Object.assign(controller, {
    previouslyFocusedElement: { isConnected: false, focus() { focusCalls += 1 } },
    dialogTarget: { open: false, removeAttribute() {} },
    inputTarget: { setAttribute() {} },
    cancelSearch() {}
  })

  controller.close()

  assert.equal(focusCalls, 0)
  assert.equal(controller.previouslyFocusedElement, null)
})

test("command palette restores focus once across close and native dialog dismiss", () => {
  const previouslyFocused = { isConnected: true, focused: 0, focus() { this.focused += 1 } }
  const controller = new CommandPaletteController()
  Object.assign(controller, {
    previouslyFocusedElement: previouslyFocused,
    dialogTarget: { open: true, close() { this.open = false } },
    inputTarget: { setAttribute() {} },
    cancelSearch() {}
  })

  controller.close()
  controller.dialogClosed()

  assert.equal(previouslyFocused.focused, 1)
  assert.equal(controller.previouslyFocusedElement, null)
})

test("Mermaid mutation render requests coalesce into one animation frame", () => {
  const callbacks = new Map()
  const renders = []
  let nextId = 0
  const restoreFrame = replaceGlobal("requestAnimationFrame", callback => {
    const id = ++nextId
    callbacks.set(id, callback)
    return id
  })
  const restoreCancel = replaceGlobal("cancelAnimationFrame", id => callbacks.delete(id))
  const restoreRender = replaceGlobal("__renderMermaidDiagrams", element => {
    renders.push(element)
    return Promise.resolve()
  })
  const element = { id: "rendered-work" }
  const controller = new MermaidDiagramsController()
  controller.element = element

  try {
    controller.scheduleRender()
    controller.scheduleRender()
    assert.equal(callbacks.size, 1)
    const [id, callback] = callbacks.entries().next().value
    callbacks.delete(id)
    callback()
  } finally {
    restoreRender()
    restoreCancel()
    restoreFrame()
  }

  assert.deepEqual(renders, [element])
  assert.equal(controller.renderFrame, null)
})


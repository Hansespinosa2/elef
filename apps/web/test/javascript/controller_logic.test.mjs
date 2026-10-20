import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseHTML } from "linkedom"

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
const visualAssistSource = await readFile(new URL("../../../../packages/editor-runtime/dist/lib/visual_assist.js", import.meta.url), "utf8")
const SnippetPaletteController = await loadController("snippet_palette", {
  base: sharedControllerPath,
  overrides: {
    "../lib/editor_controller_lookup.js": "const editorFor = element => element.currentEditor\n",
    "../lib/visual_assist.js": visualAssistSource,
    "./math_shorthand_controller.js": "const editorInsideMath = () => false\nconst editorInsideCode = () => false\n",
    "./authoring_registry.js": "const authoringRegistryFor = () => []\n",
    "./snippet_stops.js": "const snippetStopsEffect = { of: (stops) => stops }\n",
    "@elef/work-model/document-transforms": "const expandSnippet = (body) => ({ text: body, stops: [] })\n"
  }
})
const MathShortcutPaletteController = await loadController("math_shortcut_palette", {
  base: sharedControllerPath,
  overrides: {
    "../lib/editor_controller_lookup.js": "const editorFor = element => element.currentEditor\n",
    "../lib/visual_assist.js": visualAssistSource,
    "./application.js": "const application = { getControllerForElementAndIdentifier: () => null }\n",
    "./math_shorthand_controller.js": [
      "const editorInsideMath = () => true",
      "const editorInsideCode = () => false",
      "const expandMathShorthand = (source) => source",
      "const innermostMathChainWindow = () => null",
      "const mathShorthandAtEditor = () => null",
      "const parseMathShorthand = () => ({ status: 'valid' })",
      ""
    ].join("\n"),
    "./authoring_registry.js": "const authoringRegistryFor = () => []\n",
    "./snippet_stops.js": "const snippetStopsEffect = { of: (stops) => stops }\n"
  }
})
const DocumentPagesController = await loadController("document_pages", {
  base: sharedControllerPath,
  overrides: { "../lib/stage_marks.js": "const markStage = () => {}\n" }
})
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

function paginationHarness(fonts = { status: "loaded", ready: Promise.resolve() }) {
  const images = []
  const surface = {
    dataset: {},
    querySelectorAll() { return images },
    contains(image) { return images.includes(image) },
    addEventListener() {}, removeEventListener() {}
  }
  const restoreDocument = replaceGlobal("document", { fonts })
  const restoreWindow = replaceGlobal("window", { addEventListener() {}, removeEventListener() {} })
  const restoreFrame = replaceGlobal("cancelAnimationFrame", () => {})
  const controller = new DocumentPagesController()
  let passes = 0
  Object.assign(controller, {
    element: { closest() { return null } }, surfaceTarget: surface,
    paginate() {
      if (!this.paginatedOnce) this.firstPassWithoutFonts = fonts.status === "loading"
      passes++; this.paginatedOnce = true
    },
    focusedEditable() { return true }
  })
  function image() {
    const handlers = new Map()
    const element = {
      complete: false,
      addEventListener(type, listener) { handlers.set(type, listener) },
      removeEventListener(type, listener) { if (handlers.get(type) === listener) handlers.delete(type) },
      settle(type = "load") { this.complete = true; handlers.get(type)?.() },
      handlers
    }
    images.push(element)
    return element
  }
  return {
    controller, images, image, get passes() { return passes },
    dispose() { controller.disconnect(); restoreFrame(); restoreWindow(); restoreDocument() }
  }
}

test("document pagination waits for both fonts and images, including failed images", async () => {
  let resolveFonts
  const fonts = { status: "loading", ready: new Promise(resolve => { resolveFonts = resolve }) }
  const harness = paginationHarness(fonts)
  try {
    const first = harness.image()
    const broken = harness.image()
    harness.controller.connect()
    assert.equal(harness.passes, 0)
    first.settle()
    assert.equal(harness.passes, 0)
    fonts.status = "loaded"
    resolveFonts()
    await Promise.resolve()
    assert.equal(harness.passes, 0)
    broken.settle("error")
    assert.equal(harness.passes, 1)
    assert.equal(harness.controller.resourceTimer, null)
    assert.equal(first.handlers.size, 0)
    assert.equal(broken.handlers.size, 0)
    assert.equal(harness.controller.watchedImages.size, 0)
  } finally { harness.dispose() }
})

test("queued image load events do not repeat a pass that measured all completed images", () => {
  const harness = paginationHarness()
  try {
    const first = harness.image()
    const second = harness.image()
    harness.controller.connect()
    // Shared image fetches complete together, before each element's load
    // event is dispatched. The first event can therefore unlock a pass
    // that already measures the second image at its final dimensions.
    first.complete = true
    second.complete = true
    first.settle()
    assert.equal(harness.passes, 1)
    let schedules = 0
    harness.controller.schedulePagination = () => { schedules++ }
    second.settle()
    assert.equal(schedules, 0)
    assert.equal(harness.controller.watchedImages.size, 0)
  } finally { harness.dispose() }
})

test("font-ready microtask does not repeat an image-triggered first pass", async () => {
  let resolveFonts
  const fonts = { status: "loading", ready: new Promise(resolve => { resolveFonts = resolve }) }
  const harness = paginationHarness(fonts)
  try {
    const image = harness.image()
    harness.controller.connect()
    let schedules = 0
    harness.controller.schedulePagination = () => { schedules++ }
    fonts.status = "loaded"
    resolveFonts()
    image.settle()
    await Promise.resolve()
    assert.equal(harness.passes, 1)
    assert.equal(schedules, 0)
  } finally { harness.dispose() }
})

test("resource timeout permits first paint and late fonts request a new pass", async () => {
  let timeout
  const restoreTimeout = replaceGlobal("setTimeout", callback => { timeout = callback; return 1 })
  const restoreClear = replaceGlobal("clearTimeout", () => {})
  let resolveFonts
  const fonts = { status: "loading", ready: new Promise(resolve => { resolveFonts = resolve }) }
  const harness = paginationHarness(fonts)
  try {
    harness.controller.connect()
    assert.equal(harness.passes, 0)
    timeout()
    assert.equal(harness.passes, 1)
    assert.equal(harness.controller.resourceTimer, null)
    let schedules = 0
    harness.controller.schedulePagination = () => { schedules++ }
    fonts.status = "loaded"
    resolveFonts()
    await Promise.resolve()
    assert.equal(schedules, 1)
  } finally { harness.dispose(); restoreTimeout(); restoreClear() }
})

test("document pagination watches images installed after first pass even while editing", () => {
  const harness = paginationHarness()
  try {
    harness.controller.connect()
    assert.equal(harness.passes, 1)
    const image = harness.image()
    harness.controller.schedulePagination()
    assert.equal(image.handlers.size, 2)
    let schedules = 0
    harness.controller.schedulePagination = () => { schedules++ }
    image.settle()
    assert.equal(schedules, 1)
    assert.equal(image.handlers.size, 0)
  } finally { harness.dispose() }
})

test("document image watchers are removed on replacement and disconnect", () => {
  const harness = paginationHarness()
  try {
    const replaced = harness.image()
    harness.controller.connect()
    harness.images.length = 0
    const current = harness.image()
    harness.controller.schedulePagination()
    assert.equal(replaced.handlers.size, 0)
    assert.equal(current.handlers.size, 2)
    harness.controller.disconnect()
    assert.equal(current.handlers.size, 0)
    assert.equal(harness.controller.watchedImages.size, 0)
  } finally { harness.dispose() }
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

// --- Visual-mode snippet palette ---

const VISUAL_SNIPPETS = [
  { namespace: "/", trigger: "table", name: "Table", category: "Structure", body: "**T**", behavior: { type: "insert" }, contexts: ["source"] }
]

function stubAssistEngine({ mode = "visual", value = "Body /ta", caret = 8 } = {}) {
  const calls = { replaceRange: [], replaceRangeWithSelection: [], focus: 0, setSelectionRange: [], dispatched: [] }
  const doc = {
    get length() { return engine.value.length },
    lineAt(offset) {
      let from = 0
      for (const line of engine.value.split("\n")) {
        if (offset <= from + line.length) return { text: line, from }
        from += line.length + 1
      }
      return { text: "", from: engine.value.length }
    }
  }
  const engine = {
    editingMode: mode,
    selectionStart: caret,
    selectionEnd: caret,
    value,
    destroyed: false,
    insertMode: true,
    dom: {
      getAttribute: () => "",
      setAttribute: () => {},
      removeAttribute: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      contains: () => true,
      getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 })
    },
    view: {
      state: { doc },
      dispatch: (transaction) => calls.dispatched.push(transaction),
      coordsAtPos: () => null,
      scrollDOM: { addEventListener: () => {}, removeEventListener: () => {} },
      dom: { addEventListener: () => {}, removeEventListener: () => {} }
    },
    scrollElement: { addEventListener: () => {}, removeEventListener: () => {} },
    replaceRange(insert, from, to = from) {
      calls.replaceRange.push([insert, from, to])
      engine.value = engine.value.slice(0, from) + insert + engine.value.slice(to)
      engine.selectionStart = engine.selectionEnd = from + insert.length
    },
    replaceRangeWithSelection(insert, from, to, selection) {
      calls.replaceRangeWithSelection.push([insert, from, to, selection])
      engine.value = engine.value.slice(0, from) + insert + engine.value.slice(to)
      engine.selectionStart = from + selection.from
      engine.selectionEnd = from + selection.to
    },
    focus() { calls.focus += 1 },
    setSelectionRange(anchor, head = anchor) {
      calls.setSelectionRange.push([anchor, head])
      engine.selectionStart = anchor
      engine.selectionEnd = head
    }
  }
  return { engine, calls }
}

function mountAssistPalette({ controllerClass = SnippetPaletteController, mode = "visual", value = "Body /ta", caret = 8, registry = VISUAL_SNIPPETS, host = null, assign = {} } = {}) {
  const { document } = parseHTML(`<form><div class="field"><div id="palette" role="listbox" hidden></div><div class="editor-projection"><div class="block" contenteditable="true"></div></div></div></form>`)
  const form = document.querySelector("form")
  const field = document.querySelector(".field")
  const palette = document.querySelector("#palette")
  if (host) form.visualEditorController = host
  const { engine, calls } = stubAssistEngine({ mode, value, caret })
  const controller = new controllerClass()
  Object.assign(controller, {
    element: field,
    paletteTarget: palette,
    editorController: engine,
    registry,
    matches: [],
    selectedIndex: 0,
    stops: [],
    query: "",
    queryPrefix: "",
    queryStart: 0,
    argumentQuery: null,
    activeStop: null,
    ...assign
  })
  return { controller, engine, calls, palette, field, form, document }
}

function stubAssistGlobals(t, { selectionRect = null } = {}) {
  const saved = new Map()
  const setGlobal = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  const rect = selectionRect || { x: 100, y: 200, width: 0, height: 18, left: 100, top: 200, bottom: 218, right: 100 }
  setGlobal("window", {
    innerWidth: 1400,
    innerHeight: 1000,
    getSelection: () => ({ rangeCount: 1, getRangeAt: () => ({ getBoundingClientRect: () => rect }) }),
    addEventListener: () => {},
    removeEventListener: () => {}
  })
  return { setDocument: (doc) => setGlobal("document", doc) }
}

function stubHostDouble() {
  const calls = { inserts: [], carets: [] }
  return {
    calls,
    host: {
      applyVisualAssistInsert: (edit) => { calls.inserts.push(edit); return true },
      restoreCaret: (offset, blockId) => { calls.carets.push([offset, blockId]); return true }
    }
  }
}

test("visual refresh opens the snippet palette on a slash query", (t) => {
  const mounted = mountAssistPalette({})
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)

  mounted.controller.refresh()

  assert.equal(mounted.palette.hidden, false)
  assert.equal(mounted.controller.matches.length, 1)
  assert.equal(mounted.controller.queryStart, 5)
  assert.equal(mounted.palette.style.left, "100px")
  assert.equal(mounted.palette.style.top, "222px")
})

test("visual refresh closes when the caret leaves the trigger", (t) => {
  const mounted = mountAssistPalette({ value: "Body plain", caret: 10 })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)

  mounted.controller.refresh()

  assert.equal(mounted.palette.hidden, true)
  assert.deepEqual(mounted.controller.matches, [])
})

test("visual position keeps its place on a degenerate caret rect", (t) => {
  const mounted = mountAssistPalette({})
  const globals = stubAssistGlobals(t, { selectionRect: { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, bottom: 0, right: 0 } })
  globals.setDocument(mounted.document)
  mounted.palette.hidden = false
  mounted.palette.style.left = "5px"

  mounted.controller.positionPalette()

  assert.equal(mounted.palette.style.left, "5px")
})

test("visual insert commits through the projection pipeline without focusing the engine", async (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({ host })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(mounted.calls.replaceRange, [["**T**", 5, 8]])
  assert.deepEqual(hostCalls.inserts, [{ from: 5, to: 8, insert: "**T**", caret: 10 }])
  assert.equal(mounted.calls.focus, 0)
  assert.deepEqual(hostCalls.carets, [[10, null]])
  assert.equal(mounted.palette.hidden, true)
})

test("source insert still focuses the engine instead of the projection", async (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({ mode: "source", host })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(mounted.calls.replaceRange, [["**T**", 5, 8]])
  assert.equal(mounted.calls.focus, 1)
  assert.deepEqual(hostCalls.inserts, [])
  assert.deepEqual(hostCalls.carets, [])
})

test("visual keydown accepts the match on Enter", (t) => {
  const { host } = stubHostDouble()
  const mounted = mountAssistPalette({ host })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  let prevented = false

  mounted.controller.keydown({ key: "Enter", defaultPrevented: false, preventDefault: () => { prevented = true } })

  assert.equal(prevented, true)
  assert.deepEqual(mounted.calls.replaceRange, [["**T**", 5, 8]])
})

test("visual keydown leaves plain keys alone with no palette or stops", (t) => {
  const mounted = mountAssistPalette({})
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  let prevented = false

  mounted.controller.keydown({ key: "a", defaultPrevented: false, preventDefault: () => { prevented = true } })

  assert.equal(prevented, false)
  assert.equal(mounted.palette.hidden, true)
})

function assertVisualRouting(t, ControllerClass, { setupEditor = null } = {}) {
  const added = []
  const removed = []
  const saved = new Map()
  const setGlobal = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  setGlobal("document", {
    activeElement: null,
    addEventListener: (type, listener, capture) => added.push([type, listener, capture]),
    removeEventListener: (type, listener, capture) => removed.push([type, listener, capture])
  })
  setGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} })

  const { engine } = stubAssistEngine({})
  const formDouble = { addEventListener: () => {}, removeEventListener: () => {} }
  const elementDouble = {
    currentEditor: engine,
    closest: () => formDouble,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  const controller = new ControllerClass()
  const paletteDouble = { hidden: true, setAttribute: () => {}, id: "palette" }
  Object.assign(controller, { element: elementDouble, paletteTarget: paletteDouble })
  if (setupEditor) setupEditor(controller, engine)
  controller.connect()

  const keydownBinding = added.find(([type, listener, capture]) => type === "keydown" && capture === true)
  assert.ok(keydownBinding, "document capture keydown is bound")
  const scrollBinding = added.find(([type]) => type === "scroll")
  assert.equal(scrollBinding, undefined, "window scroll binds on window, not document")
  let routed = 0
  controller.keydown = () => { routed += 1 }
  keydownBinding[1]({ key: "a" })
  assert.equal(routed, 0, "idle visual keys never reach the palette")
  paletteDouble.hidden = false
  keydownBinding[1]({ key: "Enter" })
  assert.equal(routed, 1, "open-palette keys route to the palette")

  controller.disconnect()
  assert.ok(removed.some(([type, listener, capture]) => type === "keydown" && listener === keydownBinding[1] && capture === true))
}

test("visual key routing binds on document capture and ignores idle keys", (t) => {
  assertVisualRouting(t, SnippetPaletteController)
})

// --- Visual-mode document link palette ---

const DocumentLinkPaletteController = await loadController("document_link_palette", {
  base: sharedControllerPath,
  overrides: {
    "../lib/editor_controller_lookup.js": "const editorFor = element => element.currentEditor\n",
    "../lib/visual_assist.js": visualAssistSource
  }
})

test("visual link refresh opens the palette on a bracket query", (t) => {
  const mounted = mountAssistPalette({
    controllerClass: DocumentLinkPaletteController,
    value: "See [[al",
    caret: 8,
    registry: [],
    assign: { titlesValue: ["Alpha", "Beta"] }
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)

  mounted.controller.refresh()

  assert.equal(mounted.palette.hidden, false)
  assert.deepEqual(mounted.controller.matches, ["Alpha"])
  assert.equal(mounted.controller.queryStart, 4)
  assert.equal(mounted.palette.style.left, "100px")
  assert.equal(mounted.palette.style.top, "222px")
})

test("visual link insert pipelines through the projection host", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: DocumentLinkPaletteController,
    value: "See [[al",
    caret: 8,
    registry: [],
    host,
    assign: { titlesValue: ["Alpha", "Beta"] }
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["[[Alpha]]", 4, 8]])
  assert.deepEqual(hostCalls.inserts, [{ from: 4, to: 8, insert: "[[Alpha]]", caret: 13 }])
  assert.equal(mounted.calls.focus, 0)
  assert.deepEqual(hostCalls.carets, [[13, null]])
  assert.equal(mounted.palette.hidden, true)
})

test("visual link insert swallows a typed closing bracket pair", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: DocumentLinkPaletteController,
    value: "See [[al]]",
    caret: 8,
    registry: [],
    host,
    assign: { titlesValue: ["Alpha"] }
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()

  mounted.controller.insertSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["[[Alpha]]", 4, 10]])
  assert.deepEqual(hostCalls.inserts, [{ from: 4, to: 10, insert: "[[Alpha]]", caret: 13 }])
})

test("source link insert still focuses the engine", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: DocumentLinkPaletteController,
    mode: "source",
    value: "See [[al",
    caret: 8,
    registry: [],
    host,
    assign: { titlesValue: ["Alpha"] }
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["[[Alpha]]", 4, 8]])
  assert.equal(mounted.calls.focus, 1)
  assert.deepEqual(mounted.calls.setSelectionRange, [[13, 13]])
  assert.deepEqual(hostCalls.inserts, [])
})

test("visual link keydown accepts the match on Enter", (t) => {
  const { host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: DocumentLinkPaletteController,
    value: "See [[al",
    caret: 8,
    registry: [],
    host,
    assign: { titlesValue: ["Alpha", "Beta"] }
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  let prevented = false

  mounted.controller.keydown({ key: "Enter", currentTarget: null, defaultPrevented: false, preventDefault: () => { prevented = true } })

  assert.equal(prevented, true)
  assert.deepEqual(mounted.calls.replaceRange, [["[[Alpha]]", 4, 8]])
})

test("visual link routing binds on document capture and ignores idle keys", (t) => {
  assertVisualRouting(t, DocumentLinkPaletteController)
})

// --- Visual-mode metadata assist ---

const metadataAssistSource = (await readFile(new URL("../../../../packages/editor-runtime/dist/lib/metadata_assist.js", import.meta.url), "utf8"))
  .replace('from "@elef/client"', `from "${import.meta.resolve("@elef/client")}"`)
  .replace('from "@elef/work-model"', `from "${import.meta.resolve("@elef/work-model")}"`)
  .replace('from "@elef/work-model/style-vocab"', `from "${import.meta.resolve("@elef/work-model/style-vocab")}"`)
  .replace(/^export\s*\{[^}]*\}\s*;?/m, "")
const MetadataAssistController = await loadController("metadata_assist", {
  base: sharedControllerPath,
  overrides: {
    "../lib/editor_controller_lookup.js": "const editorFor = element => element.currentEditor\n",
    "../lib/metadata_assist.js": metadataAssistSource,
    "../lib/visual_assist.js": visualAssistSource
  }
})

test("visual metadata refresh opens the palette on a frontmatter key", (t) => {
  const mounted = mountAssistPalette({
    controllerClass: MetadataAssistController,
    value: "---\nthe\n---\n",
    caret: 7,
    registry: []
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)

  mounted.controller.refresh()

  assert.equal(mounted.palette.hidden, false)
  assert.deepEqual(mounted.controller.matches, ["theme"])
  assert.equal(mounted.controller.queryStart, 4)
  assert.equal(mounted.palette.style.left, "100px")
  assert.equal(mounted.palette.style.top, "222px")
})

test("visual metadata insert pipelines a key candidate with its colon", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MetadataAssistController,
    value: "---\nthe\n---\n",
    caret: 7,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["theme: ", 4, 7]])
  assert.deepEqual(hostCalls.inserts, [{ from: 4, to: 7, insert: "theme: ", caret: 11 }])
  assert.equal(mounted.calls.focus, 0)
  assert.deepEqual(hostCalls.carets, [[11, null]])
  assert.equal(mounted.palette.hidden, true)
})

test("visual metadata insert pipelines a pure value insertion", async (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MetadataAssistController,
    value: "---\ntheme: \n---\n",
    caret: 11,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(mounted.calls.replaceRange, [["dark", 11, 11]])
  assert.deepEqual(hostCalls.inserts, [{ from: 11, to: 11, insert: "dark", caret: 15 }])
  assert.deepEqual(hostCalls.carets, [[15, null]])
})

test("source metadata insert still focuses the engine", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MetadataAssistController,
    mode: "source",
    value: "---\nthe\n---\n",
    caret: 7,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["theme: ", 4, 7]])
  assert.equal(mounted.calls.focus, 1)
  assert.deepEqual(hostCalls.inserts, [])
})

test("visual metadata keydown accepts the match on Enter", (t) => {
  const { host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MetadataAssistController,
    value: "---\nthe\n---\n",
    caret: 7,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  let prevented = false

  mounted.controller.keydown({ key: "Enter", defaultPrevented: false, preventDefault: () => { prevented = true } })

  assert.equal(prevented, true)
  assert.deepEqual(mounted.calls.replaceRange, [["theme: ", 4, 7]])
})

test("visual metadata routing binds on document capture and ignores idle keys", (t) => {
  assertVisualRouting(t, MetadataAssistController)
})

// --- Visual-mode math shortcut palette ---

const MATH_SHORTCUTS = JSON.parse(await readFile(new URL("../../app/javascript/data/default_authoring_registry.json", import.meta.url), "utf8"))
const ALPHA_SHORTCUT = (Array.isArray(MATH_SHORTCUTS) ? MATH_SHORTCUTS : MATH_SHORTCUTS.entries).find((entry) => entry.id === "default-alpha")

test("visual math refresh opens the palette on an at query", (t) => {
  const mounted = mountAssistPalette({
    controllerClass: MathShortcutPaletteController,
    value: "The $@a",
    caret: 7,
    registry: [ALPHA_SHORTCUT]
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)

  mounted.controller.refresh()

  assert.equal(mounted.palette.hidden, false)
  assert.deepEqual(mounted.controller.matches, [ALPHA_SHORTCUT])
  assert.equal(mounted.controller.query.start, 5)
  assert.equal(mounted.palette.style.left, "100px")
  assert.equal(mounted.palette.style.top, "222px")
})

test("visual math insert pipelines the expansion through the host", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MathShortcutPaletteController,
    value: "The $@a",
    caret: 7,
    registry: [ALPHA_SHORTCUT],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["\\alpha", 5, 7]])
  assert.deepEqual(hostCalls.inserts, [{ from: 5, to: 7, insert: "\\alpha", caret: 11 }])
  assert.equal(mounted.calls.focus, 0)
  assert.deepEqual(hostCalls.carets, [[11, null]])
  assert.equal(mounted.palette.hidden, true)
})

test("source math insert still focuses the engine", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MathShortcutPaletteController,
    mode: "source",
    value: "The $@a",
    caret: 7,
    registry: [ALPHA_SHORTCUT],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["\\alpha", 5, 7]])
  assert.equal(mounted.calls.focus, 1)
  assert.deepEqual(hostCalls.inserts, [])
})

test("visual math keydown accepts the match on Enter", (t) => {
  const { host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MathShortcutPaletteController,
    value: "The $@a",
    caret: 7,
    registry: [ALPHA_SHORTCUT],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  let prevented = false

  mounted.controller.keydown({ key: "Enter", defaultPrevented: false, preventDefault: () => { prevented = true } })

  assert.equal(prevented, true)
  assert.deepEqual(mounted.calls.replaceRange, [["\\alpha", 5, 7]])
})

test("visual math routing binds on document capture and ignores idle keys", (t) => {
  assertVisualRouting(t, MathShortcutPaletteController)
})

test("visual math dot operations rewrite the base through the host", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const vector = { namespace: ".", prefix: ".", id: "default-vector", aliases: ["vec"], name: "Vector", description: "", expansion: "", built_in: true, behavior: { operator_class: "math" } }
  const mounted = mountAssistPalette({
    controllerClass: MathShortcutPaletteController,
    value: "The $x.v",
    caret: 7,
    registry: [vector],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["x.vec", 5, 7]])
  assert.deepEqual(hostCalls.inserts, [{ from: 5, to: 7, insert: "x.vec", caret: 10 }])
  assert.deepEqual(hostCalls.carets, [[10, null]])
})

test("visual math placeholder stops walk the projection caret on Tab", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const sqrt = { namespace: "@", prefix: "@", id: "test-sqrt", aliases: ["sq"], name: "Sq", description: "", expansion: "\\sqrt{${1:x}}", built_in: false }
  const mounted = mountAssistPalette({
    controllerClass: MathShortcutPaletteController,
    value: "The $@sq",
    caret: 8,
    registry: [sqrt],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.insertSelected()
  assert.deepEqual(mounted.calls.setSelectionRange, [[11, 12]])
  assert.deepEqual(hostCalls.carets, [[11, null]])

  let prevented = false
  mounted.controller.keydown({ key: "Tab", defaultPrevented: false, preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.deepEqual(hostCalls.carets, [[11, null], [13, null]])
  assert.deepEqual(mounted.controller.stops, [])
})

// --- Visual-mode mermaid assist ---

const mermaidSyntaxSource = await readFile(new URL("../../../../packages/editor-runtime/dist/controllers/mermaid_syntax.js", import.meta.url), "utf8")
const MermaidAssistController = await loadController("mermaid_assist", {
  base: sharedControllerPath,
  overrides: {
    "../lib/editor_controller_lookup.js": "const editorFor = element => element.currentEditor\n",
    "../lib/visual_assist.js": visualAssistSource,
    "./mermaid_syntax.js": mermaidSyntaxSource
  }
})

function focusProjectionBlock(document) {
  const block = document.querySelector(".editor-projection .block")
  Object.defineProperty(document, "activeElement", { configurable: true, value: block })
  return block
}

test("visual mermaid refresh opens the palette on a diagram command", (t) => {
  const mounted = mountAssistPalette({
    controllerClass: MermaidAssistController,
    value: "See /diag",
    caret: 9,
    registry: []
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  focusProjectionBlock(mounted.document)
  mounted.controller.connected = true

  mounted.controller.refresh()

  assert.equal(mounted.palette.hidden, false)
  assert.equal(mounted.controller.model.kind, "diagram-command")
  assert.equal(mounted.palette.style.left, "100px")
  assert.equal(mounted.palette.style.top, "222px")
})

test("visual mermaid accept chains from command to diagram types", async (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MermaidAssistController,
    value: "See /diag",
    caret: 9,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  focusProjectionBlock(mounted.document)
  mounted.controller.connected = true
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.acceptSelected()
  assert.deepEqual(mounted.calls.replaceRange, [["/diagram", 4, 9]])
  assert.deepEqual(hostCalls.inserts, [{ from: 4, to: 9, insert: "/diagram", caret: 12 }])
  assert.deepEqual(hostCalls.carets, [[12, null]])

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mounted.palette.hidden, false)
  assert.equal(mounted.controller.model.kind, "diagram-types")
  assert.equal(mounted.controller.matches.length, 4)
})

test("visual mermaid type accept inserts the template through the host", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MermaidAssistController,
    value: "See /diagram",
    caret: 12,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  focusProjectionBlock(mounted.document)
  mounted.controller.connected = true
  mounted.controller.refresh()
  assert.equal(mounted.controller.model.kind, "diagram-types")

  mounted.controller.acceptSelected()

  const template = "```mermaid\nflowchart LR\n    A[]\n```"
  assert.deepEqual(mounted.calls.replaceRangeWithSelection, [[`\n${template}`, 4, 12, { from: 31, to: 31 }]])
  assert.deepEqual(hostCalls.inserts, [{ from: 4, to: 12, insert: `\n${template}`, caret: 35 }])
  assert.deepEqual(hostCalls.carets, [[35, null]])
})

test("visual mermaid structural edits route through the host", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MermaidAssistController,
    value: "See /diag",
    caret: 9,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.connected = true

  mounted.controller.applyEdit({ moveTo: 7 })
  assert.deepEqual(mounted.calls.setSelectionRange, [[7, 7]])
  assert.deepEqual(hostCalls.carets, [[7, null]])

  mounted.controller.applyEdit({ insert: "X", from: 5, to: 5, selection: { from: 1, to: 1 } })
  assert.deepEqual(mounted.calls.replaceRangeWithSelection, [["X", 5, 5, { from: 1, to: 1 }]])
  assert.deepEqual(hostCalls.inserts, [{ from: 5, to: 5, insert: "X", caret: 6 }])
  assert.deepEqual(hostCalls.carets, [[7, null], [6, null]])
})

test("source mermaid accept commits without host routing", (t) => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MermaidAssistController,
    mode: "source",
    value: "See /diag",
    caret: 9,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  mounted.controller.connected = true
  mounted.controller.refresh()
  assert.equal(mounted.palette.hidden, false)

  mounted.controller.acceptSelected()

  assert.deepEqual(mounted.calls.replaceRange, [["/diagram", 4, 9]])
  assert.deepEqual(hostCalls.inserts, [])
  assert.deepEqual(hostCalls.carets, [])
})

test("visual mermaid keydown accepts the match on Enter", (t) => {
  const { host } = stubHostDouble()
  const mounted = mountAssistPalette({
    controllerClass: MermaidAssistController,
    value: "See /diag",
    caret: 9,
    registry: [],
    host
  })
  const globals = stubAssistGlobals(t)
  globals.setDocument(mounted.document)
  focusProjectionBlock(mounted.document)
  mounted.controller.connected = true
  mounted.controller.refresh()
  let prevented = false
  let stopped = false

  mounted.controller.keydown({ key: "Enter", defaultPrevented: false, isComposing: false, keyCode: 13, preventDefault: () => { prevented = true }, stopPropagation: () => { stopped = true } })

  assert.equal(prevented, true)
  assert.equal(stopped, true)
  assert.deepEqual(mounted.calls.replaceRange, [["/diagram", 4, 9]])
})

test("visual mermaid routing binds on document capture and ignores idle keys", (t) => {
  assertVisualRouting(t, MermaidAssistController)
})

// --- Visual-mode math shorthand ---

const MathShorthandController = await loadController("math_shorthand", {
  base: sharedControllerPath,
  overrides: {
    "../lib/editor_controller_lookup.js": "const editorFor = element => element.currentEditor\n",
    "../lib/visual_assist.js": visualAssistSource,
    "../lib/vim_escape.js": "const editorPopupOpen = () => false\n",
    "@codemirror/language": "const syntaxTree = (state) => state.tree\n"
  }
})

// The chain parser reads the line through editor.view.state.doc while the
// math-context scan only needs the buffer text; an empty syntax tree keeps
// both paths on real prose (never code).
function stubShorthandEngine({ mode = "visual", value = "See $x.b$ done", caret = 7 } = {}) {
  const stubbed = stubAssistEngine({ mode, value, caret })
  stubbed.engine.view.state.doc.sliceString = (from, to) => stubbed.engine.value.slice(from, to)
  stubbed.engine.view.state.tree = { resolveInner: () => null }
  return stubbed
}

function mountShorthand({ mode = "visual", value = "See $x.b$ done", caret = 7, host = null } = {}) {
  const { document } = parseHTML(`<form><div class="field"><div class="editor-projection"><div class="block" contenteditable="true"></div></div></div></form>`)
  const form = document.querySelector("form")
  const field = document.querySelector(".field")
  if (host) form.visualEditorController = host
  const { engine, calls } = stubShorthandEngine({ mode, value, caret })
  const controller = new MathShorthandController()
  Object.assign(controller, { element: field, editorController: engine, pendingChain: null })
  return { controller, engine, calls, field, form, document }
}

function shorthandKey(key, extra = {}) {
  const event = {
    key,
    code: key === " " ? "Space" : key,
    defaultPrevented: false,
    isComposing: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => { event.defaultPrevented = true },
    ...extra
  }
  return event
}

test("visual shorthand Space commits the chain through the projection host", () => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountShorthand({ host })
  // commitVisualEdit arms the flush through document.activeElement; the
  // mount's own linkedom document keeps that lookup coherent.
  const restoreDocument = replaceGlobal("document", mounted.document)

  try {
    const event = shorthandKey(" ")
    mounted.controller.keydown(event)

    assert.equal(event.defaultPrevented, true)
    assert.equal(mounted.engine.value, "See $\\mathbf{x} $ done")
    assert.deepEqual(mounted.calls.replaceRange, [["\\mathbf{x} ", 5, 8]])
    assert.deepEqual(hostCalls.inserts, [{ from: 5, to: 8, insert: "\\mathbf{x} ", caret: 16, selectionBefore: 7, replaced: "x.b" }])
    assert.equal(mounted.calls.focus, 0, "the engine is never focused for a visual commit")
    assert.equal(mounted.controller.pendingChain, null)
  } finally {
    restoreDocument()
  }
})

test("source shorthand commit skips the projection pipeline", () => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountShorthand({ mode: "source", host })

  const committed = mounted.controller.commit({ status: "valid", start: 5, end: 8, source: "x.b", expansion: "\\mathbf{x}" }, " ")

  assert.equal(committed, true)
  assert.equal(mounted.engine.value, "See $\\mathbf{x} $ done")
  assert.deepEqual(mounted.calls.replaceRange, [["\\mathbf{x} ", 5, 8]])
  assert.deepEqual(hostCalls.inserts, [])
  assert.deepEqual(mounted.calls.setSelectionRange, [], "natural collapse keeps its source placement")
  assert.equal(mounted.controller.pendingChain, null)
})

test("visual shorthand Escape cancels the chain without editing", () => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountShorthand({ host })

  const event = shorthandKey("Escape")
  mounted.controller.keydown(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(mounted.engine.value, "See $x.b$ done")
  assert.deepEqual(mounted.calls.replaceRange, [])
  assert.deepEqual(hostCalls.inserts, [])
  assert.equal(mounted.controller.pendingChain, null)
})

test("visual shorthand Backspace deletes a dollar pair through the host", () => {
  const { calls: hostCalls, host } = stubHostDouble()
  const mounted = mountShorthand({ value: "See $$ done", caret: 5, host })
  const restoreDocument = replaceGlobal("document", mounted.document)

  try {
    const event = shorthandKey("Backspace")
    mounted.controller.keydown(event)

    assert.equal(event.defaultPrevented, true)
    assert.equal(mounted.engine.value, "See  done")
    assert.deepEqual(mounted.calls.replaceRange, [["", 4, 6]])
    assert.deepEqual(hostCalls.inserts, [{ from: 4, to: 6, insert: "", caret: 4, selectionBefore: 5, replaced: "$$" }])
  } finally {
    restoreDocument()
  }
})

test("visual edit-actions trigger event re-refreshes every assist palette", (t) => {
  // The shared menu inserts triggers programmatically, then dispatches
  // elef:assist-trigger-inserted so each palette re-refreshes against the
  // restored caret. One connected mount per palette proves the bridge.
  const cases = [
    {
      name: "snippet",
      controllerClass: SnippetPaletteController,
      value: "Body /ta",
      caret: 8,
      registry: VISUAL_SNIPPETS,
      assertOpen: (mounted) => {
        assert.equal(mounted.palette.hidden, false)
        assert.ok(mounted.controller.matches.length > 0)
      }
    },
    {
      name: "document link",
      controllerClass: DocumentLinkPaletteController,
      value: "See [[al",
      caret: 8,
      registry: [],
      assign: { titlesValue: ["Alpha", "Beta"] },
      assertOpen: (mounted) => {
        assert.equal(mounted.palette.hidden, false)
        assert.deepEqual(mounted.controller.matches, ["Alpha"])
      }
    },
    {
      name: "math shortcut",
      controllerClass: MathShortcutPaletteController,
      value: "The $@a",
      caret: 7,
      registry: [ALPHA_SHORTCUT],
      assertOpen: (mounted) => {
        assert.equal(mounted.palette.hidden, false)
        assert.deepEqual(mounted.controller.matches, [ALPHA_SHORTCUT])
      }
    },
    {
      name: "mermaid",
      controllerClass: MermaidAssistController,
      value: "See /diag",
      caret: 9,
      registry: [],
      assign: { hasPaletteTarget: true },
      assertOpen: (mounted) => {
        assert.equal(mounted.palette.hidden, false)
        assert.equal(mounted.controller.model.kind, "diagram-command")
      }
    }
  ]

  for (const { name, controllerClass, value, caret, registry, assign = {}, assertOpen } of cases) {
    const mounted = mountAssistPalette({ controllerClass, value, caret, registry, assign })
    const globals = stubAssistGlobals(t)
    globals.setDocument(mounted.document)
    focusProjectionBlock(mounted.document)
    mounted.field.currentEditor = mounted.engine
    mounted.controller.connect()
    // connect() re-resolves the registry from the element; restore the case rows.
    mounted.controller.registry = registry

    const event = mounted.document.createEvent("Event")
    event.initEvent("elef:assist-trigger-inserted", true, false)
    mounted.field.dispatchEvent(event)
    assertOpen(mounted)

    // disconnect() unbinds the bridge: re-closing, then re-dispatching,
    // must not reopen. Mermaid's refresh additionally gates on its
    // connected flag and editor, so re-arm those to isolate the listener.
    mounted.controller.close()
    mounted.controller.disconnect()
    mounted.controller.connected = true
    mounted.controller.editorController = mounted.engine
    mounted.controller.registry = registry
    const reopen = mounted.document.createEvent("Event")
    reopen.initEvent("elef:assist-trigger-inserted", true, false)
    mounted.field.dispatchEvent(reopen)
    assert.equal(mounted.palette.hidden, true, `${name} stays closed after disconnect`)
  }
})

test("visual shorthand routing mirrors every source binding on document capture", (t) => {
  const saved = new Map()
  const setGlobal = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  const added = []
  const removed = []
  setGlobal("document", {
    activeElement: null,
    addEventListener: (type, listener, capture) => added.push([type, listener, capture]),
    removeEventListener: (type, listener, capture) => removed.push([type, listener, capture])
  })

  const { engine } = stubShorthandEngine({})
  const elementDouble = {
    currentEditor: engine,
    closest: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  const controller = new MathShorthandController()
  Object.assign(controller, { element: elementDouble, pendingChain: null })
  controller.connect()

  for (const type of ["keydown", "keyup", "mousedown", "click"]) {
    const binding = added.find(([bound]) => bound === type)
    assert.ok(binding, `${type} is bound on document capture`)
    assert.equal(binding[2], true)
  }
  // focusout/submit stay source-only: blur commits need no visual pipeline
  // because the blur-triggered projection install discards the mapping.
  assert.equal(added.some(([bound]) => bound === "focusout"), false)

  let routed = 0
  controller.keydown = () => { routed += 1 }
  const keydownBinding = added.find(([bound]) => bound === "keydown")
  keydownBinding[1]({ key: " " })
  assert.equal(routed, 1, "visual keys reach the shared keydown")
  engine.editingMode = "source"
  keydownBinding[1]({ key: " " })
  assert.equal(routed, 1, "source keys keep flowing through the editor.dom binding only")

  engine.editingMode = "visual"
  const keyupBinding = added.find(([bound]) => bound === "keyup")
  keyupBinding[1]({ key: "b", ctrlKey: false, metaKey: false, altKey: false })
  assert.equal(controller.pendingChain?.start, 5, "visual keyup refreshes the pending chain")
  assert.equal(controller.pendingChain?.end, 8)

  controller.disconnect()
  for (const type of ["keydown", "keyup", "mousedown", "click"]) {
    const binding = added.find(([bound]) => bound === type)
    assert.ok(removed.some(([bound, listener, capture]) => bound === type && listener === binding[1] && capture === true))
  }
})


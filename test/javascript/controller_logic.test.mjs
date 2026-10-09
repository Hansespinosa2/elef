import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const controllerPath = new URL("../../app/javascript/controllers/", import.meta.url)

async function loadController(name, overrides = {}) {
  let source = await readFile(new URL(`${name}_controller.js`, controllerPath), "utf8")
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
const SnippetPaletteController = await loadController("snippet_palette")
const DocumentPagesController = await loadController("document_pages")
const LineageGraphController = await loadController("lineage_graph")
const MermaidDiagramsController = await loadController("mermaid_diagrams", {
  "controllers/mermaid_runtime": "const renderMermaidDiagrams = element => globalThis.__renderMermaidDiagrams(element)\n"
})
const PresentationCanvasController = await loadController("presentation_canvas")
const PresentationEditorController = await loadController("presentation_editor")
const VisualEditorController = await loadController("visual_editor")

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

test("presentation canvas scale fits both the design width and height", () => {
  const controller = new PresentationCanvasController()
  controller.element = { clientWidth: 800, clientHeight: 400 }
  controller.designWidthValue = 1280
  controller.designHeightValue = 720
  controller.hasDesignHeightValue = true

  assert.equal(controller.canvasScale(), 400 / 720)
})

test("presentation source edits shift nested projection ranges and source length once", () => {
  const block = { range: { start: 12, end: 14 }, content_range: { start: 14, end: 20 } }
  const controller = new PresentationEditorController()
  controller.map = {
    source_length: 20,
    slides: [{ range: { start: 4, end: 18 }, blocks: [block] }],
    directives: [{ range: { start: 0, end: 10 } }]
  }

  controller.shiftMapAfterEdit(10, 14, 2)

  assert.equal(controller.map.source_length, 18)
  assert.deepEqual(controller.map.slides[0].range, { start: 4, end: 16 })
  assert.deepEqual(block.range, { start: 12, end: 12 })
  assert.deepEqual(block.content_range, { start: 12, end: 18 })
  assert.deepEqual(controller.map.directives[0].range, { start: 0, end: 10 })
})

test("visual source edits preserve the edited block start and shift shared map entries once", () => {
  const edited = { id: "block-1", range: { start: 10, end: 14 }, source_range: { start: 8, end: 12 } }
  const after = { range: { start: 14, end: 20 } }
  const controller = new VisualEditorController()
  controller.map = {
    source_length: 20,
    slides: [{ blocks: [edited, after] }],
    editable_regions: [edited]
  }

  controller.shiftMapAfterEdit(10, 14, 2, "block-1")

  assert.equal(controller.map.source_length, 18)
  assert.deepEqual(edited.range, { start: 10, end: 12 })
  assert.deepEqual(edited.source_range, { start: 8, end: 12 })
  assert.deepEqual(after.range, { start: 12, end: 18 })
})

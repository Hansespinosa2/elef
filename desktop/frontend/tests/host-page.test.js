import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parseHTML } from "linkedom"

const page = await readFile(new URL("../index.html", import.meta.url), "utf8")
const shellStyles = await readFile(new URL("../src/desktop-shell.css", import.meta.url), "utf8")
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8")
const editorRuntime = await readFile(new URL("../src/editor-runtime.js", import.meta.url), "utf8")
const build = await readFile(new URL("../build.mjs", import.meta.url), "utf8")
const editorView = await readFile(new URL("../../../app/javascript/lib/editor_view.js", import.meta.url), "utf8")
const libraryView = await readFile(new URL("../../../app/javascript/lib/library_view.js", import.meta.url), "utf8")
const viewportStyles = await readFile(new URL("../src/desktop-rendered-content.css", import.meta.url), "utf8")
const { document } = parseHTML(page)

test("rendered decks reuse Rails styles with only native viewport chrome", () => {
  assert.ok(document.querySelector('link[href="./assets/desktop_shell.css"]'))
  assert.ok(document.querySelector('link[href="./assets/tailwind.css"]'))
  assert.ok(document.querySelector('link[href="./assets/katex.min.css"]'))
  assert.ok(document.querySelector('link[href="./assets/app.css"]'))
  assert.deepEqual(
    Array.from(document.querySelectorAll("link[rel=stylesheet]"), link => link.getAttribute("href")).slice(-3),
    ["./assets/tailwind.css", "./assets/katex.min.css", "./assets/app.css"],
    "desktop loads shared stylesheets in the Rails layout order",
  )
  assert.match(shellStyles, /\.app-frame\s*\{/)
  assert.ok(main.includes('import "../../../app/assets/stylesheets/application.css"'))
  assert.doesNotMatch(viewportStyles, /^\.(?:editor|slide|document|presentation|katex)[\w.-]*(?:\s|\{|:)/m)
  assert.doesNotMatch(main, /import ["']\.\/editor\.css["']/)
})

test("desktop host page provides every element referenced by the app shell", () => {
  const ids = new Set([...main.matchAll(/document\.querySelector\(["']#([\w-]+)/g)].map(match => match[1]))
  const dynamicallyRendered = new Set([
    "desktop-editor-field", "desktop-editor-title", "deck-source", "visual-mode", "desktop-preview", "library-count",
    "library-description", "library-search", "show-deck-list", "show-documents", "show-presentations",
    "notice", "document-graph-view", "deck-list", "library-load-more", "empty-library", "library-no-results"
  ])
  const missing = [...ids].filter(id => !document.getElementById(id) && !dynamicallyRendered.has(id))
  assert.deepEqual(missing, [])
})

test("the shell presents itself as Elef Desktop rather than a preview build", () => {
  assert.match(document.querySelector(".app-version").textContent, /^Elef Desktop · v\d/)
})

test("the host mounts the shared editor view and gates visual editing until preview renders", () => {
  const sourceForm = document.querySelector("#desktop-editor-form")
  assert.equal(sourceForm.dataset.editorMode, "source")
  assert.equal(sourceForm.dataset.controller, undefined)
  assert.ok(document.querySelector("#desktop-editor-mount"))
  assert.match(main, /renderEditorView\(document\.querySelector\("#desktop-editor-mount"\)/)
  assert.match(main, /sourceName: "presentation\[source\]"/)
  assert.match(main, /elements\.editorInput\.name = isDocument \? "document\[source\]" : "presentation\[source\]"/)
  assert.match(main, /elements\.editorForm\.dataset\.controller = "preview visual-editor presentation-editor slide-overview media presentation"/)
  assert.match(editorView, /data-editor-target="visualButton"/)
  assert.match(editorView, /data-presentation-target="stage"/)
  assert.match(editorView, /visualButton\.disabled = Boolean\(config\.visualDisabled\)/)
})

test("the editor discloses the remaining external-write race", () => {
  assert.match(document.querySelector(".editor-help").textContent, /simultaneous write can still be overwritten during the final atomic replacement/i)
  assert.match(document.querySelector(".editor-help").textContent, /sync tool's version history enabled/i)
})

test("the host uses no inline event handlers under the strict script policy", () => {
  assert.equal(document.querySelector("[onclick], [onerror], [onload]"), null)
})

test("desktop no longer carries a second copy of the shared editor markup", () => {
  assert.equal(document.querySelector("#desktop-editor-form .editor-toolbar"), null)
  assert.equal(document.querySelector("#desktop-editor-form .slide-overview"), null)
  assert.match(editorView, /appearance-settings/)
  assert.match(editorView, /slide-overview/)
  assert.match(editorView, /input->snippet-palette#input/)
  assert.match(editorView, /input->document-link-palette#input/)
})

test("desktop mounts the shared library view and keeps the document graph in Documents", () => {
  assert.ok(document.querySelector("#library-view-mount"))
  assert.match(main, /renderLibraryView\(document\.querySelector\("#library-view-mount"\)/)
  assert.match(main, /setLibraryViewTab\(document\.querySelector\("#library-view-mount"\)/)
  assert.doesNotMatch(main, /elements\.description\.textContent|elements\.graphView\.hidden = libraryTab/)
  assert.match(libraryView, /id="show-deck-list" class="library-tab" data-library-tab="all"/)
  assert.match(libraryView, /id="show-documents" class="library-tab" data-library-tab="documents"/)
  assert.match(libraryView, /id="show-presentations" class="library-tab" data-library-tab="presentations"/)
  assert.match(libraryView, /id="document-graph-view"/)
  assert.doesNotMatch(libraryView, /show-document-graph/)
})

test("desktop defers shared editor and graph controllers until their views are used", () => {
  assert.match(main, /loadDesktopEditorRuntime\(\)/)
  assert.match(main, /loadDesktopLibraryRuntime\(\)/)
  assert.match(editorRuntime, /import\("controllers\/editor_controller"\)/)
  assert.match(editorRuntime, /import\("controllers\/document_graph_controller"\)/)
  assert.doesNotMatch(editorRuntime, /^import\s+\w+Controller\s+from\s+["']controllers\//m)
  assert.match(build, /splitting:\s*true/)
})

test("document reload reapplies editor preferences and readiness follows successful connection", async () => {
  const controller = await readFile(new URL("../../../app/javascript/controllers/editor_controller.js", import.meta.url), "utf8")
  const load = controller.slice(controller.indexOf("  loadDocument(source)"), controller.indexOf("  setExternalValue(value)"))
  for (const method of ["vimCompartment.reconfigure", "applyLineNumbers", "applyCursorStyle", "refreshFrontmatterRange", "setEditingMode", "syncMetadataToggle"]) {
    assert.ok(load.includes(method), `New documents must reapply ${method}`)
  }
  const ready = controller.indexOf("this.editorReady = true")
  assert.ok(ready > controller.indexOf("this.collapseFrontmatter()"))
  assert.ok(ready < controller.indexOf('new CustomEvent("elef:editor-ready"'))
})

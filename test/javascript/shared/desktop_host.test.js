import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parseHTML } from "linkedom"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const read = relative => readFile(path.join(root, relative), "utf8")
const [page, shellStyles, application, bootstrap, editorRuntime, build, editorView, libraryView] = await Promise.all([
  read("app/views/desktop_host.html"),
  read("app/assets/stylesheets/file_library_host.css"),
  read("app/javascript/lib/file_library_application.js"),
  read("desktop/frontend/src/main.js"),
  read("app/javascript/lib/editor_runtime.js"),
  read("desktop/frontend/build.mjs"),
  read("app/javascript/lib/editor_view.js"),
  read("app/javascript/lib/library_view.js")
])
const { document } = parseHTML(page)

test("the desktop packages Rails-owned host markup and styles", () => {
  assert.deepEqual(
    Array.from(document.querySelectorAll("link[rel=stylesheet]"), link => link.getAttribute("href")),
    ["./assets/file_library_host.css", "./assets/tailwind.css", "./assets/katex.min.css", "./assets/app.css"]
  )
  assert.match(shellStyles, /\.app-frame\s*\{/)
  assert.match(shellStyles, /\.file-library-editor-form\s*\{/)
  assert.match(bootstrap, /app\/assets\/stylesheets\/application\.css/)
  assert.match(build, /app\/views\/desktop_host\.html/)
  assert.match(build, /app\/assets\/stylesheets\/file_library_host\.css/)
})

test("the native entry point only wires Tauri APIs into the Rails-owned application", () => {
  assert.match(bootstrap, /startFileLibraryApplication\(/)
  assert.doesNotMatch(bootstrap, /document\.querySelector|innerHTML|\.textContent|\.classList/)
  assert.doesNotMatch(bootstrap, /desktop-shell\.css|desktop-rendered-content\.css/)
})

test("the Rails-owned application references elements present in its host template", () => {
  const ids = new Set([...application.matchAll(/document\.querySelector\(["']#([\w-]+)/g)].map(match => match[1]))
  const dynamicallyRendered = new Set([
    "desktop-editor-field", "desktop-editor-title", "deck-source", "visual-mode", "desktop-preview", "library-count",
    "library-description", "library-search", "show-deck-list", "show-documents", "show-presentations",
    "notice", "document-graph-view", "deck-list", "library-load-more", "empty-library", "library-no-results"
  ])
  const missing = [...ids].filter(id => !document.getElementById(id) && !dynamicallyRendered.has(id))
  assert.deepEqual(missing, [])
})

test("the desktop host mounts the shared editor and gates visual editing until preview renders", () => {
  const sourceForm = document.querySelector("#desktop-editor-form")
  assert.equal(sourceForm.dataset.editorMode, "source")
  assert.equal(sourceForm.dataset.controller, undefined)
  assert.ok(document.querySelector("#desktop-editor-mount"))
  assert.match(application, /renderEditorView\(document\.querySelector\("#desktop-editor-mount"\)/)
  assert.match(application, /sourceName: "presentation\[source\]"/)
  assert.match(application, /configureEditorKind\(elements\.editorField\.closest\("\.editor-shell"\), isDocument \? "document" : "presentation"/)
  assert.doesNotMatch(application, /elements\.editorInput\.name = isDocument/)
  assert.match(editorView, /export function configureEditorKind\(root, kind/)
  assert.match(editorView, /visualButton\.disabled = Boolean\(config\.visualDisabled\)/)
})

test("the editor discloses the remaining external-write race", () => {
  assert.match(document.querySelector(".editor-help").textContent, /simultaneous write can still be overwritten during the final atomic replacement/i)
  assert.match(document.querySelector(".editor-help").textContent, /sync tool's version history enabled/i)
})

test("the host uses no inline event handlers under the strict script policy", () => {
  assert.equal(document.querySelector("[onclick], [onerror], [onload]"), null)
})

test("the editor host uses the shared editor markup rather than a second copy", () => {
  assert.equal(document.querySelector("#desktop-editor-form .editor-toolbar"), null)
  assert.equal(document.querySelector("#desktop-editor-form .slide-overview"), null)
  assert.match(editorView, /appearance-settings/)
  assert.match(editorView, /slide-overview/)
  assert.match(editorView, /input->snippet-palette#input/)
  assert.match(editorView, /input->document-link-palette#input/)
})

test("the file-backed host mounts the shared library view and graph", () => {
  assert.ok(document.querySelector("#library-view-mount"))
  assert.match(application, /renderLibraryView\(document\.querySelector\("#library-view-mount"\)/)
  assert.match(application, /setLibraryViewTab\(document\.querySelector\("#library-view-mount"\)/)
  assert.doesNotMatch(application, /elements\.description\.textContent|elements\.graphView\.hidden = libraryTab/)
  assert.match(libraryView, /id="show-deck-list" class="library-tab" data-library-tab="all"/)
  assert.match(libraryView, /id="show-documents" class="library-tab" data-library-tab="documents"/)
  assert.match(libraryView, /id="show-presentations" class="library-tab" data-library-tab="presentations"/)
  assert.match(libraryView, /id="document-graph-view"/)
  assert.doesNotMatch(libraryView, /show-document-graph/)
})

test("the Rails-owned application loads shared editor and graph controllers on demand", () => {
  assert.match(application, /loadEditorRuntime\(\)/)
  assert.match(application, /loadLibraryRuntime\(\)/)
  assert.match(bootstrap, /from "lib\/editor_runtime"/)
  assert.match(editorRuntime, /import\("controllers\/editor_controller"\)/)
  assert.match(editorRuntime, /import\("controllers\/document_graph_controller"\)/)
  assert.doesNotMatch(editorRuntime, /^import\s+\w+Controller\s+from\s+["']controllers\//m)
  assert.match(build, /splitting:\s*true/)
})

test("document reload reapplies editor preferences and readiness follows connection", async () => {
  const controller = await read("app/javascript/controllers/editor_controller.js")
  const load = controller.slice(controller.indexOf("  loadDocument(source)"), controller.indexOf("  setExternalValue(value)"))
  for (const method of ["vimCompartment.reconfigure", "applyLineNumbers", "applyCursorStyle", "refreshFrontmatterRange", "setEditingMode", "syncMetadataToggle"]) {
    assert.ok(load.includes(method), `New documents must reapply ${method}`)
  }
  const ready = controller.indexOf("this.editorReady = true")
  assert.ok(ready > controller.indexOf("this.collapseFrontmatter()"))
  assert.ok(ready < controller.indexOf('new CustomEvent("elef:editor-ready"'))
})

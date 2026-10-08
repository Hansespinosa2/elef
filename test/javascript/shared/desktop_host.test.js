import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parseHTML } from "linkedom"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const read = relative => readFile(path.join(root, relative), "utf8")
const [hostTemplate, shellStyles, applicationStyles, application, bootstrap, editorRuntime, build, editorView, clientLibrary, fileLibraryTransport] = await Promise.all([
  read("app/views/desktop_host.html"),
  read("app/assets/stylesheets/file_library_host.css"),
  read("app/assets/stylesheets/application.css"),
  read("app/javascript/lib/file_library_application.js"),
  read("desktop/frontend/src/main.js"),
  read("app/javascript/lib/editor_runtime.js"),
  read("desktop/frontend/build.mjs"),
  read("app/javascript/lib/editor_view.js"),
  read("packages/client/src/features/library/LibraryApp.tsx"),
  read("desktop/frontend/src/file-library-transport.js")
])
const authoringMarkup = await read("app/views/shared/_authoring_settings_dialog.html.erb")
const page = hostTemplate.replace("<!-- elef:shared-authoring-settings -->", authoringMarkup)
const importmap = await read("config/importmap.rb")
const rootPackage = JSON.parse(await read("package.json"))
const appearanceController = await read("app/javascript/controllers/appearance_controller.js")
const autosaveController = await read("app/javascript/controllers/autosave_controller.js")
const workSession = await read("app/javascript/lib/work_session.js")
const quietSavePolicy = await read("desktop/frontend/src/quiet_save_policy.js")
const { document } = parseHTML(page)
// The empty-library call to action is client-owned now; the host template
// carries no empty-action slot. Assert the shared button classes in the
// client source that renders them.
const emptyAction = clientLibrary.match(/id="empty-library"([\s\S]*?)<\/div>\s*<p id="library-no-results"/)?.[0] || ""

test("the desktop packages Rails-owned host markup and styles", () => {
  assert.deepEqual(
    Array.from(document.querySelectorAll("link[rel=stylesheet]"), link => link.getAttribute("href")),
    ["./assets/file_library_host.css", "./assets/tailwind.css", "./assets/katex.min.css", "./assets/app.css"]
  )
  assert.match(document.querySelector(".desktop-app-header").className, /border-b/)
  assert.match(document.querySelector(".brand").className, /no-underline/)
  assert.match(shellStyles, /\.desktop-app-header \.app-header-inner\s*\{/)
  assert.match(shellStyles, /\.file-library-editor-form\s*\{/)
  assert.match(shellStyles, /\.desktop-app-shell\s*\{[^}]*max-width: 1440px/)
  assert.doesNotMatch(shellStyles, /^h1\s*\{/m)
  assert.match(bootstrap, /app\/assets\/stylesheets\/application\.css/)
  assert.match(editorRuntime, /import\("controllers\/vim_settings_controller"\)/)
  assert.match(page, /data-controller="vim-settings" data-vim-settings-view/)
  assert.match(build, /app\/views\/desktop_host\.html/)
  assert.match(build, /app\/views\/shared\/_authoring_settings_dialog\.html\.erb/)
  assert.match(build, /desktopHost\.replace\(authoringSettingsMarker, sharedAuthoringSettings\)/)
  assert.equal((hostTemplate.match(/<!-- elef:shared-authoring-settings -->/g) || []).length, 1)
  assert.equal((page.match(/id="authoring-settings-dialog"/g) || []).length, 1)
  assert.match(applicationStyles, /\.authoring-settings-dialog\s*\{/)
  assert.doesNotMatch(shellStyles, /\.authoring-settings-dialog\s*\{/)
  assert.match(build, /app\/assets\/stylesheets\/file_library_host\.css/)
  assert.equal(document.querySelector("#library-view-mount").classList.contains("elef-app"), false)
  const sharedRules = new Map([
    [".library-card", ".library-shared-view .library-card"],
    [".library-list", ".library-list"],
    [".library-tab", ".library-tab"],
    [".search-box", ".library-shared-view .search-box"],
    [".library-card-preview", ".library-shared-view .library-card-preview"],
    [".deck-action", ".library-shared-view .deck-action"],
    [".deck-warning", ".library-shared-view .deck-warning"],
    [".notice", ".library-shared-view .notice"],
    [".library-no-results", ".library-no-results"]
  ])
  for (const [hostSelector, sharedSelector] of sharedRules) {
    assert.ok(applicationStyles.includes(sharedSelector), `${hostSelector} styles must be shared by Rails and desktop`)
    assert.equal(shellStyles.includes(hostSelector), false, `${hostSelector} styles must not live in the desktop host stylesheet`)
  }
  assert.match(applicationStyles, /\.library-shared-view \.search-box\s*\{[^}]*var\(--panel, var\(--oradia-slate-900\)\)/)
  assert.match(applicationStyles, /\.library-shared-view \.library-card\s*\{[^}]*background: var\(--panel,/)
  assert.match(applicationStyles, /\.library-shared-view \.library-card:hover\s*\{[^}]*border-color:.*!important/)
  assert.match(applicationStyles, /\.library-shared-view h1,\s*\.library-shared-view h2,\s*\.library-shared-view h3\s*\{[^}]*font-family: var\(--oradia-serif\)/)
  assert.match(applicationStyles, /\.library-shared-view \.button:not\(\.primary\)\s*\{[^}]*var\(--sidebar, var\(--oradia-slate-800\)\)/)
  assert.match(emptyAction, /class(Name)?="button primary inline-flex[^\"]+"/)
  assert.match(applicationStyles, /\.library-shared-view \.button\.primary\s*\{/)
})

test("desktop uses the Rails app shell and shared editor width instead of a second visual layout", () => {
  assert.equal(document.body.classList.contains("elef-app"), true)
  assert.ok(document.querySelector("header.app-header.desktop-app-header"))
  assert.ok(document.querySelector("main.app-shell.desktop-app-shell"))
  assert.equal(document.querySelector(".sidebar, .topbar, .deck-detail-card"), null)
  assert.ok(document.querySelector("#deck-view form.file-library-editor-form"))
  assert.match(shellStyles, /--canvas: var\(--oradia-slate-950\)/)
  assert.match(shellStyles, /:root\[data-theme="light"\][^{]*\{[^}]*--oradia-slate-950: #f5f4f0/)
  assert.match(shellStyles, /@media \(prefers-color-scheme: light\)[\s\S]*:root\[data-theme="system"\]/)
  assert.match(shellStyles, /body\[data-desktop-view="editor"\] \.desktop-library-location,[\s\S]*?\.desktop-header-actions \{ display: none; \}/)
  assert.doesNotMatch(shellStyles, /\.library-shared-view|\.library-card\s*\{/)
})

test("the native entry point only wires Tauri APIs into the Rails-owned application", () => {
  assert.match(bootstrap, /startFileLibraryApplication\(/)
  assert.doesNotMatch(bootstrap, /document\.querySelector|innerHTML|\.textContent|\.classList/)
  assert.doesNotMatch(bootstrap, /desktop-shell\.css|desktop-rendered-content\.css/)
  assert.match(bootstrap, /createFileLibraryTransport\(\{ invoke \}\)/)
  assert.match(application, /fileLibrary\.listDecks\(\)/)
  assert.doesNotMatch(application, /\binvoke\s*\(/)
  assert.doesNotMatch(application, /["'](?:get_library_status|list_decks|create_deck|save_source|install_update)["']/)
  assert.match(fileLibraryTransport, /listDecks: \(\) => invoke\("list_decks"\)/)
})

test("desktop media URLs and fetch interception stay in native transport", async () => {
  const mediaTransport = await read("desktop/frontend/src/media-transport.js")
  assert.doesNotMatch(application, /elef(?:-preview|-upload|asset):\/\//)
  assert.doesNotMatch(application, /globalThis\.fetch\s*=/)
  assert.doesNotMatch(application, /__elefPreviewTrace/)
  assert.equal(document.querySelector("#desktop-editor-form").dataset.previewUrlValue, "")
  assert.match(mediaTransport, /export function mediaUrlsForDeck\(/)
  assert.match(bootstrap, /globalThis\.fetch = createPreviewFetch/)
  assert.match(bootstrap, /mediaUrlsForDeck,/)
})

test("Rails and desktop consume the same Rails-owned save state machine", () => {
  assert.match(autosaveController, /import \{ createSaveFlow \} from "lib\/save_flow"/)
  assert.match(application, /import \{ createWorkSession \} from "lib\/work_session"/)
  assert.match(workSession, /import \{ createSaveFlow \} from "\.\/save_flow\.js"/)
  assert.match(autosaveController, /import \{ presentConflictDialog \} from "lib\/conflict_dialog"/)
  assert.match(application, /import \{ presentConflictDialog \} from "lib\/conflict_dialog"/)
  assert.doesNotMatch(bootstrap, /createSaveFlow|conflict-dialog|autosave#schedule/)
  assert.match(bootstrap, /quietSavePolicy: createQuietSavePolicy\(\)/)
  assert.match(application, /quietSavePolicy\.saveDelay/)
  assert.match(application, /quietSavePolicy\.externalPollMs/)
  assert.match(application, /quietSavePolicy\.snapshotIntervalMs/)
  assert.match(quietSavePolicy, /saveDelay: 2000/)
  assert.match(quietSavePolicy, /QUIET_SAVE_SNAPSHOT_INTERVAL_MS = 5 \* 60 \* 1000/)
})

test("Rails and desktop share one sanitized preview insertion path", () => {
  assert.match(editorView, /import \{ installSanitizedPreview \} from "#elef\/preview-sanitizer"/)
  assert.match(importmap, /pin "#elef\/preview-sanitizer", to: "lib\/preview_sanitizer\.js"/)
  assert.equal(rootPackage.imports["#elef/preview-sanitizer"], "./app/javascript/lib/preview_sanitizer.js")
  assert.match(build, /preview-sanitizer/)
  assert.match(editorView, /installSanitizedPreview\(container, html, \{ mediaBaseUrl \}\)/)
  const previewInstaller = editorView.match(/export function installPreviewHtml\([\s\S]*?\n\}/)?.[0] || ""
  assert.doesNotMatch(previewInstaller, /elefInstallDesktopPreview|innerHTML/)
  assert.doesNotMatch(editorView, /elefInstallDesktopPreview/)
  assert.doesNotMatch(application, /elefInstallDesktopPreview/)
})

test("the Rails-owned application references elements present in its host template", () => {
  const ids = new Set([...application.matchAll(/document\.querySelector\(["']#([\w-]+)/g)].map(match => match[1]))
  const dynamicallyRendered = new Set([
    "desktop-editor-field", "desktop-editor-title", "deck-source", "visual-mode", "desktop-preview", "library-count",
    "save-state", "retry-save",
    "library-description", "library-search", "show-deck-list", "show-documents", "show-presentations",
    "notice", "document-graph-view", "deck-list", "library-load-more", "empty-library", "library-no-results"
  ])
  const missing = [...ids].filter(id => !document.getElementById(id) && !dynamicallyRendered.has(id))
  assert.deepEqual(missing, [])
})

test("the desktop host defaults to Rails' Visual mode and gates it until preview renders", async () => {
  const sourceForm = document.querySelector("#desktop-editor-form")
  assert.equal(sourceForm.dataset.editorMode, "visual")
  assert.equal(sourceForm.dataset.controller, undefined)
  assert.ok(document.querySelector("#desktop-editor-mount"))
  assert.match(application, /renderEditorView\(document\.querySelector\("#desktop-editor-mount"\)/)
  assert.match(application, /mode: "visual"/)
  assert.match(application, /sourceName: "presentation\[source\]"/)
  assert.match(application, /document\.body\.dataset\.desktopView = "editor"/)
  assert.match(application, /document\.body\.dataset\.desktopView = "library"/)
  assert.match(application, /editor\.loadDocument\(deck\.source\)[\s\S]*?editor\.setEditingMode\("visual", \{ restoreCaret: false \}\)/)
  const editorController = await read("app/javascript/controllers/editor_controller.js")
  assert.match(editorController, /this\.form\?\.dispatchEvent\(new CustomEvent\("elef:editor-mode-change"/)
  assert.match(application, /theme: "dark"/)
  assert.match(application, /void openDeck\(target\.workId\)/)
  assert.match(application, /presentWork: work => \{[\s\S]*?startPresentation\(\)/)
  assert.match(application, /configureEditorKind\(elements\.editorField\.closest\("\.editor-shell"\), isDocument \? "document" : "presentation"/)
  assert.doesNotMatch(application, /elements\.editorInput\.name = isDocument/)
  assert.match(editorView, /export function configureEditorKind\(root, kind/)
  assert.match(editorView, /visualButton\.disabled = Boolean\(config\.visualDisabled\)/)
})

test("the editor discloses the remaining external-write race", () => {
  assert.match(document.querySelector(".desktop-save-note").textContent, /simultaneous write in the final atomic replacement window can still be overwritten/i)
  assert.match(document.querySelector(".desktop-save-note").textContent, /sync tool/i)
})

test("the host uses no inline event handlers under the strict script policy", () => {
  assert.equal(document.querySelector("[onclick], [onerror], [onload]"), null)
})

test("the editor host uses the shared editor markup rather than a second copy", () => {
  assert.equal(document.querySelector("#desktop-editor-form .editor-toolbar"), null)
  assert.equal(document.querySelector("#desktop-editor-form .slide-overview"), null)
  assert.equal(document.querySelector("#conflict-dialog"), null)
  assert.match(editorView, /<dialog id="conflict-dialog" class="conflict-dialog"/)
  assert.match(applicationStyles, /\.conflict-dialog\s*\{/)
  assert.doesNotMatch(shellStyles, /\.conflict-dialog\s*\{/)
  assert.match(editorView, /appearance-settings/)
  assert.match(editorView, /slide-overview/)
  assert.match(editorView, /input->snippet-palette#input/)
  assert.match(editorView, /input->document-link-palette#input/)
})

test("the file-backed host mounts the shared library view and graph", () => {
  assert.ok(document.querySelector("#library-view-mount"))
  assert.match(application, /shell = await mountElef\(mount, createLibraryHost\(\), \{/)
  assert.match(application, /onLibraryEvent: handleLibraryEvent/)
  assert.doesNotMatch(application, /renderLibraryView|setLibraryViewTab|renderDecks/)
  assert.match(clientLibrary, /show-deck-list/)
  assert.match(clientLibrary, /show-documents/)
  assert.match(clientLibrary, /show-presentations/)
  assert.match(clientLibrary, /data-library-tab=\{name\}/)
  assert.match(clientLibrary, /id="document-graph-view"/)
  assert.match(application, /mount\.querySelector\("#document-graph-view"\)/)
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

test("Markdown appearance persistence is shared and absent from desktop orchestration", () => {
  assert.match(appearanceController, /withAppearanceValue/)
  assert.doesNotMatch(application, /withAppearanceValue/)
  assert.doesNotMatch(application, /editorForm\.addEventListener\("change"/)
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

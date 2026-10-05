Warning: truncated output (original token count: 12142)
Total output lines: 1214

import { createDeckOpenFlow, prepareDeckOpen } from "lib/deck_open_flow"
import { completeBootstrap } from "./bootstrap-flow.js"
import { applyEditorSource } from "lib/editor_source"
import { measurePaintedAction } from "lib/performance_measurement"
import { createCloseFlow } from "./close-flow.js"
import { Channel, invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { relaunch } from "@tauri-apps/plugin-process"
import { check as checkUpdater } from "@tauri-apps/plugin-updater"
import { editorFor } from "lib/editor_controller_lookup"
import { createLibraryCard } from "lib/library_card"
import { createIncrementalList } from "lib/incremental_list"
import { createDocumentGraphCache } from "lib/document_graph_cache"
import { buildDocumentGraph } from "lib/document_links"
import { createTransportAdapter } from "./transport-adapter.js"
import { waitForEditorController } from "lib/editor_ready"
import { createSaveFlow } from "lib/save_flow"
import { createTitleSaveFlow } from "lib/title_save_flow"
import { createMediaFetch } from "./media-transport.js"
import { createPreviewFetch } from "./preview-transport.js"
import { createRendererClient } from "lib/renderer_worker_client"
import { installSanitizedPreview } from "lib/preview_sanitizer"
import { checkForDesktopUpdate, createIdleUpdateCheck, installDesktopUpdate } from "./update-flow.js"
import { desktopAuthoringRegistry, loadDesktopAuthoringRegistry } from "./authoring-registry-loader.js"
import { createAuthoringSettingsDialog } from "lib/authoring_settings_dialog"
import { withAppearanceValue } from "lib/document_map"
import { applyDesktopFeatureFlags } from "lib/feature_flags"
import { configureEditorKind, renderEditorView } from "lib/editor_view"
import { renderLibraryView, setLibraryViewTab, updateLibraryEmptyState } from "lib/library_view"
import { filterDecks } from "lib/library_filter"
import { createLibraryPreviewLoader } from "lib/library_preview"
import { loadDesktopEditorRuntime, loadDesktopLibraryRuntime } from "./editor-runtime.js"
import "../../../app/assets/stylesheets/application.css"
import "./desktop-rendered-content.css"

applyDesktopFeatureFlags(document)

const networkFetch = globalThis.fetch.bind(globalThis)
const renderer = createRendererClient()
const mediaFetch = createMediaFetch({ invoke, fetchImpl: networkFetch })
globalThis.fetch = createPreviewFetch({
  renderer,
  fetchImpl: mediaFetch,
  onEvent: __ELEF_E2E__ ? event => {
    const trace = globalThis.__elefPreviewTrace ||= []
    trace.push(event)
    if (trace.length > 512) trace.shift()
  } : undefined,
  getContext: async source => ({
    kind: activeDeck?.source_file === "document.md" ? "document" : "presentation",
    title: document.querySelector("#desktop-editor-title")?.value.trim() || activeDeck?.name || "Untitled",
    deckId: activeDeck?.id || "",
    mediaBaseUrl: activeDeck ? `elefasset://localhost/${encodeURIComponent(activeDeck.id)}` : "",
    documentNodes: await previewDocumentNodes(source)
  })
})
globalThis.elefInstallDesktopPreview = installSanitizedPreview

renderEditorView(document.querySelector("#desktop-editor-mount"), {
  kind: "presentation",
  source: "",
  sourceName: "presentation[source]",
  mode: "source",
  visualDisabled: true,
  visualDisabledMessage: "Open a deck to render its preview",
  showTitle: true,
  showSubmit: false,
  persisted: false,
  authoringRegistry: desktopAuthoringRegistry(),
  documentTitles: [],
  ids: {
    field: "desktop-editor-field",
    source: "deck-source",
    surface: "deck-source-editor",
    label: "deck-source-label",
    title: "desktop-editor-title",
    visualMode: "visual-mode",
    sourceMode: "source-mode",
    theme: "deck-theme",
    typography: "deck-typography",
    preview: "desktop-preview"
  }
})
const editorFieldHost = document.querySelector("#desktop-editor-field")
const editorFormHost = document.querySelector("#desktop-editor-form")
editorFieldHost.removeAttribute("data-controller")
editorFormHost.removeAttribute("data-controller")
editorFormHost.dataset.presentationActiveValue = "false"

renderLibraryView(document.querySelector("#library-view-mount"), {
  filter: "all",
  countLabel: "0 works",
  description: "One home for your documents, presentations, and source."
})

const elements = {
  libraryName: document.querySelector("#library-name"),
  welcome: document.querySelector("#welcome-view"),
  library: document.querySelector("#library-view"),
  deckView: document.querySelector("#deck-view"),
  deckTitle: document.querySelector("#deck-title"),
  list: document.querySelector("#deck-list"),
  loadMore: document.querySelector("#library-load-more"),
  graphView: document.querySelector("#document-graph-view"),
  count: document.querySelector("#library-count"),
  empty: document.querySelector("#empty-library"),
  noResults: document.querySelector("#library-no-results"),
  search: document.querySelector("#library-search"),
  status: document.querySelector("#status-text"),
  notice: document.querySelector("#notice"),
  createDialog: document.querySelector("#create-dialog"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  libraryTheme: document.querySelector("#library-theme"),
  authoringDialog: document.querySelector("#authoring-settings-dialog"),
  authoringTitle: document.querySelector("#authoring-settings-title"),
  authoringTabs: document.querySelectorAll("[data-authoring-tab]"),
  authoringStatus: document.querySelector("#authoring-settings-status"),
  authoringCount: document.querySelector("#authoring-settings-count"),
  authoringList: document.querySelector("#authoring-settings-list"),
  authoringEmpty: document.querySelector("#authoring-settings-empty"),
  authoringNew: document.querySelector("#new-authoring-entry"),
  authoringForm: document.querySelector("#authoring-entry-form"),
  authoringFormHeading: document.querySelector("#authoring-entry-heading"),
  authoringSnippetFields: document.querySelector(".authoring-snippet-fields"),
  authoringMathFields: document.querySelector(".authoring-math-fields"),
  authoringSave: document.querySelector("#save-authoring-entry"),
  deleteAuthoringDialog: document.querySelector("#delete-authoring-dialog"),
  deleteAuthoringMessage: document.querySelector("#delete-authoring-message"),
  confirmAuthoringDelete: document.querySelector("#confirm-authoring-delete"),
  cancelAuthoringDelete: document.querySelector("#cancel-authoring-delete"),
  createForm: document.querySelector("#create-form"),
  aboutDialog: document.querySelector("#about-dialog"),
  conflictDialog: document.querySelector("#conflict-dialog"),
  editorField: document.querySelector("#desktop-editor-field"),
  editorForm: document.querySelector("#desktop-editor-form"),
  editorInput: document.querySelector("#deck-source"),
  titleInput: document.querySelector("#desktop-editor-title"),
  saveState: document.querySelector("#save-state"),
  conflictLocal: document.querySelector("#conflict-local"),
  conflictDisk: document.querySelector("#conflict-disk"),
  conflictSourceName: document.querySelector("#conflict-source-name"),
  conflictMerge: document.querySelector("#conflict-merge"),
  retrySave: document.querySelector("#retry-save"),
  restoreDraft: document.querySelector("#restore-local-draft"),
  importConflictDialog: document.querySelector("#import-conflict-dialog"),
  importConflictMessage: document.querySelector("#import-conflict-message"),
  updateDialog: document.querySelector("#update-dialog"),
  updateVersion: document.querySelector("#update-version"),
  updateNotes: document.querySelector("#update-notes"),
  updateProgress: document.querySelector("#update-progress"),
  presentationExit: document.querySelector("#exit-presentation")
}

let library = null
let libraryConfig = { schema_version: 1, theme: "system", hotkeys: {} }
let decks = []
let activeDeck = null
let saveFlow = null
const documentGraphCache = createDocumentGraphCache(async () => buildDocumentGraph(await invoke("document_graph")))
let libraryTab = "all"
let cardPreviewObserver = null
let libraryMoreObserver = null
const libraryListRenderer = createIncrementalList(elements.list)
let pendingUpdate = null
let updateInstalling = false
let libraryStatusLoaded = false
let processingOpenedFiles = false
let openFilesRequested = false
let openFilesWaitingForSave = false
let sourcePollBusy = false
let lastSourcePollError = null
let titleFlow = null
const startupUpdateCheck = createIdleUpdateCheck(
  () => checkForUpdates(false),
  () => !elements.deckView.hidden
)

const authoringSettings = createAuthoringSettingsDialog({
  elements: {
    dialog: elements.authoringDialog,
    title: elements.authoringTitle,
    tabs: elements.authoringTabs,
    status: elements.authoringStatus,
    count: elements.authoringCount,
    list: elements.authoringList,
    empty: elements.authoringEmpty,
    newButton: elements.authoringNew,
    form: elements.authoringForm,
    formHeading: elements.authoringFormHeading,
    snippetFields: elements.authoringSnippetFields,
    mathFields: elements.authoringMathFields,
    saveButton: elements.authoringSave,
    deleteDialog: elements.deleteAuthoringDialog,
    deleteMessage: elements.deleteAuthoringMessage,
    confirmDelete: elements.confirmAuthoringDelete,
    cancelDelete: elements.cancelAuthoringDelete,
    cancelEntryButton: document.querySelector("#cancel-authoring-entry"),
    closeButton: document.querySelector("#close-authoring-settings")
  },
  readRegistries: async () => {
    const result = await invoke("read_authoring_registries")
    return {
      snippets: result.snippets,
      math_shortcuts: result.math_shortcuts,
      hashes: result.hashes
    }
  },
  writeRegistry: async payload => {
    const result = await invoke("write_authoring_registry", payload)
    return { contentHash: result.content_hash }
  },
  reloadEditorReg…7142 tokens truncated…transition.
    presentation.stageTarget?.focus({ preventScroll: true })
  }
}

function presentationKeydown(event) {
  if (!document.body.classList.contains("presenting-deck")) return
  if (event.key !== "Escape") return
  event.preventDefault()
  void exitPresentation()
}

async function exitPresentation() {
  if (!document.body.classList.contains("presenting-deck")) return
  document.body.classList.remove("presenting-deck")
  elements.presentationExit.hidden = true
  document.removeEventListener("keydown", presentationKeydown, true)
  window.Stimulus?.getControllerForElementAndIdentifier(elements.editorForm, "presentation")?.stop()
  try {
    await getCurrentWindow().setFullscreen(false)
  } catch (_error) {}
}

if (__ELEF_E2E__) {
  globalThis.__elefPresentationTestHooks = { start: startPresentation }
}

async function resolveConflictWithDisk() {
  if (!await saveFlow.useDiskVersion()) return
  syncSourceLabel()
  elements.conflictDialog.close()
}

function resolveConflictWithLocal() {
  if (!saveFlow.keepLocalVersion()) return
  syncSourceLabel()
  elements.conflictDialog.close()
}

async function resolveConflictWithMerge() {
  const mergedSource = elements.conflictMerge.value
  if (!await saveFlow.saveMergedVersion(mergedSource)) return
  syncSourceLabel()
  elements.conflictDialog.close()
}

function syncSourceLabel() {
  if (!activeDeck) return
  document.querySelector("#deck-source-name").textContent = activeDeck.source_file
  document.querySelector("#deck-kind").textContent = activeDeck.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION"
}

async function handleMenuAction(action) {
  if (action === "quit") return getCurrentWindow().close()
  if (action === "choose-library") return chooseLibrary()
  if (action === "refresh-library") return refreshLibrary()
  if (action === "open-deck") {
    if (!library) return chooseLibrary()
    if (hasUnsavedChanges() && !(await flushSave())) return
    showLibrary()
    elements.search.focus()
    return
  }
  if (action === "new-presentation") return showCreateDialog("presentation")
  if (action === "new-document") return showCreateDialog("document")
  if (action === "save") return flushSave({ force: true })
  if (action === "export-elef") return exportCurrentDeck()
  if (action === "import-elef") return importDeck()
  if (action === "settings") return showSettings()
  if (action === "check-for-updates") return checkForUpdates(true)
  if (action === "about") return elements.aboutDialog.showModal()
  if (action === "start-presentation") return startPresentation()
  if (action === "print") return printCurrentDeck()
}

document.querySelector("#choose-library").addEventListener("click", () => void chooseLibrary())
document.querySelector("#change-library").addEventListener("click", () => void chooseLibrary())
document.querySelector("#new-deck").addEventListener("click", () => {
  showCreateDialog(libraryTab === "documents" ? "document" : "presentation")
})
document.querySelector("#refresh-library").addEventListener("click", () => void refreshLibrary())
elements.loadMore.addEventListener("click", appendLibraryDeckBatch)
document.querySelector("#import-elef").addEventListener("click", () => void importDeck())
document.querySelector("#back-to-library").addEventListener("click", () => {
  if (hasUnsavedChanges()) {
    void flushSave().then(saved => {
      if (!saved) return
      showLibrary()
      setStatus("Library")
    })
    return
  }
  showLibrary()
  setStatus("Library")
})
document.querySelector("#create-form").addEventListener("submit", event => {
  if (event.submitter?.value === "create") void createDeck(event)
})
elements.settingsForm.addEventListener("submit", event => void saveSettings(event))
document.querySelector("#manage-authoring").addEventListener("click", () => {
  elements.settingsDialog.close()
  void authoringSettings.open()
})
document.querySelector("#check-for-updates").addEventListener("click", () => void checkForUpdates(true))
document.querySelector("#install-update").addEventListener("click", () => void installUpdate())
elements.presentationExit.addEventListener("click", () => void exitPresentation())
document.querySelector("#update-later").addEventListener("click", () => elements.updateDialog.close())
elements.updateDialog.addEventListener("cancel", event => {
  if (updateInstalling) event.preventDefault()
})
elements.updateDialog.addEventListener("close", () => {
  const update = pendingUpdate
  pendingUpdate = null
  void update?.dispose().catch(() => {})
})
document.querySelector("#import-conflict-replace").addEventListener("click", () => void resolveImportConflict("replace"))
document.querySelector("#import-conflict-keep-both").addEventListener("click", () => void resolveImportConflict("keep_both"))
document.querySelector("#import-conflict-cancel").addEventListener("click", () => void resolveImportConflict("cancel"))
document.querySelector("#library-search").addEventListener("input", renderDecks)
document.querySelectorAll("[data-library-tab]").forEach(link => {
  link.addEventListener("click", event => {
    event.preventDefault()
    showLibraryTab(link.dataset.libraryTab)
  })
})
document.querySelector("#empty-library [data-action='create-presentation']").addEventListener("click", event => {
  showCreateDialog(event.currentTarget.dataset.kind || "presentation")
})
elements.editorField.addEventListener("input", () => scheduleSave())
elements.titleInput.addEventListener("input", () => titleFlow.noteChange())
elements.editorForm.addEventListener("change", event => {
  const key = event.target.id === "deck-theme" ? "theme" : event.target.id === "deck-typography" ? "typography" : null
  if (!key || !activeDeck) return
  try {
    const editor = editorFor(elements.editorField)
    if (!editor) throw Object.assign(new Error("The editor is still loading."), { code: "editor_unavailable" })
    let source = currentSource()
    for (const styleKey of ["theme", "typography"]) {
      source = withAppearanceValue(source, styleKey, elements.editorForm.querySelector(`#deck-${styleKey}`).value)
    }
    editor.setExternalValue(source)
    scheduleSave()
    void elements.editorForm.previewController?.refresh()
  } catch (error) {
    showError(error)
  }
})
document.querySelector("#use-disk-version").addEventListener("click", resolveConflictWithDisk)
document.querySelector("#keep-local-version").addEventListener("click", resolveConflictWithLocal)
document.querySelector("#save-merged-version").addEventListener("click", resolveConflictWithMerge)
elements.restoreDraft.addEventListener("click", () => {
  void saveFlow.restoreDraft()
})
elements.retrySave.addEventListener("click", () => void flushSave({ force: true }))
window.addEventListener("beforeunload", event => {
  if (!hasUnsavedChanges()) return
  event.preventDefault()
  event.returnValue = ""
})
void getCurrentWindow().onCloseRequested(createCloseFlow({
  isDirty: () => hasUnsavedChanges(),
  flushSave,
  close: () => getCurrentWindow().close(),
  onError: showError
}))

window.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault()
    elements.search.focus()
  }
})

window.setInterval(async () => {
  if (!activeDeck || sourcePollBusy || document.hidden) return
  sourcePollBusy = true
  const id = activeDeck.id
  try {
    const snapshot = await transport.readSourceSnapshot(id)
    lastSourcePollError = null
    if (activeDeck?.id === id) {
      if (activeDeck.source_file === "document.md" &&
          (snapshot.content_hash !== activeDeck.content_hash || snapshot.source_file !== activeDeck.source_file)) {
        documentGraphCache.invalidate()
      }
      const result = await saveFlow.checkExternalChange(id, snapshot)
      if (result === "reloaded" || result === "source-file-changed") syncSourceLabel()
    }
  } catch (error) {
    const key = error?.code || "unknown"
    if (key !== lastSourcePollError) showError(error)
    lastSourcePollError = key
  } finally {
    sourcePollBusy = false
  }
}, 2_000)

void listen("desktop-menu-action", event => void handleMenuAction(event.payload))
const openedFileListener = listen("desktop-open-elef", () => void processOpenedFiles())
void completeBootstrap({
  initialize: async () => {
    const [status] = await measureBootstrapStage("library-status", () => Promise.all([invoke("get_library_status"), openedFileListener]))
    library = status
    libraryConfig = status?.config || libraryConfig
    decks = status?.decks || []
    applyTheme(libraryConfig.theme)
    measureBootstrapStage("initial-library-render", showLibrary)
    if (status?.config_notice) showNotice(status.config_notice, "error")
    setStatus(library ? `${decks.length} ${decks.length === 1 ? "deck" : "decks"}` : "Choose a library folder to begin")
    libraryStatusLoaded = true
  },
  waitForPaint: () => measureBootstrapStage("initial-paint", () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
  markInteractive: () => {
    if (__ELEF_E2E__) window.__elefPerformanceTestHooks.interactive()
  },
  waitForEditor: async () => {
    await measureBootstrapStage("editor-runtime", () => loadDesktopEditorRuntime())
    if (!elements.editorField.dataset.controller) configureEditorKind(false, [])
    if (!elements.editorForm.dataset.controller) {
      elements.editorForm.dataset.controller = "preview visual-editor presentation-editor slide-overview media presentation"
    }
    await measureBootstrapStage("editor-ready", () => waitForEditorController(elements.editorField, editorFor))
  },
  confirmReady: async () => {
    await measureBootstrapStage("native-ready-ack", () => invoke("confirm_app_ready"))
    if (__ELEF_E2E__) window.__elefPerformanceTestHooks.ready()
    void invoke("pending_open_elef_count")
      .then(count => { if (count) void processOpenedFiles() })
      .catch(showError)
    startupUpdateCheck.schedule(10_000)
  }
}).catch(showError)

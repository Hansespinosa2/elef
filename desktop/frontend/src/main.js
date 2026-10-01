import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { relaunch } from "@tauri-apps/plugin-process"
import { check as checkUpdater } from "@tauri-apps/plugin-updater"
import { editorFor } from "controllers/editor_controller"
import { createDeckCard } from "./deck-card.js"
import { createTransportAdapter } from "./transport-adapter.js"
import { waitForEditorController } from "./editor-ready.js"
import { createSaveFlow } from "./save-flow.js"
import { createMediaFetch } from "./media-transport.js"
import { createPreviewFetch } from "./preview-transport.js"
import { createRendererClient } from "./renderer-client.js"
import { installSanitizedPreview } from "./preview-sanitizer.js"
import { checkForDesktopUpdate, installDesktopUpdate } from "./update-flow.js"
import { loadDesktopAuthoringRegistry } from "./authoring-registry-loader.js"
import { createPresentationNavigation } from "./presentation-flow.js"
import "./editor-runtime.js"
import "./editor.css"
import "./rendered-content.css"

const networkFetch = globalThis.fetch.bind(globalThis)
const renderer = createRendererClient()
const mediaFetch = createMediaFetch({ invoke, fetchImpl: networkFetch })
globalThis.fetch = createPreviewFetch({
  renderer,
  fetchImpl: mediaFetch,
  getContext: () => ({
    kind: activeDeck?.source_file === "document.md" ? "document" : "presentation",
    title: activeDeck?.name || "Untitled",
    deckId: activeDeck?.id || "",
    mediaBaseUrl: activeDeck ? `elefasset://localhost/${encodeURIComponent(activeDeck.id)}` : "",
    documentNodes: documentGraphCache?.nodes || []
  })
})
globalThis.elefInstallDesktopPreview = installSanitizedPreview

const elements = {
  libraryName: document.querySelector("#library-name"),
  welcome: document.querySelector("#welcome-view"),
  library: document.querySelector("#library-view"),
  deckView: document.querySelector("#deck-view"),
  list: document.querySelector("#deck-list"),
  deckBrowser: document.querySelector("#deck-browser-view"),
  graphView: document.querySelector("#document-graph-view"),
  count: document.querySelector("#deck-count"),
  empty: document.querySelector("#empty-library"),
  search: document.querySelector("#deck-search"),
  status: document.querySelector("#status-text"),
  notice: document.querySelector("#notice"),
  createDialog: document.querySelector("#create-dialog"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  libraryTheme: document.querySelector("#library-theme"),
  createForm: document.querySelector("#create-form"),
  aboutDialog: document.querySelector("#about-dialog"),
  conflictDialog: document.querySelector("#conflict-dialog"),
  editorField: document.querySelector("#desktop-editor-field"),
  editorForm: document.querySelector("#desktop-editor-form"),
  editorInput: document.querySelector("#deck-source"),
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
let documentGraphCache = null
let libraryTab = "decks"
let documentGraphRequest = null
let pendingUpdate = null
let libraryStatusLoaded = false
let processingOpenedFiles = false
let openFilesRequested = false
let openFilesWaitingForSave = false
let sourcePollBusy = false
let lastSourcePollError = null
let presentationFrames = []
let presentationNavigation = null

const transport = createTransportAdapter({ invoke, onConflict: event => saveFlow?.handleConflict(event) })
saveFlow = createSaveFlow({
  saveSource: async (id, source) => {
    const result = await transport.saveSource(id, source)
    documentGraphCache = null
    return result
  },
  acceptDiskVersion: (id, contentHash) => transport.acceptDiskVersion(id, contentHash),
  getSource: currentSource,
  setSource: setEditorSource,
  onState: (state, details) => {
    setSaveState(state)
    elements.restoreDraft.hidden = !details.discardedDrafts
    elements.retrySave.hidden = !details.blocked
    if (!details.dirty && openFilesWaitingForSave) {
      openFilesWaitingForSave = false
      queueMicrotask(() => void processOpenedFiles())
    }
  },
  onConflict: showConflict,
  onError: showError
})

function setStatus(message) {
  elements.status.textContent = message
}

function showNotice(message, tone = "info") {
  elements.notice.textContent = message
  elements.notice.dataset.tone = tone
  elements.notice.hidden = false
}

function clearNotice() {
  elements.notice.hidden = true
  elements.notice.textContent = ""
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = ["system", "light", "dark"].includes(theme) ? theme : "system"
}

function showError(error) {
  const message = typeof error?.message === "string" ? error.message : "The operation could not be completed."
  setStatus(message)
  showNotice(message, "error")
}

function showLibrary() {
  elements.welcome.hidden = Boolean(library)
  elements.library.hidden = !library
  elements.deckView.hidden = true
  elements.libraryName.textContent = library ? library.root.split(/[\\/]/).filter(Boolean).at(-1) || library.root : "No library selected"
  document.querySelector("#new-deck").disabled = !library
  document.querySelector("#import-elef").disabled = !library
  document.querySelector("#breadcrumb-current").textContent = "Decks"
  showLibraryTab("decks")
}

function showLibraryTab(tab) {
  libraryTab = tab === "graph" ? "graph" : "decks"
  const graphSelected = tab === "graph"
  elements.deckBrowser.hidden = graphSelected
  elements.graphView.hidden = !graphSelected
  document.querySelector("#show-deck-list").classList.toggle("is-active", !graphSelected)
  document.querySelector("#show-deck-list").setAttribute("aria-pressed", String(!graphSelected))
  document.querySelector("#show-document-graph").classList.toggle("is-active", graphSelected)
  document.querySelector("#show-document-graph").setAttribute("aria-pressed", String(graphSelected))
}

async function documentGraphData() {
  if (documentGraphCache) return documentGraphCache
  if (documentGraphRequest) return documentGraphRequest
  documentGraphRequest = invoke("document_graph").then(graph => {
    documentGraphCache = graph
    return graph
  }).finally(() => {
    documentGraphRequest = null
  })
  return documentGraphRequest
}

async function showDocumentGraph() {
  if (!library) return
  try {
    const graph = await documentGraphData()
    const previous = elements.graphView
    const graphView = previous.cloneNode(true)
    graphView.hidden = false
    graphView.dataset.documentGraphDataValue = JSON.stringify(graph)
    graphView.setAttribute("data-controller", "document-graph")
    const mount = graphView.querySelector("#document-graph-mount")
    mount.replaceChildren()

    const canvas = document.createElement("div")
    canvas.className = "document-graph-canvas"
    canvas.dataset.documentGraphTarget = "canvas"
    canvas.tabIndex = 0
    canvas.setAttribute("aria-label", "Document network graph")
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 1000 620")
    svg.setAttribute("role", "img")
    svg.setAttribute("aria-labelledby", "document-graph-heading")
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs")
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker")
    marker.id = "document-graph-arrow"
    marker.setAttribute("markerWidth", "10")
    marker.setAttribute("markerHeight", "10")
    marker.setAttribute("refX", "9")
    marker.setAttribute("refY", "5")
    marker.setAttribute("orient", "auto")
    marker.setAttribute("markerUnits", "strokeWidth")
    marker.setAttribute("viewBox", "0 0 10 10")
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path")
    arrow.setAttribute("d", "M0,0 L10,5 L0,10 Z")
    marker.append(arrow)
    defs.append(marker)
    svg.append(defs)

    const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g")
    viewport.dataset.documentGraphTarget = "viewport"
    const edgesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g")
    edgesGroup.classList.add("document-graph-edges")
    edgesGroup.dataset.documentGraphTarget = "edges"
    for (const edge of graph.edges) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
      line.classList.add("document-graph-edge")
      line.dataset.documentGraphTarget = "edge"
      line.dataset.sourceId = String(edge.source)
      line.dataset.targetId = String(edge.target)
      line.setAttribute("marker-end", "url(#document-graph-arrow)")
      edgesGroup.append(line)
    }
    const nodesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g")
    nodesGroup.classList.add("document-graph-nodes")
    nodesGroup.dataset.documentGraphTarget = "nodes"
    for (const node of graph.nodes) {
      const link = document.createElementNS("http://www.w3.org/2000/svg", "a")
      link.setAttribute("href", `#deck/${encodeURIComponent(node.id)}`)
      link.classList.add("document-graph-node")
      link.dataset.documentGraphTarget = "node"
      link.dataset.nodeId = String(node.id)
      link.dataset.title = node.title
      link.dataset.deckId = String(node.id)
      link.setAttribute("aria-label", `Open ${node.title}`)
      const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "rect")
      hitArea.classList.add("document-graph-node-hit-area")
      hitArea.setAttribute("fill", "transparent")
      hitArea.setAttribute("pointer-events", "all")
      hitArea.setAttribute("aria-hidden", "true")
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
      circle.setAttribute("r", "14")
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text")
      label.setAttribute("x", "22")
      label.setAttribute("y", "5")
      label.textContent = node.title
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title")
      title.textContent = node.title
      link.append(hitArea, circle, label, title)
      nodesGroup.append(link)
    }
    viewport.append(edgesGroup, nodesGroup)
    svg.append(viewport)
    canvas.append(svg)
    mount.append(canvas)
    if (!graph.nodes.length) {
      const empty = document.createElement("p")
      empty.className = "document-graph-empty"
      empty.textContent = "Create a document to start your network."
      mount.append(empty)
    }
    graphView.querySelector("[data-document-graph-target='status']").textContent = `${graph.nodes.length} documents`
    graphView.addEventListener("click", event => {
      const link = event.target.closest?.("[data-deck-id]")
      if (!link) return
      event.preventDefault()
      void openDeck(link.dataset.deckId)
    })
    previous.replaceWith(graphView)
    elements.graphView = graphView
    showLibraryTab("graph")
  } catch (error) {
    showError(error)
  }
}

function renderDecks() {
  const query = elements.search.value.trim().toLocaleLowerCase()
  const filtered = decks.filter(deck => deck.name.toLocaleLowerCase().includes(query))
  elements.list.replaceChildren(...filtered.map(deck => createDeckCard(document, deck, {
    open: id => void openDeck(id),
    rename: item => void renameDeck(item),
    delete: item => void deleteDeck(item)
  })))
  elements.count.textContent = `${decks.length} ${decks.length === 1 ? "deck" : "decks"}${query ? ` · ${filtered.length} shown` : ""}`
  elements.empty.hidden = decks.length !== 0
  elements.list.hidden = filtered.length === 0
  if (decks.length && filtered.length === 0) {
    const noResults = document.createElement("p")
    noResults.className = "no-results"
    noResults.textContent = "No decks match this search."
    elements.list.append(noResults)
    elements.list.hidden = false
  }
}

async function refreshLibrary() {
  if (!library) return
  try {
    decks = await invoke("list_decks")
    documentGraphCache = null
    renderDecks()
    if (libraryTab === "graph") await showDocumentGraph()
    setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`)
    clearNotice()
  } catch (error) {
    showError(error)
  }
}

async function chooseLibrary() {
  if (saveFlow.dirty && !(await flushSave())) return
  clearNotice()
  setStatus("Choose a folder for your library…")
  try {
    const selected = await invoke("choose_library_root")
    if (!selected) {
      setStatus("Library selection cancelled")
      return
    }
    library = selected
    await loadDesktopAuthoringRegistry()
    documentGraphCache = null
    libraryConfig = selected.config || libraryConfig
    decks = selected.decks
    applyTheme(libraryConfig.theme)
    showLibrary()
    renderDecks()
    if (selected.config_notice) showNotice(selected.config_notice, "error")
    setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`)
    if (await invoke("pending_open_elef_count")) void processOpenedFiles()
  } catch (error) {
    showError(error)
  }
}

function showCreateDialog(kind = "presentation") {
  document.querySelector("#new-deck-kind").value = kind
  elements.createDialog.showModal()
  document.querySelector("#new-deck-name").focus()
}

async function createDeck(event) {
  event.preventDefault()
  const form = new FormData(elements.createForm)
  const name = String(form.get("name") || "").trim()
  const kind = String(form.get("kind") || "presentation")
  if (!name) return
  elements.createDialog.close()
  try {
    const opened = await invoke("create_deck", { name, kind })
    await refreshLibrary()
    await openDeck(opened.id)
  } catch (error) {
    showError(error)
  }
}

async function openDeck(id) {
  try {
    if (document.body.classList.contains("presenting-deck")) await exitPresentation()
    if (activeDeck && activeDeck.id !== id && saveFlow.dirty && !(await flushSave())) return
    const deck = await transport.openDeck(id)
    activeDeck = deck
    saveFlow.activate(deck)
    document.querySelector("#deck-title").textContent = deck.name
    document.querySelector("#deck-kind").textContent = deck.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION"
    document.querySelector("#deck-source-name").textContent = deck.source_file
    elements.editorField.dataset.editorInitialSourceValue = JSON.stringify(deck.source)
    elements.editorForm.dataset.previewUrlValue = `elef-preview://localhost/${encodeURIComponent(deck.id)}`
    elements.editorForm.dataset.mediaEnabledValue = "true"
    elements.editorForm.dataset.mediaWorkKindValue = deck.source_file === "document.md" ? "document" : "presentation"
    elements.editorForm.dataset.mediaUploadUrlValue = `elef-upload://localhost/${encodeURIComponent(deck.id)}`
    elements.editorForm.dataset.mediaAssetBaseUrlValue = `elefasset://localhost/${encodeURIComponent(deck.id)}`
    if (deck.source_file === "document.md") {
      try {
        const graph = await documentGraphData()
        elements.editorField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(graph.nodes.map(node => node.title))
      } catch (_error) {
        elements.editorField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(decks.filter(item => item.kind === "document").map(item => item.name))
      }
    } else {
      elements.editorField.dataset.documentLinkPaletteTitlesValue = "[]"
    }
    await setEditorSource(deck.source)
    const isDocument = deck.source_file === "document.md"
    elements.editorForm.querySelector(".slide-overview").hidden = isDocument
    const visualButton = document.querySelector("#visual-mode")
    visualButton.disabled = true
    visualButton.title = "Rendering preview…"
    elements.editorInput.disabled = false
    setSaveState("Saved")
    document.querySelector("#deck-id").textContent = deck.id
    const notice = document.querySelector("#deck-notice")
    notice.textContent = deck.notices.join(" ")
    notice.hidden = deck.notices.length === 0
    elements.library.hidden = true
    elements.deckView.hidden = false
    document.querySelector("#breadcrumb-current").textContent = deck.name
    setStatus("Deck opened")
    const rendered = await elements.editorForm.previewController?.refresh()
    if (rendered) {
      visualButton.disabled = false
      visualButton.title = "Edit the rendered deck visually"
    }
  } catch (error) {
    showError(error)
  }
}

async function renameDeck(deck) {
  const name = window.prompt("Rename deck", deck.name)
  if (name === null || name.trim() === deck.name) return
  try {
    await invoke("rename_deck", { id: deck.id, name: name.trim() })
    await refreshLibrary()
  } catch (error) {
    showError(error)
  }
}

async function deleteDeck(deck) {
  try {
    const result = await invoke("delete_deck", { id: deck.id })
    if (result.deleted) {
      if (activeDeck?.id === deck.id) {
        activeDeck = null
        saveFlow.deactivate()
      }
      await refreshLibrary()
      setStatus(`Moved “${deck.name}” to Trash`)
    }
  } catch (error) {
    showError(error)
  }
}

function showImportConflict(error) {
  const incoming = error.details?.incoming_name || "This deck"
  const existing = error.details?.existing_name || "an existing deck"
  elements.importConflictMessage.textContent = `“${incoming}” has the same identity as “${existing}”.`
  elements.importConflictDialog.showModal()
}

async function completeImport(imported) {
  if (imported.replaced && activeDeck?.id === imported.deck.id) {
    activeDeck = null
    saveFlow.deactivate()
    showLibrary()
  }
  await refreshLibrary()
  setStatus((imported.replaced ? "Replaced" : "Imported") + ` “${imported.deck.name}”`)
}

async function processOpenedFiles() {
  openFilesRequested = true
  if (!libraryStatusLoaded) return
  if (processingOpenedFiles) return
  processingOpenedFiles = true
  try {
    while (openFilesRequested) {
      openFilesRequested = false
      if (saveFlow.dirty && !(await flushSave())) {
        openFilesWaitingForSave = true
        break
      }
      while (true) {
        try {
          const imported = await invoke("import_opened_elef")
          if (!imported) break
          await completeImport(imported)
        } catch (error) {
          if (error?.code === "invalid_library") {
            await chooseLibrary()
            if (library) continue
          } else if (error?.code === "import_conflict") {
            showImportConflict(error)
          } else {
            showError(error)
          }
          break
        }
      }
    }
  } finally {
    processingOpenedFiles = false
    if (openFilesRequested) void processOpenedFiles()
  }
}

function setSaveState(state) {
  elements.saveState.textContent = state
  elements.saveState.dataset.state = state.toLowerCase().replaceAll(" ", "-")
}

function scheduleSave() {
  saveFlow.noteChange()
}

function flushSave(options) {
  return saveFlow.flush(options)
}

function showConflict(conflict) {
  elements.conflictLocal.textContent = conflict.localSource
  elements.conflictDisk.textContent = conflict.diskSource
  elements.conflictSourceName.textContent = conflict.diskSourceFile
  elements.conflictMerge.value = currentSource()
  if (!elements.conflictDialog.open) elements.conflictDialog.showModal()
}

function currentSource() {
  return editorFor(elements.editorField)?.sourceValue ?? elements.editorInput.value
}

async function setEditorSource(source) {
  const controller = await waitForEditorController(elements.editorField, editorFor)
  if (controller) controller.setExternalValue(source)
  else elements.editorInput.value = source
}

async function showSettings() {
  try {
    libraryConfig = await invoke("read_library_config")
    elements.libraryTheme.value = libraryConfig.theme
    elements.settingsDialog.showModal()
  } catch (error) {
    showError(error)
  }
}

async function saveSettings(event) {
  if (event.submitter?.value !== "save") return
  event.preventDefault()
  const next = { ...libraryConfig, schema_version: 1, theme: elements.libraryTheme.value }
  try {
    await invoke("write_library_config", { config: next })
    libraryConfig = next
    applyTheme(next.theme)
    elements.settingsDialog.close()
    setStatus("Library settings saved")
  } catch (error) {
    showError(error)
  }
}

async function exportCurrentDeck() {
  if (!activeDeck) {
    showNotice("Open a deck before exporting it.")
    return
  }
  if (saveFlow.dirty && !(await flushSave({ force: true }))) return
  try {
    if (await invoke("export_elef", { id: activeDeck.id })) setStatus("Deck exported")
  } catch (error) {
    showError(error)
  }
}

async function importDeck() {
  if (!library) {
    showNotice("Choose a library before importing a deck.")
    return
  }
  if (saveFlow.dirty && !(await flushSave())) return
  try {
    const imported = await invoke("import_elef")
    if (!imported) return
    await completeImport(imported)
  } catch (error) {
    if (error?.code === "import_conflict") {
      showImportConflict(error)
      return
    }
    showError(error)
  }
}

async function resolveImportConflict(resolution) {
  elements.importConflictDialog.close()
  try {
    const imported = await invoke("resolve_import_conflict", { resolution })
    if (imported) await completeImport(imported)
    void processOpenedFiles()
  } catch (error) {
    showError(error)
  }
}

async function checkForUpdates(showNoUpdate = true) {
  try {
    const update = await checkForDesktopUpdate(checkUpdater)
    if (!update) {
      if (showNoUpdate) setStatus("Elef is up to date")
      return false
    }
    pendingUpdate = update
    elements.updateVersion.textContent = "Version " + update.version + " is ready to install."
    elements.updateNotes.textContent = update.notes
    elements.updateProgress.textContent = "The update signature will be verified before installation."
    elements.updateDialog.showModal()
    return true
  } catch (_error) {
    if (showNoUpdate) showError({ message: "Could not check for updates. Try again while online." })
    return false
  }
}

async function installUpdate() {
  if (!pendingUpdate) return
  const button = document.querySelector("#install-update")
  button.disabled = true
  try {
    await installDesktopUpdate(pendingUpdate, {
      relaunch,
      onProgress: event => {
        if (event.event === "Started" || event.event === "Progress") {
          elements.updateProgress.textContent = "Downloading update…"
        }
        if (event.event === "Finished") elements.updateProgress.textContent = "Installing update…"
      }
    })
  } catch (_error) {
    button.disabled = false
    showError({ message: "The update could not be installed. Your current version is still available." })
  }
}

async function printCurrentDeck() {
  if (!activeDeck) {
    showNotice("Open a deck before printing it.")
    return
  }
  if (saveFlow.dirty && !(await flushSave())) return
  const preview = document.querySelector("#desktop-preview")
  if (!preview.childElementCount && !(await elements.editorForm.previewController?.refresh())) {
    showNotice("Render the deck before printing it.", "error")
    return
  }
  document.body.classList.add("printing-deck")
  await new Promise(resolve => requestAnimationFrame(resolve))
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-deck")
  }, { once: true })
  window.print()
}

async function startPresentation() {
  if (!activeDeck || activeDeck.source_file === "document.md") {
    showNotice("Open a presentation deck to start presentation mode.")
    return
  }
  if (!(await elements.editorForm.previewController?.refresh())) {
    showNotice("Render the presentation before starting presentation mode.", "error")
    return
  }
  presentationFrames = [...document.querySelectorAll("#desktop-preview .slide-frame")]
  if (!presentationFrames.length) {
    showNotice("This presentation has no slides to show.", "error")
    return
  }
  presentationNavigation = createPresentationNavigation(presentationFrames.length)
  document.body.classList.add("presenting-deck")
  elements.presentationExit.hidden = false
  setPresentationSlide(presentationNavigation.currentIndex)
  document.addEventListener("keydown", presentationKeydown, true)
  try {
    await getCurrentWindow().setFullscreen(true)
  } catch (_error) {
    showNotice("Presentation mode is open. Use Esc to return to editing.")
  }
}

function setPresentationSlide(index) {
  if (!presentationNavigation) return
  const currentIndex = Math.max(0, Math.min(index, presentationFrames.length - 1))
  presentationFrames.forEach((frame, frameIndex) => {
    const active = frameIndex === currentIndex
    frame.classList.toggle("is-active-presentation-slide", active)
    frame.setAttribute("aria-hidden", String(!active))
  })
}

function presentationKeydown(event) {
  if (!document.body.classList.contains("presenting-deck")) return
  if (event.key === "Escape") {
    event.preventDefault()
    void exitPresentation()
  } else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
    event.preventDefault()
    setPresentationSlide(presentationNavigation.next())
  } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
    event.preventDefault()
    setPresentationSlide(presentationNavigation.previous())
  } else if (event.key === "Home") {
    event.preventDefault()
    setPresentationSlide(presentationNavigation.first())
  } else if (event.key === "End") {
    event.preventDefault()
    setPresentationSlide(presentationNavigation.last())
  }
}

async function exitPresentation() {
  if (!document.body.classList.contains("presenting-deck")) return
  document.body.classList.remove("presenting-deck")
  elements.presentationExit.hidden = true
  document.removeEventListener("keydown", presentationKeydown, true)
  for (const frame of presentationFrames) {
    frame.classList.remove("is-active-presentation-slide")
    frame.removeAttribute("aria-hidden")
  }
  presentationFrames = []
  presentationNavigation = null
  try {
    await getCurrentWindow().setFullscreen(false)
  } catch (_error) {}
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
  if (action === "choose-library") return chooseLibrary()
  if (action === "refresh-library") return refreshLibrary()
  if (action === "open-deck") {
    if (!library) return chooseLibrary()
    if (saveFlow.dirty && !(await flushSave())) return
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
document.querySelector("#new-deck").addEventListener("click", () => showCreateDialog())
document.querySelector("#refresh-library").addEventListener("click", () => void refreshLibrary())
document.querySelector("#import-elef").addEventListener("click", () => void importDeck())
document.querySelector("#back-to-library").addEventListener("click", () => {
  if (saveFlow.dirty) {
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
document.querySelector("#check-for-updates").addEventListener("click", () => void checkForUpdates(true))
document.querySelector("#install-update").addEventListener("click", () => void installUpdate())
elements.presentationExit.addEventListener("click", () => void exitPresentation())
document.querySelector("#update-later").addEventListener("click", () => elements.updateDialog.close())
document.querySelector("#import-conflict-replace").addEventListener("click", () => void resolveImportConflict("replace"))
document.querySelector("#import-conflict-keep-both").addEventListener("click", () => void resolveImportConflict("keep_both"))
document.querySelector("#import-conflict-cancel").addEventListener("click", () => void resolveImportConflict("cancel"))
document.querySelector("#deck-search").addEventListener("input", renderDecks)
document.querySelector("#show-deck-list").addEventListener("click", () => showLibraryTab("decks"))
document.querySelector("#show-document-graph").addEventListener("click", () => void showDocumentGraph())
document.querySelector("#empty-library [data-action='create-presentation']").addEventListener("click", () => showCreateDialog("presentation"))
elements.editorField.addEventListener("input", () => scheduleSave())
document.querySelector("#use-disk-version").addEventListener("click", resolveConflictWithDisk)
document.querySelector("#keep-local-version").addEventListener("click", resolveConflictWithLocal)
document.querySelector("#save-merged-version").addEventListener("click", resolveConflictWithMerge)
elements.restoreDraft.addEventListener("click", () => {
  void saveFlow.restoreDraft()
})
elements.retrySave.addEventListener("click", () => void flushSave({ force: true }))
window.addEventListener("beforeunload", event => {
  if (!saveFlow.dirty) return
  event.preventDefault()
  event.returnValue = ""
})
void getCurrentWindow().onCloseRequested(event => {
  if (!saveFlow.dirty) return
  event.preventDefault()
  void flushSave().then(saved => {
    if (saved) void getCurrentWindow().close()
  })
})
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
        documentGraphCache = null
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
void Promise.all([invoke("get_library_status"), openedFileListener]).then(async ([status]) => {
  library = status
  libraryConfig = status?.config || libraryConfig
  decks = status?.decks || []
  applyTheme(libraryConfig.theme)
  showLibrary()
  if (library) renderDecks()
  if (status?.config_notice) showNotice(status.config_notice, "error")
  setStatus(library ? `${decks.length} ${decks.length === 1 ? "deck" : "decks"}` : "Choose a library folder to begin")
  libraryStatusLoaded = true
  if (await invoke("pending_open_elef_count")) void processOpenedFiles()
}).catch(showError)
void checkForUpdates(false)

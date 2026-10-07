import { createDeckOpenFlow, prepareDeckOpen } from "lib/deck_open_flow"
import { applyEditorSource } from "lib/editor_source"
import { measurePaintedAction } from "lib/performance_measurement"
import { editorFor } from "lib/editor_controller_lookup"
import { createLibraryCard } from "lib/library_card"
import { createIncrementalList } from "lib/incremental_list"
import { createDocumentGraphCache } from "lib/document_graph_cache"
import { buildDocumentGraph } from "lib/document_links"
import { waitForEditorController } from "lib/editor_ready"
import { createSaveFlow } from "lib/save_flow"
import { createTitleSaveFlow } from "lib/title_save_flow"
import { presentConflictDialog } from "lib/conflict_dialog"
import { createRendererClient } from "lib/renderer_worker_client"
import { installSanitizedPreview } from "lib/preview_sanitizer"
import { authoringSettingsElements, createAuthoringSettingsDialog } from "lib/authoring_settings_dialog"
import { mergeAuthoringRegistryEntries } from "lib/authoring_registry_merge"
import { applyDesktopFeatureFlags } from "lib/feature_flags"
import { configureEditorKind, renderEditorView } from "lib/editor_view"
import { renderLibraryView, setLibraryViewTab, updateLibraryEmptyState } from "lib/library_view"
import { filterDecks } from "lib/library_filter"
import { createLibraryPreviewLoader } from "lib/library_preview"

export function startFileLibraryApplication(platform) {
  const {
    fileLibrary, listen, getCurrentWindow,
    completeBootstrap, createCloseFlow, createTransportAdapter, createMediaFetch,
    createPreviewFetch, checkForUpdate, createIdleUpdateCheck, installPendingUpdate,
    desktopAuthoringRegistry, loadDesktopAuthoringRegistry,
    loadEditorRuntime, loadLibraryRuntime
  } = platform

  applyDesktopFeatureFlags(document)

  const networkFetch = globalThis.fetch.bind(globalThis)
  const renderer = createRendererClient()
  const mediaFetch = createMediaFetch({ fetchImpl: networkFetch })
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

  renderEditorView(document.querySelector("#desktop-editor-mount"), {
    kind: "presentation",
    source: "",
    sourceName: "presentation[source]",
    mode: "visual",
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
      preview: "desktop-preview",
      saveState: "save-state",
      retrySave: "retry-save"
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
    createForm: document.querySelector("#create-form"),
    aboutDialog: document.querySelector("#about-dialog"),
    editorField: document.querySelector("#desktop-editor-field"),
    editorForm: document.querySelector("#desktop-editor-form"),
    editorInput: document.querySelector("#deck-source"),
    titleInput: document.querySelector("#desktop-editor-title"),
    saveState: document.querySelector("#save-state"),
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
  let libraryConfig = { schema_version: 1, theme: "dark", hotkeys: {} }
  let decks = []
  let activeDeck = null
  let saveFlow = null
  let e2eNextSaveDelayMs = 0
  const documentGraphCache = createDocumentGraphCache(async () => buildDocumentGraph(await fileLibrary.readDocumentGraph()))
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
    elements: authoringSettingsElements(document),
    readRegistries: async () => {
      const result = await fileLibrary.readAuthoringRegistries()
      const entries = mergeAuthoringRegistryEntries(
        desktopAuthoringRegistry().filter(entry => entry.built_in),
        result.snippets,
        result.math_shortcuts
      )
      return {
        snippets: entries.filter(entry => typeof entry.body === "string" && typeof entry.trigger === "string").map(entry => ({
          id: entry.id,
          name: entry.name,
          trigger: entry.trigger,
          description: entry.description,
          category: entry.category,
          body: entry.body,
          built_in: entry.built_in === true
        })),
        math_shortcuts: entries.filter(entry => typeof entry.expansion === "string" && Array.isArray(entry.aliases)).map(entry => ({
          id: entry.id,
          name: entry.name,
          aliases: entry.aliases,
          description: entry.description,
          prefix: entry.prefix,
          expansion: entry.expansion,
          built_in: entry.built_in === true
        })),
        hashes: result.hashes
      }
    },
    writeRegistry: async payload => {
      const result = await fileLibrary.writeAuthoringRegistry(payload)
      return { contentHash: result.content_hash }
    },
    reloadEditorRegistry: loadDesktopAuthoringRegistry,
    renderMarkdownBlock: source => renderer.renderMarkdownBlock(source),
    onSaved: setStatus
  })

  const transport = createTransportAdapter({ onConflict: event => saveFlow?.handleConflict(event) })
  const loadLibraryPreview = createLibraryPreviewLoader({
    readPreview: id => fileLibrary.readSourcePreview(id),
    render: input => renderer.render(input),
    install: installSanitizedPreview
  })
  saveFlow = createSaveFlow({
    saveSource: async (id, source) => {
      const isDocument = decks.find(deck => deck.id === id)?.source_file === "document.md"
      if (__ELEF_E2E__ && e2eNextSaveDelayMs > 0) {
        const delay = e2eNextSaveDelayMs
        e2eNextSaveDelayMs = 0
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      const result = await transport.saveSource(id, source)
      if (isDocument) documentGraphCache.invalidate()
      return result
    },
    acceptDiskVersion: (id, contentHash) => transport.acceptDiskVersion(id, contentHash),
    getSource: currentSource,
    setSource: setEditorSource,
    onState: (state, details) => {
      if (state !== "Saved" || !titleFlow?.isDirty()) setSaveState(state)
      elements.restoreDraft.hidden = !details.canRestoreDraft
      elements.retrySave.hidden = !details.blocked && !titleFlow?.isBlocked()
      if (!details.dirty && openFilesWaitingForSave) {
        openFilesWaitingForSave = false
        queueMicrotask(() => void processOpenedFiles())
      }
    },
    onConflict: showConflict,
    materializeEdits: materializePendingVisualEdits,
    onError: showError
  })
  titleFlow = createTitleSaveFlow({
    getDeck: () => activeDeck,
    getTitle: () => elements.titleInput.value,
    renameDeck,
    onRenamed: renamed => {
      elements.deckTitle.textContent = renamed.name
      document.querySelector("#breadcrumb-current").textContent = renamed.name
    },
    onState: (state, details) => {
      if (state !== "Saved" || !saveFlow?.dirty) setSaveState(state)
      elements.retrySave.hidden = !details.blocked && !saveFlow?.blocked
    },
    onError: showError
  })

  const bootstrapStages = []
  const openStageMeasurements = []

  function measureBootstrapStage(name, action) {
    if (!__ELEF_E2E__) return action()

    const startedAt = performance.now()
    const record = () => bootstrapStages.push({ name, milliseconds: performance.now() - startedAt })
    try {
      const result = action()
      if (result && typeof result.then === "function") {
        return result.then(value => { record(); return value }, error => { record(); throw error })
      }
      record()
      return result
    } catch (error) {
      record()
      throw error
    }
  }

  function measureOpenStage(name, action) {
    if (!__ELEF_E2E__) return action()

    const startedAt = performance.now()
    const record = () => recordOpenStage(name, startedAt)
    try {
      const result = action()
      if (result && typeof result.then === "function") {
        return result.then(value => { record(); return value }, error => { record(); throw error })
      }
      record()
      return result
    } catch (error) {
      record()
      throw error
    }
  }

  function recordOpenStage(name, startedAt) {
    openStageMeasurements.push({ name, milliseconds: performance.now() - startedAt })
    if (openStageMeasurements.length > 512) openStageMeasurements.shift()
  }

  if (__ELEF_E2E__) {
    let interactiveAt = null
    let nativeReadyAt = null
    let previousInstallationsRemoved = null
    let typingSave = null
    Object.defineProperty(window, "__elefPerformanceTestHooks", {
      value: Object.freeze({
        get interactiveAt() { return interactiveAt },
        get nativeReadyAt() { return nativeReadyAt },
        get previousInstallationsRemoved() { return previousInstallationsRemoved },
        bootstrapStages: () => bootstrapStages.map(stage => ({ ...stage })),
        navigationTiming() {
          const navigation = performance.getEntriesByType("navigation")[0]
          if (!navigation) return null
          return {
            responseEnd: navigation.responseEnd,
            domInteractive: navigation.domInteractive,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd
          }
        },
        interactive: () => { interactiveAt = performance.timeOrigin + performance.now() },
        ready: removed => {
          nativeReadyAt = performance.timeOrigin + performance.now()
          previousInstallationsRemoved = removed
        },
        async open(id) {
          const traceStart = globalThis.__elefPreviewTrace?.length || 0
          const openStageStart = openStageMeasurements.length
          const measured = await measurePaintedAction(async () => {
            await openDeck(id)
            if (activeDeck?.id !== id || elements.editorForm.dataset.loadedDeckId !== id ||
                document.querySelector("#visual-mode").disabled) throw new Error("The measured deck did not finish rendering.")
            const projection = elements.editorForm.querySelector(".presentation-editor-projection")
            if (!projection) throw new Error("The measured presentation projection did not render.")
            return { id, slides: projection.querySelectorAll(".slide-frame > .slide").length }
          })
          // Drain the overview's follow-up frame work for diagnostics after the
          // primary projection has painted; it is not part of first-open time.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return {
            ...measured,
            result: {
              ...measured.result,
              previewTrace: globalThis.__elefPreviewTrace?.slice(traceStart) || [],
              openTrace: openStageMeasurements.slice(openStageStart)
            }
          }
        },
        async list() {
          return measurePaintedAction(async () => {
            await refreshLibrary()
            if (!elements.notice.hidden && elements.notice.dataset.tone === "error") throw new Error("The measured library refresh failed.")
            return { total: decks.length, rendered: libraryListRenderer.renderedCount }
          })
        },
        startTypingDuringSave(text) {
          const editor = editorFor(elements.editorField)
          if (!editor) throw new Error("The measured source editor is not ready.")
          editor.setEditingMode("source")
          const original = currentSource()
          const expected = original + "\n" + text
          editor.replaceRange("\n", editor.value.length)
          // Keep native keystrokes inside a save even on a fast local filesystem.
          e2eNextSaveDelayMs = 500
          typingSave = { expected, saving: flushSave() }
          editor.setSelectionRange(editor.value.length)
          editor.focus()
          return true
        },
        async finishTypingDuringSave() {
          if (!typingSave) throw new Error("Autosave typing was not started.")
          const { expected, saving } = typingSave
          typingSave = null
          if (!(await saving)) throw new Error("The in-flight save did not finish while input was arriving.")
          const actual = currentSource()
          if (actual !== expected) throw new Error(`Input changed during autosave: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`)
          if (!(await flushSave({ force: true }))) throw new Error("The final source could not be saved after input stopped.")
          const saved = currentSource()
          if (saved !== expected) throw new Error(`The editor source changed after save: expected ${JSON.stringify(expected)}, got ${JSON.stringify(saved)}.`)
          return saved
        },
        close() {
          setTimeout(() => void getCurrentWindow().close(), 250)
          return true
        }
      })
    })
    Object.defineProperty(window, "__elefSaveTestHooks", {
      value: Object.freeze({
        pause: () => saveFlow.pause(),
        async flush() {
          try {
            return await saveFlow.flush({ force: true })
          } finally {
            saveFlow.resume()
          }
        }
      })
    })
  }

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
    elements.editorForm.previewController?.finishEditing()
    document.body.dataset.desktopView = "library"
    elements.welcome.hidden = Boolean(library)
    elements.library.hidden = !library
    elements.deckView.hidden = true
    elements.libraryName.textContent = library ? library.root.split(/[\\/]/).filter(Boolean).at(-1) || library.root : "No library selected"
    document.querySelector("#new-deck").disabled = !library
    document.querySelector("#import-elef").disabled = !library
    document.querySelector("#breadcrumb-current").textContent = "Decks"
    showLibraryTab("all")
    void startupUpdateCheck.resume()
  }

  function showLibraryTab(tab) {
    libraryTab = setLibraryViewTab(document.querySelector("#library-view-mount"), tab)
    renderDecks()
    if (libraryTab === "documents") void showDocumentGraph()
  }

  async function documentGraphData() {
    return documentGraphCache.get()
  }

  async function previewDocumentNodes(source) {
    if (!source.includes("[[")) return []
    try {
      return (await documentGraphData()).nodes
    } catch (_error) {
      return []
    }
  }

  async function showDocumentGraph() {
    if (!library) return
    try {
      await loadLibraryRuntime()
      const graph = await documentGraphData()
      const previous = elements.graphView
      const graphView = previous.cloneNode(false)
      graphView.dataset.documentGraphDataValue = JSON.stringify(graph)
      graphView.setAttribute("data-controller", "document-graph")
      graphView.addEventListener("click", event => {
        const link = event.target.closest?.("[data-deck-id]")
        if (!link) return
        event.preventDefault()
        void openDeck(link.dataset.deckId)
      })
      previous.replaceWith(graphView)
      elements.graphView = graphView
      setLibraryViewTab(document.querySelector("#library-view-mount"), libraryTab)
    } catch (error) {
      showError(error)
    }
  }

  function renderDecks() {
    const query = elements.search.value.trim()
    const filtered = filterDecks(decks, libraryTab, query)
    const totalForFilter = filterDecks(decks, libraryTab).length
    cardPreviewObserver?.disconnect()
    libraryMoreObserver?.disconnect()
    const decksById = new Map(filtered.map(deck => [deck.id, deck]))
    const startPreview = target => {
      const deck = decksById.get(target.dataset.deckId)
      if (deck) void loadLibraryPreview(target, deck)
    }
    if (typeof IntersectionObserver === "function") {
      cardPreviewObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          cardPreviewObserver.unobserve(entry.target)
          startPreview(entry.target)
        }
      }, { rootMargin: "180px" })
    } else {
      cardPreviewObserver = null
    }
    libraryListRenderer.render(filtered, deck => createLibraryCard(document, deck, {
      open: id => void openDeck(id),
      preview: deck => void openDeck(deck.id),
      present: deck => {
        void openDeck(deck.id).then(opened => {
          if (opened) void startPresentation()
        })
      },
      rename: (item, name) => void renameDeck(item, name).catch(showError),
      delete: item => void deleteDeck(item)
    }), { onAppend: cards => {
      const previewTargets = cards.flatMap(card => [...card.querySelectorAll(".library-card-preview[data-deck-id]")])
      if (cardPreviewObserver) previewTargets.forEach(target => cardPreviewObserver.observe(target))
      else previewTargets.forEach(startPreview)
    } })
    elements.loadMore.hidden = !libraryListRenderer.hasMore
    if (libraryListRenderer.hasMore && typeof IntersectionObserver === "function") {
      libraryMoreObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.target === elements.loadMore && entry.isIntersecting)) appendLibraryDeckBatch()
      }, { rootMargin: "300px" })
      libraryMoreObserver.observe(elements.loadMore)
    }
    const kindLabel = libraryTab === "all" ? "work" : libraryTab === "documents" ? "document" : "presentation"
    elements.count.textContent = `${totalForFilter} ${totalForFilter === 1 ? kindLabel : `${kindLabel}s`}${query ? ` · ${filtered.length} shown` : ""}`
    const isEmptyState = filtered.length === 0 && !query
    elements.empty.hidden = !isEmptyState
    elements.list.hidden = filtered.length === 0 && !isEmptyState
    elements.noResults.hidden = !query || filtered.length > 0
    updateLibraryEmptyState(elements.empty, libraryTab)
    if (filtered.length === 0 && query) {
      elements.list.hidden = false
    }
  }

  function appendLibraryDeckBatch() {
    elements.loadMore.hidden = !libraryListRenderer.appendNext()
  }

  async function refreshLibrary() {
    if (!library) return
    try {
      const [listedDecks] = await Promise.all([
        fileLibrary.listDecks(),
        loadDesktopAuthoringRegistry()
      ])
      decks = listedDecks
      documentGraphCache.invalidate()
      renderDecks()
      if (libraryTab === "documents") await showDocumentGraph()
      setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`)
      clearNotice()
    } catch (error) {
      showError(error)
    }
  }

  async function chooseLibrary() {
    if (hasUnsavedChanges() && !(await flushSave())) return
    clearNotice()
    setStatus("Choose a folder for your library…")
    try {
      const selected = await fileLibrary.chooseLibraryRoot()
      if (!selected) {
        setStatus("Library selection cancelled")
        return
      }
      library = selected
      await loadDesktopAuthoringRegistry()
      documentGraphCache.invalidate()
      libraryConfig = selected.config || libraryConfig
      decks = selected.decks
      applyTheme(libraryConfig.theme)
      showLibrary()
      if (selected.config_notice) showNotice(selected.config_notice, "error")
      setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`)
      if (await fileLibrary.pendingOpenedElefCount()) void processOpenedFiles()
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
      const opened = await fileLibrary.createDeck(name, kind)
      await refreshLibrary()
      await openDeck(opened.id)
    } catch (error) {
      showError(error)
    }
  }

  const openDeck = createDeckOpenFlow(openDeckNow)

  async function openDeckNow(id) {
    try {
      if (document.body.classList.contains("presenting-deck")) await exitPresentation()
      elements.editorForm.previewController?.finishEditing()
      await Promise.resolve()
      if (activeDeck && hasUnsavedChanges() && !(await flushSave())) return false
      delete elements.editorForm.dataset.loadedDeckId
      let transition
      do {
        transition = await prepareDeckOpen(id, {
          read: target => measureOpenStage("readDeck", () => transport.readDeck(target)),
          isDirty: hasUnsavedChanges,
          getRevision: () => saveFlow.revision,
          flushSave,
          prepare: deck => measureOpenStage("prepareDeck", async () => {
            await loadEditorRuntime()
            let documentTitles = []
            if (deck.source_file === "document.md" || deck.source.includes("[[")) {
              try {
                const graph = await documentGraphData()
                documentTitles = deck.source_file === "document.md" ? graph.nodes.map(node => node.title) : []
              } catch (_error) {
                documentTitles = deck.source_file === "document.md"
                  ? decks.filter(item => item.kind === "document").map(item => item.name) : []
              }
            }
            return { documentTitles }
          })
        })
      } while (transition && (hasUnsavedChanges() || saveFlow.revision !== transition.revision))
      if (!transition) {
        if (activeDeck) elements.editorForm.dataset.loadedDeckId = activeDeck.id
        return false
      }
      const { deck, prepared: { documentTitles } } = transition
      const isDocument = deck.source_file === "document.md"
      if (deck.id !== id) {
        decks = decks.map(item => item.id === id ? { ...item, id: deck.id } : item)
        documentGraphCache.invalidate()
        renderDecks()
      }
      // All asynchronous work is finished. Installing the buffer and changing
      // save ownership occur in one synchronous turn, with no stale A buffer
      // able to schedule a write for B during graph/controller preparation.
      saveFlow.deactivate()
      activeDeck = null
      try {
        configureEditorKind(elements.editorField.closest(".editor-shell"), isDocument ? "document" : "presentation", {
          documentTitles,
          sourceName: isDocument ? "document[source]" : "presentation[source]",
          showTitle: true,
          formControllers: "preview visual-editor presentation-editor slide-overview media presentation"
        })
        const editor = await measureOpenStage("editorReady", () => editorFor(elements.editorField)?.editorReady
          ? editorFor(elements.editorField)
          : waitForEditorController(elements.editorField, editorFor))
        measureOpenStage("loadDocument", () => {
          editor.loadDocument(deck.source)
          editor.setEditingMode("visual", { restoreCaret: false })
        })
      } catch (error) {
        elements.editorInput.disabled = true
        showLibrary()
        throw error
      }
    const viewSetupStartedAt = __ELEF_E2E__ ? performance.now() : null
      transport.activateDeck(deck, id)
      activeDeck = deck
      saveFlow.activate(deck)
      elements.deckTitle.textContent = deck.name
      elements.deckTitle.hidden = !isDocument
      elements.titleInput.value = deck.name
      document.querySelector("#deck-kind").textContent = deck.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION"
      document.querySelector("#deck-source-name").textContent = deck.source_file
      elements.editorField.dataset.editorInitialSourceValue = JSON.stringify(deck.source)
      elements.editorForm.dataset.previewUrlValue = `elef-preview://localhost/${encodeURIComponent(deck.id)}`
      elements.editorForm.dataset.mediaEnabledValue = "true"
      elements.editorForm.dataset.mediaWorkKindValue = deck.source_file === "document.md" ? "document" : "presentation"
      elements.editorForm.dataset.mediaUploadUrlValue = `elef-upload://localhost/${encodeURIComponent(deck.id)}`
      elements.editorForm.dataset.mediaAssetBaseUrlValue = `elefasset://localhost/${encodeURIComponent(deck.id)}`
      elements.editorField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(documentTitles)
      const visualButton = document.querySelector("#visual-mode")
      visualButton.disabled = true
      visualButton.title = "Rendering preview…"
      elements.editorInput.disabled = false
      setSaveState("Saved")
      document.querySelector("#deck-id").textContent = deck.id
      elements.editorForm.dataset.loadedDeckId = deck.id
      const notice = document.querySelector("#deck-notice")
      notice.textContent = deck.notices.join(" ")
      notice.hidden = deck.notices.length === 0
      elements.library.hidden = true
      elements.deckView.hidden = false
      document.body.dataset.desktopView = "editor"
      document.querySelector("#breadcrumb-current").textContent = deck.name
      setStatus("Deck opened")
      if (viewSetupStartedAt !== null) recordOpenStage("deckViewSetup", viewSetupStartedAt)
      await measureOpenStage("previewRefresh", () => elements.editorForm.previewController?.refresh())
      return true
    } catch (error) {
      showError(error)
      return false
    }
  }

  async function renameDeck(deck, name) {
    if (typeof name !== "string" || name.trim() === deck.name) return
    const renamed = await fileLibrary.renameDeck(deck.id, name.trim())
    if (activeDeck?.id === deck.id) Object.assign(activeDeck, renamed)
    decks = decks.map(item => item.id === deck.id ? { ...item, ...renamed } : item)
    renderDecks()
    return renamed
  }

  async function deleteDeck(deck) {
    try {
      const result = await fileLibrary.deleteDeck(deck.id)
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
    if (imported.name_collision) {
      showNotice(`A deck with an equivalent name already exists. Imported as “${imported.deck.name}”.`, "warning")
    }
  }

  async function processOpenedFiles() {
    openFilesRequested = true
    if (!libraryStatusLoaded) return
    if (processingOpenedFiles) return
    processingOpenedFiles = true
    try {
      while (openFilesRequested) {
        openFilesRequested = false
        if (hasUnsavedChanges() && !(await flushSave())) {
          openFilesWaitingForSave = true
          break
        }
        while (true) {
          try {
            const imported = await fileLibrary.importOpenedElef()
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

  function materializePendingVisualEdits() {
    const editor = editorFor(elements.editorField)
    if (editor?.editorReady) editor.projectionController()?.flushPendingProjectionEdits?.()
  }

  function hasUnsavedChanges() {
    materializePendingVisualEdits()
    return Boolean(saveFlow?.dirty || titleFlow?.isDirty())
  }

  async function flushSave(options) {
    hasUnsavedChanges()
    if (titleFlow && !(await titleFlow.flush(options))) return false
    return saveFlow.flush(options)
  }

  function showConflict(conflict) {
    const dialog = elements.editorForm.querySelector("#conflict-dialog")
    presentConflictDialog(dialog, {
      message: "The source file changed outside Elef. Choose which version to keep, or edit a merge.",
      localSource: conflict.localSource,
      diskSource: conflict.diskSource,
      diskSourceFile: conflict.diskSourceFile,
      mergeSource: currentSource()
    })
  }

  function currentSource() {
    return editorFor(elements.editorField)?.sourceValue ?? elements.editorInput.value
  }

  async function setEditorSource(source, { id = activeDeck?.id, expectedSource = currentSource() } = {}) {
    return applyEditorSource(source, {
      id, expectedSource, getDeckId: () => activeDeck?.id, getSource: currentSource,
      waitForEditor: () => waitForEditorController(elements.editorField, editorFor),
      materializeEdits: materializePendingVisualEdits,
      setFallback: value => { elements.editorInput.value = value }
    })
  }

  async function showSettings() {
    try {
      libraryConfig = await fileLibrary.readLibraryConfig()
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
      await fileLibrary.writeLibraryConfig(next)
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
    if (hasUnsavedChanges() && !(await flushSave({ force: true }))) return
    try {
      if (await fileLibrary.exportElef(activeDeck.id)) setStatus("Deck exported")
    } catch (error) {
      showError(error)
    }
  }

  async function importDeck() {
    if (!library) {
      showNotice("Choose a library before importing a deck.")
      return
    }
    if (hasUnsavedChanges() && !(await flushSave())) return
    try {
      const imported = await fileLibrary.importElef()
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
      const imported = await fileLibrary.resolveImportConflict(resolution)
      if (imported) await completeImport(imported)
      void processOpenedFiles()
    } catch (error) {
      showError(error)
    }
  }

  async function checkForUpdates(showNoUpdate = true) {
    if (showNoUpdate) startupUpdateCheck.cancel()
    if (updateInstalling) return false
    try {
      const update = await checkForUpdate()
      if (!update) {
        if (showNoUpdate) setStatus("Elef is up to date")
        return false
      }
      await pendingUpdate?.dispose().catch(() => {})
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
    if (!pendingUpdate || updateInstalling) return
    updateInstalling = true
    const button = document.querySelector("#install-update")
    const later = document.querySelector("#update-later")
    button.disabled = true
    later.disabled = true
    try {
      const installed = await installPendingUpdate(pendingUpdate, {
        prepare: async () => !hasUnsavedChanges() || await flushSave({ force: true }),
        onProgress: event => {
          if (event.event === "Started" || event.event === "Progress") {
            elements.updateProgress.textContent = "Downloading update…"
          }
          if (event.event === "Finished") elements.updateProgress.textContent = "Installing update…"
        }
      })
      if (!installed) elements.updateProgress.textContent = "Installation paused. Save your changes and choose Install to try again."
    } catch (_error) {
      showError({ message: "The update could not be installed. Your current version is still available." })
    } finally {
      updateInstalling = false
      button.disabled = false
      later.disabled = false
    }
  }

  async function printCurrentDeck() {
    if (!activeDeck) {
      showNotice("Open a deck before printing it.")
      return
    }
    if (hasUnsavedChanges() && !(await flushSave())) return
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
    const presentation = window.Stimulus?.getControllerForElementAndIdentifier(elements.editorForm, "presentation")
    if (!presentation?.start()) {
      showNotice("This presentation has no slides to show.", "error")
      return
    }
    document.body.classList.add("presenting-deck")
    elements.presentationExit.hidden = false
    document.addEventListener("keydown", presentationKeydown, true)
    try {
      await getCurrentWindow().setFullscreen(true)
    } catch (_error) {
      showNotice("Presentation mode is open. Use Esc to return to editing.")
    } finally {
      // Native fullscreen can move focus to the exit button. Put keyboard
      // navigation back on the shared presentation stage after the transition.
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
    elements.editorForm.querySelector("#conflict-dialog").close()
  }

  function resolveConflictWithLocal() {
    if (!saveFlow.keepLocalVersion()) return
    syncSourceLabel()
    elements.editorForm.querySelector("#conflict-dialog").close()
  }

  async function resolveConflictWithMerge() {
    const mergedSource = elements.editorForm.querySelector("#conflict-merge").value
    if (!await saveFlow.saveMergedVersion(mergedSource)) return
    syncSourceLabel()
    elements.editorForm.querySelector("#conflict-dialog").close()
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
  document.querySelector(".brand").addEventListener("click", event => {
    event.preventDefault()
    document.querySelector("#back-to-library").click()
  })
  document.querySelector("#open-settings").addEventListener("click", () => void showSettings())
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
  elements.editorForm.querySelector("#use-disk-version").addEventListener("click", resolveConflictWithDisk)
  elements.editorForm.querySelector("#keep-local-version").addEventListener("click", resolveConflictWithLocal)
  elements.editorForm.querySelector("#save-merged-version").addEventListener("click", resolveConflictWithMerge)
  elements.editorForm.querySelector("#conflict-dialog").addEventListener("cancel", event => {
    if (saveFlow.conflict) event.preventDefault()
  })
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
      const [status] = await measureBootstrapStage("library-status", () => Promise.all([fileLibrary.getLibraryStatus(), openedFileListener]))
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
      await measureBootstrapStage("editor-runtime", () => loadEditorRuntime())
      configureEditorKind(elements.editorField.closest(".editor-shell"), "presentation", {
        showTitle: true,
        formControllers: "preview visual-editor presentation-editor slide-overview media presentation"
      })
      await measureBootstrapStage("editor-ready", () => waitForEditorController(elements.editorField, editorFor))
    },
    confirmReady: async () => {
      const removed = await measureBootstrapStage("native-ready-ack", () => fileLibrary.confirmAppReady())
      if (__ELEF_E2E__) window.__elefPerformanceTestHooks.ready(removed)
      void fileLibrary.pendingOpenedElefCount()
        .then(count => { if (count) void processOpenedFiles() })
        .catch(showError)
      startupUpdateCheck.schedule(10_000)
    }
  }).catch(showError)

}

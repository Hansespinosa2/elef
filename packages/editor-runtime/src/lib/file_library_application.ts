import { createDeckOpenFlow, prepareDeckOpen } from "./deck_open_flow.js"
import { measurePaintedAction } from "./performance_measurement.js"
import { editorFor } from "./editor_controller_lookup.js"
import { mountHostPresentationEditor } from "./presentation_editor_host.js"
import { createDocumentGraphCache } from "./document_graph_cache.js"
import { createRequestGuard } from "./request_identity.js"
import { buildDocumentGraph } from "@elef/work-model"
import { waitForEditorController } from "./editor_ready.js"
import { createWorkSession, createTitleSaveFlow } from "@elef/client"
import { createCodeMirrorBinding } from "./editor_binding.js"
import { presentConflictDialog } from "./conflict_dialog.js"
import { createRendererClient } from "./renderer_worker_client.js"
import { applyDesktopFeatureFlags } from "./feature_flags.js"
import { configureEditorKind, renderEditorView } from "./editor_view.js"
import { CREATE_WORK_EVENT, GraphController, mountElef, mountPresentation, mountVimSettings, parseLibraryRoute, renderGraphView } from "@elef/client"

export interface FileLibraryDeck {
  id: string;
  name: string;
  source: string;
  source_file: string;
  content_hash: string;
  notices: string[];
  kind?: string;
  [key: string]: any;
}

// The native bridge omits content_hash for unhashed decks; normalize at
// entry so every deck in the system carries a hash. Empty string means
// "unknown": it never equals a real revision, so staleness checks treat
// hashless decks as changed (the safe direction), and work_session declines
// sessions for them exactly as it would for undefined.
function ensureDeckHash(deck: Omit<FileLibraryDeck, "content_hash"> & { content_hash?: string }): FileLibraryDeck {
  deck.content_hash ??= ""
  // The ensure above guarantees content_hash at runtime; the cast records
  // what it established (TypeScript cannot narrow the object from it).
  return deck as FileLibraryDeck
}

export interface FileLibraryStatus {
  root: string;
  config?: any;
  config_notice?: string;
  decks: FileLibraryDeck[];
  [key: string]: any;
}

// Host seam: the desktop shell injects its Tauri/native bridge. Members stay
// `any` because the host is untyped JavaScript; the names document the
// contract this module consumes.
export interface DesktopPlatform {
  fileLibrary: any;
  createLibraryHost: any;
  listen: any;
  getCurrentWindow: any;
  completeBootstrap: any;
  createCloseFlow: any;
  createTransportAdapter: any;
  installFetchTransport: any;
  mediaUrlsForDeck: any;
  checkForUpdate: any;
  createIdleUpdateCheck: any;
  installPendingUpdate: any;
  desktopAuthoringRegistry: any;
  loadDesktopAuthoringRegistry: any;
  quietSavePolicy: any;
  registerEditorRuntime: any;
  authoringTransport?: any;
  updaterSeam?: any;
}

interface StageMeasurement {
  name: string;
  milliseconds: number;
}

// Must-exist shell lookup. The desktop shell guarantees these nodes; the cast
// keeps the original throw-on-missing behavior (a TypeError at the use site)
// while giving the node its precise type. A helper (not a parenthesized
// cast) because this file uses ASI-sensitive semicolon-free style.
function shellElement<T extends Element>(selector: string): T {
  return document.querySelector(selector) as T
}

export function startFileLibraryApplication(platform: DesktopPlatform): void {
  const {
    fileLibrary, createLibraryHost, listen, getCurrentWindow,
    completeBootstrap, createCloseFlow, createTransportAdapter, installFetchTransport,
    mediaUrlsForDeck, checkForUpdate, createIdleUpdateCheck, installPendingUpdate,
    desktopAuthoringRegistry, loadDesktopAuthoringRegistry, quietSavePolicy,
    registerEditorRuntime
  } = platform

  applyDesktopFeatureFlags(document)

  const renderer = createRendererClient()
  const readPreviewTrace = installFetchTransport({
    renderer,
    getContext: async (source: string) => ({
      kind: activeDeck?.source_file === "document.md" ? "document" : "presentation",
      title: document.querySelector<HTMLInputElement>("#desktop-editor-title")?.value.trim() || activeDeck?.name || "Untitled",
      deckId: activeDeck?.id || "",
      mediaBaseUrl: activeDeck ? mediaUrlsForDeck(activeDeck).assetBaseUrl : "",
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
    showSaveStatus: false,
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
  const editorFieldHost = document.querySelector("#desktop-editor-field") as HTMLElement
  const editorFormHost = document.querySelector("#desktop-editor-form") as HTMLElement
  editorFieldHost.removeAttribute("data-controller")
  editorFormHost.removeAttribute("data-controller")

  // The shared client renders the library markup (tabs, cards, notice,
  // graph panel) into #library-view-mount during bootstrap initialize; the
  // host queries those client-owned nodes fresh at each use site instead of
  // caching them here.
  const mount = document.querySelector("#library-view-mount") as HTMLElement
  let shell: any = null
  let libraryHost: any = null

  const elements = {
    libraryName: document.querySelector("#library-name") as HTMLElement,
    welcome: document.querySelector("#welcome-view") as HTMLElement,
    library: document.querySelector("#library-view") as HTMLElement,
    deckView: document.querySelector("#deck-view") as HTMLElement,
    deckTitle: document.querySelector("#deck-title") as HTMLElement,
    status: document.querySelector("#status-text") as HTMLElement,
    settingsDialog: document.querySelector("#settings-dialog") as HTMLDialogElement,
    settingsForm: document.querySelector("#settings-form") as HTMLFormElement,
    libraryTheme: document.querySelector("#library-theme") as HTMLSelectElement,
    aboutDialog: document.querySelector("#about-dialog") as HTMLDialogElement,
    editorField: document.querySelector("#desktop-editor-field") as HTMLElement,
    editorForm: document.querySelector("#desktop-editor-form") as HTMLFormElement,
    editorInput: document.querySelector("#deck-source") as HTMLTextAreaElement,
    titleInput: document.querySelector("#desktop-editor-title") as HTMLInputElement,
    restoreDraft: document.querySelector("#restore-local-draft") as HTMLButtonElement,
    importConflictDialog: document.querySelector("#import-conflict-dialog") as HTMLDialogElement,
    importConflictMessage: document.querySelector("#import-conflict-message") as HTMLElement,
    updateDialog: document.querySelector("#update-dialog") as HTMLDialogElement,
    updateVersion: document.querySelector("#update-version") as HTMLElement,
    updateNotes: document.querySelector("#update-notes") as HTMLElement,
    updateProgress: document.querySelector("#update-progress") as HTMLElement,
    presentationExit: document.querySelector("#exit-presentation") as HTMLButtonElement
  }

  let library: FileLibraryStatus | null = null
  let libraryConfig = { schema_version: 1, theme: "dark", hotkeys: {} }
  let decks: FileLibraryDeck[] = []
  let activeDeck: FileLibraryDeck | null = null
  let saveFlow: any = null
  let sessionStatusKind = "clean"
  let lastSourceFile: string | null = null
  let e2eNextSaveDelayMs = 0
  const documentGraphCache = createDocumentGraphCache(async () => buildDocumentGraph(await fileLibrary.readDocumentGraph()))
  let pendingUpdate: any = null
  let updateInstalling = false
  let libraryStatusLoaded = false
  let processingOpenedFiles = false
  let openFilesRequested = false
  let openFilesWaitingForSave = false
  let titleFlow: any = null
  const startupUpdateCheck = createIdleUpdateCheck(
    () => checkForUpdates(false),
    () => !elements.deckView.hidden
  )

  // The shared client renders the authoring dialog (the same DOM contract as
  // the web settings pages, so the shared scenarios cover both hosts).
  // Remount on every open so the dialog loads fresh registries, matching the
  // previous dialog's open-time load.
  const authoringHostDialog = document.querySelector("#authoring-dialog") as HTMLDialogElement
  const authoringMount = document.querySelector("#authoring-settings-mount") as HTMLElement
  let authoringShell: any = null
  function closeAuthoringSettings(): void {
    if (authoringShell) {
      authoringShell.unmount()
      authoringShell = null
    }
    if (authoringHostDialog.open) authoringHostDialog.close()
  }
  async function openAuthoringSettings(): Promise<void> {
    closeAuthoringSettings()
    authoringShell = await mountElef(authoringMount, libraryHost, {
      initialUrl: "/snippets",
      authoring: {
        transport: platform.authoringTransport,
        renderExample: source => renderer.renderMarkdownBlock(source),
        reloadEditorRegistry: loadDesktopAuthoringRegistry,
        onClose: closeAuthoringSettings,
        onSaved: setStatus
      },
      updater: platform.updaterSeam
    })
    authoringHostDialog.showModal()
  }

  // Device-local vim preferences render through the shared client UI with a
  // bridge that live-syncs the open editor, preserving the previous
  // controller's behavior (same storage keys, same editor push).
  const vimMount = document.querySelector("#vim-settings-mount")
  if (vimMount) {
    const editorForVim = () => document.querySelector(".source-field")?.editorController || null
    mountVimSettings(vimMount, {
      editorBridge: {
        setVimEnabled: (enabled: boolean) => editorForVim()?.setVimEnabled(enabled),
        setEscapeKey: (key: string) => editorForVim()?.setEscapeKey(key),
        clearEscapeKey: () => editorForVim()?.clearEscapeKey(),
        setLineNumberMode: (mode: string) => editorForVim()?.setLineNumberMode(mode),
        setModeAwareCursor: (enabled: boolean) => editorForVim()?.setModeAwareCursor(enabled)
      }
    })
  }

  const transport = createTransportAdapter({ onConflict: (event: any) => saveFlow?.handleConflict(event) })
  const sessionTransport = {
    ...transport,
    saveSource: async (id: string, source: string) => {
      const isDocument = decks.find(deck => deck.id === id)?.source_file === "document.md"
      if ((typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) && e2eNextSaveDelayMs > 0) {
        const delay = e2eNextSaveDelayMs
        e2eNextSaveDelayMs = 0
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      const result = await transport.saveSource(id, source)
      if (isDocument) documentGraphCache.invalidate()
      return result
    }
  }
  function openSession(deck: FileLibraryDeck): void {
    closeSession()
    lastSourceFile = deck.source_file
    const adapter = createCodeMirrorBinding({
      getEditor: () => editorFor(elements.editorField),
      getDeckId: () => activeDeck?.id,
      getFallbackValue: () => elements.editorInput.value,
      setFallbackValue: value => { elements.editorInput.value = value },
      waitForEditor: () => waitForEditorController(elements.editorField, editorFor),
      materializeEdits: materializePendingVisualEdits
    })
    const session = createWorkSession({
      transport: sessionTransport,
      policy: {
        workId: deck.id,
        kind: deck.source_file === "document.md" ? "document" : "presentation",
        deck,
        getText: adapter.getText,
        setText: adapter.setText,
        saveDelay: quietSavePolicy.saveDelay,
        externalPollMs: quietSavePolicy.externalPollMs,
        snapshotIntervalMs: quietSavePolicy.snapshotIntervalMs,
        materializeEdits: adapter.materializeEdits,
        onConflict: showConflict,
        onError: showError
      }
    })
    session.onStatus((status: any) => {
      sessionStatusKind = status.kind
      elements.restoreDraft.hidden = !session.canRestoreDraft
      if (activeDeck && activeDeck.source_file !== lastSourceFile) {
        lastSourceFile = activeDeck.source_file
        syncSourceLabel()
      }
      if (status.kind === "clean" && openFilesWaitingForSave) {
        openFilesWaitingForSave = false
        queueMicrotask(() => void processOpenedFiles())
      }
    })
    session.onExternalChange((snapshot: any) => {
      if (snapshot.removed || !activeDeck) return
      if (activeDeck.source_file === "document.md" &&
          (snapshot.baseline.revision !== activeDeck.content_hash || snapshot.sourceFile !== activeDeck.source_file)) {
        documentGraphCache.invalidate()
      }
    })
    const editor = editorFor(elements.editorField)
    editor?.attachSession?.(session)
    saveFlow = session
  }

  function closeSession(): void {
    if (!saveFlow) return
    editorFor(elements.editorField)?.detachSession?.(saveFlow)
    saveFlow.dispose()
    saveFlow = null
    sessionStatusKind = "clean"
  }
  titleFlow = createTitleSaveFlow({
    getDeck: () => activeDeck,
    getTitle: () => elements.titleInput.value,
    renameDeck,
    onRenamed: (renamed: any) => {
      elements.deckTitle.textContent = renamed.name
      shellElement<HTMLElement>("#breadcrumb-current").textContent = renamed.name
    },
    onState: () => {},
    onError: showError
  })

  const bootstrapStages: StageMeasurement[] = []
  const openStageMeasurements: StageMeasurement[] = []

  function measureBootstrapStage(name: string, action: () => any): any {
    if (!(typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) return action()

    const startedAt = performance.now()
    const record = () => bootstrapStages.push({ name, milliseconds: performance.now() - startedAt })
    try {
      const result = action()
      if (result && typeof result.then === "function") {
        return result.then((value: any) => { record(); return value }, (error: any) => { record(); throw error })
      }
      record()
      return result
    } catch (error) {
      record()
      throw error
    }
  }

  function measureOpenStage(name: string, action: () => any): any {
    if (!(typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) return action()

    const startedAt = performance.now()
    const record = () => recordOpenStage(name, startedAt)
    try {
      const result = action()
      if (result && typeof result.then === "function") {
        return result.then((value: any) => { record(); return value }, (error: any) => { record(); throw error })
      }
      record()
      return result
    } catch (error) {
      record()
      throw error
    }
  }

  function recordOpenStage(name: string, startedAt: number): void {
    openStageMeasurements.push({ name, milliseconds: performance.now() - startedAt })
    if (openStageMeasurements.length > 512) openStageMeasurements.shift()
  }

  if ((typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) {
    let interactiveAt: number | null = null
    let nativeReadyAt: number | null = null
    let previousInstallationsRemoved: unknown = null
    let typingSave: { expected: string; saving: Promise<boolean> } | null = null
    Object.defineProperty(window, "__elefPerformanceTestHooks", {
      value: Object.freeze({
        get interactiveAt() { return interactiveAt },
        get nativeReadyAt() { return nativeReadyAt },
        get previousInstallationsRemoved() { return previousInstallationsRemoved },
        bootstrapStages: () => bootstrapStages.map(stage => ({ ...stage })),
        navigationTiming() {
          const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
          if (!navigation) return null
          return {
            responseEnd: navigation.responseEnd,
            domInteractive: navigation.domInteractive,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd
          }
        },
        interactive: () => { interactiveAt = performance.timeOrigin + performance.now() },
        ready: (removed: unknown) => {
          nativeReadyAt = performance.timeOrigin + performance.now()
          previousInstallationsRemoved = removed
        },
        async open(id: string) {
          const traceStart = readPreviewTrace?.().length || 0
          const openStageStart = openStageMeasurements.length
          const measured = await measurePaintedAction(async () => {
            await openDeck(id)
            if (activeDeck?.id !== id || elements.editorForm.dataset.loadedDeckId !== id ||
                shellElement<HTMLButtonElement>("#visual-mode").disabled) throw new Error("The measured deck did not finish rendering.")
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
              previewTrace: readPreviewTrace?.().slice(traceStart) || [],
              openTrace: openStageMeasurements.slice(openStageStart)
            }
          }
        },
        async list() {
          return measurePaintedAction(async () => {
            await refreshLibrary()
            const notice = document.querySelector<HTMLElement>("#notice")
            if (notice && !notice.hidden && notice.dataset.tone === "error") throw new Error("The measured library refresh failed.")
            return { total: decks.length, rendered: document.querySelectorAll("#deck-list .library-card").length }
          })
        },
        typingValue: () => currentSource(),
        startTypingDuringSave(text: string) {
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
        pause: () => saveFlow?.pause(),
        saveStatus: () => {
          if (titleFlow?.isDirty() || titleFlow?.isBlocked()) return "dirty"
          return sessionStatusKind
        },
        async flush() {
          try {
            if (!saveFlow) return true
            const result = await saveFlow.flush({ force: true })
            return result.kind === "clean" || result.kind === "saved"
          } finally {
            saveFlow?.resume()
          }
        },
        runSnapshotCadence: () => saveFlow?.runSnapshotCadence?.() ?? null
      })
    })
  }

  function setStatus(message: string): void {
    elements.status.textContent = message
  }

  function showNotice(message: string, tone = "info"): void {
    shell?.notify(message, tone)
  }

  function clearNotice(): void {
    shell?.notify(null)
  }

  function applyTheme(theme: string): void {
    document.documentElement.dataset.theme = ["system", "light", "dark"].includes(theme) ? theme : "system"
  }

  function showError(error: any): void {
    const message = typeof error?.message === "string" ? error.message : "The operation could not be completed."
    setStatus(message)
    showNotice(message, "error")
  }

  let libraryShown = false
  function showLibrary(): void {
    elements.editorForm.previewController?.finishEditing()
    document.body.dataset.desktopView = "library"
    elements.welcome.hidden = Boolean(library)
    elements.library.hidden = !library
    elements.deckView.hidden = true
    elements.libraryName.textContent = library ? library.root.split(/[\\/]/).filter(Boolean).at(-1) || library.root : "No library selected"
    shellElement<HTMLButtonElement>("#new-deck").disabled = !library
    shellElement<HTMLButtonElement>("#import-elef").disabled = !library
    shellElement<HTMLElement>("#breadcrumb-current").textContent = "Decks"
    // The first show preserves the boot filter (a deep-linked tab); every
    // return home resets to All and reloads, so cards and previews reflect
    // saves made in the editor (the pre-client card pass re-read preview
    // sources on every return; the client caches by revision and needs
    // the explicit reload to see them).
    if (libraryShown) {
      shell.setFilter("all")
      void refreshLibrary()
    } else libraryShown = true
    void startupUpdateCheck.resume()
  }

  // The client owns the active tab; the host reads it back from the settled
  // DOM whenever a refresh or library event needs the graph decision.
  function currentFilter(): string {
    return mount.querySelector<HTMLElement>("[data-library-tab][aria-current='page']")?.dataset.libraryTab ?? "all"
  }

  async function documentGraphData(): Promise<any> {
    return documentGraphCache.get()
  }

  async function previewDocumentNodes(source: string): Promise<any[]> {
    if (!source.includes("[[")) return []
    try {
      return (await documentGraphData()).nodes
    } catch (_error) {
      return []
    }
  }

  // Request identity for graph loads: a slow graph resolving after the user
  // navigated away (library hidden) or after a newer request started must
  // not render into the stale slot. The previous Stimulus mount had no such
  // guard; the panel re-read the filter but still applied late payloads.
  const graphRequests = createRequestGuard()
  let graphController: GraphController | null = null
  async function showDocumentGraph(): Promise<void> {
    if (!library) return
    const request = graphRequests.request()
    try {
      const graph = await documentGraphData()
      // Reject stale results: navigation away from the library or a newer
      // graph request supersedes this payload.
      if (!graphRequests.isCurrent(request) || !libraryShown) return
      const slot = mount.querySelector("#document-graph-view") as HTMLElement | null
      if (!slot) return
      graphController?.destroy()
      renderGraphView(slot, graph)
      graphController = new GraphController(slot, graph, { onOpenDeck: (id: string) => void openDeck(id) })
      // The client hides the panel when the filter leaves documents; the host
      // unhides it once populated. Re-read the settled filter here so a slow
      // load racing a tab switch lands in the correct state.
      slot.hidden = currentFilter() !== "documents"
    } catch (error) {
      showError(error)
    }
  }

  async function refreshLibrary(): Promise<void> {
    if (!library) return
    try {
      const [listedDecks] = await Promise.all([
        fileLibrary.listDecks(),
        loadDesktopAuthoringRegistry()
      ])
      decks = listedDecks.map(ensureDeckHash)
      documentGraphCache.invalidate()
      libraryHost?.noteListedDecks(listedDecks)
      await shell.refresh()
      if (currentFilter() === "documents") await showDocumentGraph()
      setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`)
      clearNotice()
    } catch (error) {
      showError(error)
    }
  }

  async function chooseLibrary(): Promise<void> {
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
      libraryHost?.noteRootChanged()
      await loadDesktopAuthoringRegistry()
      documentGraphCache.invalidate()
      libraryConfig = selected.config || libraryConfig
      decks = selected.decks.map(ensureDeckHash)
      applyTheme(libraryConfig.theme)
      showLibrary()
      if (selected.config_notice) showNotice(selected.config_notice, "error")
      setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`)
      if (await fileLibrary.pendingOpenedElefCount()) void processOpenedFiles()
    } catch (error) {
      showError(error)
    }
  }

  // The create dialog is client-owned; the host only requests it. Creation
  // itself flows through the host adapter, then the navigate seam opens the
  // new work, matching the old create-then-open sequence.
  function showCreateDialog(kind = "presentation") {
    mount.querySelector(".library-shared-view")?.dispatchEvent(
      new CustomEvent(CREATE_WORK_EVENT, { detail: { kind } })
    )
  }

  const openDeck = createDeckOpenFlow(openDeckNow)

  async function openDeckNow(id: string): Promise<boolean> {
    // Hide the library before the first await: pending card-preview idle
    // callbacks would otherwise spend fetches and main-thread renders
    // through the whole open. Every early exit below restores visibility;
    // the success path leaves the editor swap in charge and failures return
    // through showLibrary.
    const libraryWasHidden = elements.library.hidden
    elements.library.hidden = true
    const restoreLibrary = () => { elements.library.hidden = libraryWasHidden }
    try {
      if (document.body.classList.contains("presenting-deck")) await exitPresentation()
      elements.editorForm.previewController?.finishEditing()
      await Promise.resolve()
      if (activeDeck && hasUnsavedChanges() && !(await flushSave())) { restoreLibrary(); return false }
      delete elements.editorForm.dataset.loadedDeckId
      let transition: { deck: FileLibraryDeck; prepared: unknown; revision: unknown } | null
      do {
        transition = await prepareDeckOpen<string, FileLibraryDeck>(id, {
          read: target => measureOpenStage("readDeck", () => transport.readDeck(target)),
          isDirty: hasUnsavedChanges,
          getRevision: () => saveFlow?.revision ?? 0,
          flushSave,
          prepare: deck => measureOpenStage("prepareDeck", async () => {
            await registerEditorRuntime()
            let documentTitles: string[] = []
            if (deck.source_file === "document.md" || deck.source.includes("[[")) {
              try {
                const graph = await documentGraphData()
                documentTitles = deck.source_file === "document.md" ? graph.nodes.map((node: any) => node.title) : []
              } catch (_error) {
                documentTitles = deck.source_file === "document.md"
                  ? decks.filter(item => item.kind === "document").map(item => item.name) : []
              }
            }
            return { documentTitles }
          })
        })
      } while (transition && (hasUnsavedChanges() || (saveFlow?.revision ?? 0) !== transition.revision))
      if (!transition) {
        if (activeDeck) elements.editorForm.dataset.loadedDeckId = activeDeck.id
        restoreLibrary()
        return false
      }
      const { deck, prepared } = transition
      const { documentTitles } = prepared as { documentTitles: string[] }
      const isDocument = deck.source_file === "document.md"
      if (deck.id !== id) {
        decks = decks.map(item => item.id === id ? { ...item, id: deck.id } : item)
        documentGraphCache.invalidate()
        void shell.refresh()
      }
      // All asynchronous work is finished. Installing the buffer and changing
      // save ownership occur in one synchronous turn, with no stale A buffer
      // able to schedule a write for B during graph/controller preparation.
      closeSession()
      activeDeck = null
      try {
        configureEditorKind(elements.editorField.closest(".editor-shell"), isDocument ? "document" : "presentation", {
          documentTitles,
          sourceName: isDocument ? "document[source]" : "presentation[source]",
          showTitle: true,
          formControllers: "preview visual-editor slide-overview media"
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
      // The shared client presentation editor lives on the form for the app
      // lifetime (it resolves the projection canvas lazily, like the retired
      // Stimulus controller did); presentation decks mount it once here while
      // document decks leave it unmounted.
      if (!isDocument && !elements.editorForm.presentationEditorController) {
        mountHostPresentationEditor(elements.editorForm)
      }
    const viewSetupStartedAt = (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) ? performance.now() : null
      transport.activateDeck(deck, id)
      activeDeck = deck
      openSession(deck)
      elements.deckTitle.textContent = deck.name
      elements.deckTitle.hidden = !isDocument
      elements.titleInput.value = deck.name
      shellElement<HTMLElement>("#deck-kind").textContent = deck.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION"
      shellElement<HTMLElement>("#deck-source-name").textContent = deck.source_file
      elements.editorField.dataset.editorInitialSourceValue = JSON.stringify(deck.source)
      const mediaUrls = mediaUrlsForDeck(deck)
      elements.editorForm.dataset.previewUrlValue = mediaUrls.previewUrl
      elements.editorForm.dataset.mediaEnabledValue = "true"
      elements.editorForm.dataset.mediaWorkKindValue = deck.source_file === "document.md" ? "document" : "presentation"
      elements.editorForm.dataset.mediaUploadUrlValue = mediaUrls.uploadUrl
      elements.editorForm.dataset.mediaAssetBaseUrlValue = mediaUrls.assetBaseUrl
      elements.editorField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(documentTitles)
      const visualButton = document.querySelector("#visual-mode") as HTMLButtonElement
      visualButton.disabled = true
      visualButton.title = "Rendering preview…"
      elements.editorInput.disabled = false
      shellElement<HTMLElement>("#deck-id").textContent = deck.id
      elements.editorForm.dataset.loadedDeckId = deck.id
      const notice = document.querySelector("#deck-notice") as HTMLElement
      notice.textContent = deck.notices.join(" ")
      notice.hidden = deck.notices.length === 0
      elements.library.hidden = true
      elements.deckView.hidden = false
      document.body.dataset.desktopView = "editor"
      shellElement<HTMLElement>("#breadcrumb-current").textContent = deck.name
      setStatus("Deck opened")
      if (viewSetupStartedAt !== null) recordOpenStage("deckViewSetup", viewSetupStartedAt)
      await measureOpenStage("previewRefresh", () => elements.editorForm.previewController?.refresh())
      return true
    } catch (error) {
      showError(error)
      return false
    }
  }

  async function renameDeck(deck: FileLibraryDeck, name: string): Promise<any> {
    if (typeof name !== "string" || name.trim() === deck.name) return
    const renamed = await fileLibrary.renameDeck(deck.id, name.trim())
    if (activeDeck && activeDeck.id === deck.id) Object.assign(activeDeck, renamed)
    decks = decks.map(item => item.id === deck.id ? { ...item, ...renamed } : item)
    await shell.refresh()
    return renamed
  }

  // Card rename/delete run inside the client through the host adapter; the
  // host only keeps its editor-side caches consistent and reports status.
  function handleLibraryEvent(event: any): void {
    if (event.type === "renamed") {
      if (activeDeck && activeDeck.id === event.work.id) Object.assign(activeDeck, { name: event.work.title })
      decks = decks.map(item => item.id === event.work.id ? { ...item, name: event.work.title } : item)
    }
    if (event.type === "deleted") {
      if (activeDeck?.id === event.work.id) {
        activeDeck = null
        closeSession()
      }
      decks = decks.filter(item => item.id !== event.work.id)
      setStatus(`Moved “${event.work.title}” to Trash`)
    }
    if (currentFilter() === "documents") void showDocumentGraph()
  }

  function showImportConflict(error: any): void {
    const incoming = error.details?.incoming_name || "This deck"
    const existing = error.details?.existing_name || "an existing deck"
    elements.importConflictMessage.textContent = `“${incoming}” has the same identity as “${existing}”.`
    elements.importConflictDialog.showModal()
  }

  async function completeImport(imported: any): Promise<void> {
    if (imported.replaced && activeDeck?.id === imported.deck.id) {
      activeDeck = null
      closeSession()
      showLibrary()
    }
    await refreshLibrary()
    setStatus((imported.replaced ? "Replaced" : "Imported") + ` “${imported.deck.name}”`)
    if (imported.name_collision) {
      showNotice(`A deck with an equivalent name already exists. Imported as “${imported.deck.name}”.`, "warning")
    }
  }

  async function processOpenedFiles(): Promise<void> {
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
            if ((error as { code?: unknown } | null)?.code === "invalid_library") {
              await chooseLibrary()
              if (library) continue
            } else if ((error as { code?: unknown } | null)?.code === "import_conflict") {
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

  function scheduleSave(): void {
    saveFlow?.noteChange()
  }

  function materializePendingVisualEdits(): void {
    const editor = editorFor(elements.editorField)
    if (editor?.editorReady) editor.projectionController()?.flushPendingProjectionEdits?.()
  }

  function hasUnsavedChanges(): boolean {
    materializePendingVisualEdits()
    return Boolean(saveFlow?.dirty || titleFlow?.isDirty())
  }

  async function flushSave(options?: any): Promise<boolean> {
    hasUnsavedChanges()
    if (titleFlow && !(await titleFlow.flush(options))) return false
    if (!saveFlow) return true
    const result = await saveFlow.flush(options)
    return result.kind === "clean" || result.kind === "saved"
  }

  async function flushForClose(): Promise<string> {
    hasUnsavedChanges()
    if (titleFlow && !(await titleFlow.flush())) return "failed"
    if (!saveFlow) return "saved"
    const result = await saveFlow.flush()
    if (result.kind === "clean" || result.kind === "saved") return "saved"
    if (result.kind === "conflict") return "conflict"
    return "failed"
  }

  function showConflict(conflict: any): void {
    const dialog = elements.editorForm.querySelector("#conflict-dialog") as HTMLDialogElement
    presentConflictDialog(dialog, {
      message: "The source file changed outside Elef. Choose which version to keep, or edit a merge.",
      localSource: conflict.localSource,
      diskSource: conflict.diskSource,
      diskSourceFile: conflict.diskSourceFile,
      mergeSource: currentSource()
    })
  }

  function currentSource(): string {
    return editorFor(elements.editorField)?.sourceValue ?? elements.editorInput.value
  }

  async function showSettings(): Promise<void> {
    try {
      libraryConfig = await fileLibrary.readLibraryConfig()
      elements.libraryTheme.value = libraryConfig.theme
      elements.settingsDialog.showModal()
    } catch (error) {
      showError(error)
    }
  }

  async function saveSettings(event: SubmitEvent): Promise<void> {
    if ((event.submitter as HTMLButtonElement | null)?.value !== "save") return
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

  async function exportCurrentDeck(): Promise<void> {
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

  async function importDeck(): Promise<void> {
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
      if ((error as { code?: unknown } | null)?.code === "import_conflict") {
        showImportConflict(error)
        return
      }
      showError(error)
    }
  }

  async function resolveImportConflict(resolution: string): Promise<void> {
    elements.importConflictDialog.close()
    try {
      const imported = await fileLibrary.resolveImportConflict(resolution)
      if (imported) await completeImport(imported)
      void processOpenedFiles()
    } catch (error) {
      showError(error)
    }
  }

  async function checkForUpdates(showNoUpdate = true): Promise<boolean> {
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

  async function installUpdate(): Promise<void> {
    if (!pendingUpdate || updateInstalling) return
    updateInstalling = true
    const button = document.querySelector("#install-update") as HTMLButtonElement
    const later = document.querySelector("#update-later") as HTMLButtonElement
    button.disabled = true
    later.disabled = true
    try {
      const installed = await installPendingUpdate(pendingUpdate, {
        prepare: async () => !hasUnsavedChanges() || await flushSave({ force: true }),
        onProgress: (event: any) => {
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

  async function printCurrentDeck(): Promise<void> {
    if (!activeDeck) {
      showNotice("Open a deck before printing it.")
      return
    }
    if (hasUnsavedChanges() && !(await flushSave())) return
    const preview = document.querySelector("#desktop-preview") as HTMLElement
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

  // Present mode runs on the shared client presentation mount (the retired
  // Stimulus "presentation" controller is gone). The mount persists across
  // decks on this form; start() re-discovers the live projection slides and
  // preview re-renders resync scaling plus navigation while presenting.
  let presentationMount: any = null

  function presentationStage(): HTMLElement | null {
    return elements.editorForm.querySelector(".presentation-editor-projection") as HTMLElement | null
  }

  // renderEditorView rebuilds the projection on every deck open, so each
  // present starts from a fresh mount bound to the live projection element.
  let presentationResyncListening = false

  function mountFreshPresentation(): any {
    presentationMount?.destroy()
    presentationMount = mountPresentation(elements.editorForm, {
      getStage: presentationStage,
      document
    })
    if (!presentationResyncListening) {
      presentationResyncListening = true
      elements.editorForm.addEventListener("elef:preview-updated", resyncPresentationMount)
    }
    return presentationMount
  }

  function resyncPresentationMount(): void {
    presentationMount?.resync()
  }

  async function startPresentation(): Promise<void> {
    if (!activeDeck || activeDeck.source_file === "document.md") {
      showNotice("Open a presentation deck to start presentation mode.")
      return
    }
    if (!(await elements.editorForm.previewController?.refresh())) {
      showNotice("Render the presentation before starting presentation mode.", "error")
      return
    }
    const presentation = mountFreshPresentation()
    if (!presentation.controller.start()) {
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
      presentationStage()?.focus({ preventScroll: true })
    }
  }

  function presentationKeydown(event: KeyboardEvent): void {
    if (!document.body.classList.contains("presenting-deck")) return
    if (event.key !== "Escape") return
    event.preventDefault()
    void exitPresentation()
  }

  async function exitPresentation(): Promise<void> {
    if (!document.body.classList.contains("presenting-deck")) return
    document.body.classList.remove("presenting-deck")
    elements.presentationExit.hidden = true
    document.removeEventListener("keydown", presentationKeydown, true)
    presentationMount?.destroy()
    presentationMount = null
    try {
      await getCurrentWindow().setFullscreen(false)
    } catch (_error) {}
  }

  if ((typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) {
    globalThis.__elefPresentationTestHooks = { start: startPresentation }
  }

  async function resolveConflictWithDisk(): Promise<void> {
    if (!await saveFlow.useDiskVersion()) return
    syncSourceLabel()
    const conflictDialog = elements.editorForm.querySelector("#conflict-dialog") as HTMLDialogElement
    conflictDialog.close()
  }

  function resolveConflictWithLocal(): void {
    if (!saveFlow.keepLocalVersion()) return
    syncSourceLabel()
    const conflictDialog = elements.editorForm.querySelector("#conflict-dialog") as HTMLDialogElement
    conflictDialog.close()
  }

  async function resolveConflictWithMerge(): Promise<void> {
    const mergedSource = (elements.editorForm.querySelector("#conflict-merge") as HTMLTextAreaElement).value
    if (!await saveFlow.saveMergedVersion(mergedSource)) return
    syncSourceLabel()
    const conflictDialog = elements.editorForm.querySelector("#conflict-dialog") as HTMLDialogElement
    conflictDialog.close()
  }

  function syncSourceLabel(): void {
    if (!activeDeck) return
    shellElement<HTMLElement>("#deck-source-name").textContent = activeDeck.source_file
    shellElement<HTMLElement>("#deck-kind").textContent = activeDeck.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION"
  }

  async function handleMenuAction(action: string): Promise<any> {
    if (action === "quit") return getCurrentWindow().close()
    if (action === "choose-library") return chooseLibrary()
    if (action === "refresh-library") return refreshLibrary()
    if (action === "open-deck") {
      if (!library) return chooseLibrary()
      if (hasUnsavedChanges() && !(await flushSave())) return
      showLibrary()
      mount.querySelector<HTMLElement>("#library-search")?.focus()
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

  shellElement<HTMLElement>("#choose-library").addEventListener("click", () => void chooseLibrary())
  shellElement<HTMLElement>("#change-library").addEventListener("click", () => void chooseLibrary())
  shellElement<HTMLElement>(".brand").addEventListener("click", event => {
    event.preventDefault()
    shellElement<HTMLElement>("#back-to-library").click()
  })
  shellElement<HTMLElement>("#open-settings").addEventListener("click", () => void showSettings())
  shellElement<HTMLElement>("#new-deck").addEventListener("click", () => {
    showCreateDialog(currentFilter() === "documents" ? "document" : "presentation")
  })
  shellElement<HTMLElement>("#refresh-library").addEventListener("click", () => void refreshLibrary())
  shellElement<HTMLElement>("#import-elef").addEventListener("click", () => void importDeck())
  shellElement<HTMLElement>("#back-to-library").addEventListener("click", () => {
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
  elements.settingsForm.addEventListener("submit", event => void saveSettings(event))
  shellElement<HTMLElement>("#manage-authoring").addEventListener("click", () => {
    elements.settingsDialog.close()
    void openAuthoringSettings()
  })
  shellElement<HTMLElement>("#check-for-updates").addEventListener("click", () => void checkForUpdates(true))
  shellElement<HTMLElement>("#install-update").addEventListener("click", () => void installUpdate())
  elements.presentationExit.addEventListener("click", () => void exitPresentation())
  shellElement<HTMLElement>("#update-later").addEventListener("click", () => elements.updateDialog.close())
  elements.updateDialog.addEventListener("cancel", event => {
    if (updateInstalling) event.preventDefault()
  })
  elements.updateDialog.addEventListener("close", () => {
    const update = pendingUpdate
    pendingUpdate = null
    void update?.dispose().catch(() => {})
  })
  shellElement<HTMLElement>("#import-conflict-replace").addEventListener("click", () => void resolveImportConflict("replace"))
  shellElement<HTMLElement>("#import-conflict-keep-both").addEventListener("click", () => void resolveImportConflict("keep_both"))
  shellElement<HTMLElement>("#import-conflict-cancel").addEventListener("click", () => void resolveImportConflict("cancel"))
  elements.editorField.addEventListener("input", () => scheduleSave())
  elements.titleInput.addEventListener("input", () => titleFlow.noteChange())
  const useDiskButton = elements.editorForm.querySelector("#use-disk-version") as HTMLElement
  useDiskButton.addEventListener("click", resolveConflictWithDisk)
  const keepLocalButton = elements.editorForm.querySelector("#keep-local-version") as HTMLElement
  keepLocalButton.addEventListener("click", resolveConflictWithLocal)
  const saveMergedButton = elements.editorForm.querySelector("#save-merged-version") as HTMLElement
  saveMergedButton.addEventListener("click", resolveConflictWithMerge)
  const conflictCancelDialog = elements.editorForm.querySelector("#conflict-dialog") as HTMLDialogElement
  conflictCancelDialog.addEventListener("cancel", event => {
    if (saveFlow?.conflict) event.preventDefault()
  })
  elements.restoreDraft.addEventListener("click", () => {
    void saveFlow?.restoreDraft()
  })
  window.addEventListener("blur", () => void flushSave())
  void getCurrentWindow().onCloseRequested(createCloseFlow({
    isDirty: () => hasUnsavedChanges(),
    flushForClose,
    close: () => getCurrentWindow().close(),
    confirmDiscard: () => fileLibrary.confirmDiscardUnsavedChanges(),
    onError: showError
  }))

  window.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault()
      mount.querySelector<HTMLElement>("#library-search")?.focus()
    }
  })

  void listen("desktop-menu-action", (event: any) => void handleMenuAction(event.payload))
  const openedFileListener = listen("desktop-open-elef", () => void processOpenedFiles())
  async function mountLibrary(status: any): Promise<void> {
    // The desktop writes #library/<filter> hashes on tab switches; boot from
    // the live URL so a reload restores the same filter.
    libraryHost = createLibraryHost(status)
    shell = await mountElef(mount, libraryHost, {
      initialUrl: location.href,
      // The desktop has no URL routing: work targets open in the embedded
      // editor, tab targets only move the location hash for deep-linking.
      navigate: target => {
        if (!("url" in target)) {
          void openDeck(target.workId)
          return
        }
        if (target.url.startsWith("#")) location.hash = target.url
        if (parseLibraryRoute(target.url)?.filter === "documents") void showDocumentGraph()
      },
      resolveMediaBaseUrl: work => mediaUrlsForDeck(work.id).assetBaseUrl,
      presentWork: work => {
        void openDeck(work.id).then(opened => {
          if (opened) void startPresentation()
        })
      },
      onLibraryEvent: handleLibraryEvent
    })
  }

  void completeBootstrap({
    initialize: async () => {
      // Status first: the client's mount fires its own initial load, and
      // racing that listing against this one serialized both on the native
      // side. Mounting on the measured status hands the client its first
      // list with zero extra IPC.
      const [status] = await measureBootstrapStage("library-status", () => Promise.all([fileLibrary.getLibraryStatus(), openedFileListener]))
      library = status
      libraryConfig = status?.config || libraryConfig
      decks = (status?.decks || []).map(ensureDeckHash)
      await mountLibrary(status)
      applyTheme(libraryConfig.theme)
      measureBootstrapStage("initial-library-render", showLibrary)
      if (status?.config_notice) showNotice(status.config_notice, "error")
      setStatus(library ? `${decks.length} ${decks.length === 1 ? "deck" : "decks"}` : "Choose a library folder to begin")
      libraryStatusLoaded = true
    },
    waitForPaint: () => measureBootstrapStage("initial-paint", () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
    markInteractive: () => {
      if ((typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) window.__elefPerformanceTestHooks?.interactive()
    },
    waitForEditor: async () => {
      // Prewarm the preview worker off the interactive path: the library no
      // longer renders card previews through it, so without this the first
      // deck open pays the cold-worker spawn and bundle parse.
      void renderer.warmup()
      await measureBootstrapStage("editor-runtime", () => registerEditorRuntime())
      configureEditorKind(elements.editorField.closest(".editor-shell"), "presentation", {
        showTitle: true,
        formControllers: "preview visual-editor slide-overview media"
      })
      await measureBootstrapStage("editor-ready", () => waitForEditorController(elements.editorField, editorFor))
    },
    confirmReady: async () => {
      const removed = await measureBootstrapStage("native-ready-ack", () => fileLibrary.confirmAppReady())
      if ((typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) window.__elefPerformanceTestHooks?.ready(removed)
      void fileLibrary.pendingOpenedElefCount()
        .then((count: any) => { if (count) void processOpenedFiles() })
        .catch(showError)
      startupUpdateCheck.schedule(10_000)
    }
  }).catch(showError)

}

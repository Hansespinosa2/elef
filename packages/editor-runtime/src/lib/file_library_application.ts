import { createWorkOpenFlow, prepareWorkOpen } from "./work_open_flow.js"
import { measurePaintedAction } from "./performance_measurement.js"
import { editorFor } from "./editor_controller_lookup.js"
import { createRequestGuard } from "./request_identity.js"
import { waitForEditorController } from "./editor_ready.js"
import { createWorkSession, createTitleSaveFlow } from "@elef/client"
import { createCodeMirrorBinding } from "./editor_binding.js"
import { presentConflictDialog } from "./conflict_dialog.js"
import { createRendererClient } from "./renderer_worker_client.js"
import { applyDesktopFeatureFlags } from "./feature_flags.js"
import { configureEditorKind, enableVisualModeFromInstalledPreview, renderEditorView } from "./editor_view.js"
import { CREATE_WORK_EVENT, mountElef, mountPresentation, mountVimSettings, parseLibraryRoute } from "@elef/client"
import type { GraphController } from "@elef/client"

export interface WorkFolder {
  id: string;
  name: string;
  source: string;
  source_file: string;
  content_hash: string;
  notices: string[];
  kind?: string;
  [key: string]: any;
}

// The native bridge omits content_hash for unhashed work folders; normalize at
// entry so every work folder in the system carries a hash. Empty string means
// "unknown": it never equals a real revision, so staleness checks treat
// hashless work folders as changed (the safe direction), and work_session declines
// sessions for them exactly as it would for undefined.
function ensureWorkFolderHash(workFolder: Omit<WorkFolder, "content_hash"> & { content_hash?: string }): WorkFolder {
  workFolder.content_hash ??= ""
  // The ensure above guarantees content_hash at runtime; the cast records
  // what it established (TypeScript cannot narrow the object from it).
  return workFolder as WorkFolder
}

export interface FileLibraryStatus {
  root: string;
  config?: any;
  config_notice?: string;
  work_folders: WorkFolder[];
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
  mediaUrlsForWorkFolder: any;
  checkForUpdate: any;
  createIdleUpdateCheck: any;
  installPendingUpdate: any;
  updateRuntime?: any;
  desktopAuthoringRegistry: any;
  loadDesktopAuthoringRegistry: any;
  quietSavePolicy: any;
  registerEditorRuntime: any;
  authoringTransport?: any;
  updaterSeam?: any;
  recordBootstrapFailure?: any;
  // Stable/Dev profile contract (desktop entry/build boundary only; no Rails
  // behavior varies by profile). features selects the capability subset,
  // featureFlags the deferred-feature flag values, and the two runtimes carry
  // the excluded feature implementations: the Dev entry injects the real
  // runtimes, the Stable entry injects null, so the Stable bundle never
  // imports the excluded slices.
  profile?: any;
  features?: any;
  featureFlags?: any;
  documentGraphRuntime?: any;
  presentationEditorRuntime?: any;
  updateEnabled?: any;
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
    mediaUrlsForWorkFolder, checkForUpdate, createIdleUpdateCheck, installPendingUpdate,
    desktopAuthoringRegistry, loadDesktopAuthoringRegistry, quietSavePolicy,
    registerEditorRuntime, recordBootstrapFailure,
    features, featureFlags, documentGraphRuntime, presentationEditorRuntime,
    updateEnabled = true, updateRuntime = null
  } = platform

  const desktopFeatures = Object.freeze({
    visualEditing: features?.visualEditing !== false,
    presentationEditing: features?.presentationEditing !== false,
    slideOverview: features?.slideOverview !== false,
    documentGraph: features?.documentGraph !== false && Boolean(documentGraphRuntime),
    documentLinks: features?.documentLinks !== false
  })
  const editorFormControllers = [
    "preview",
    ...(desktopFeatures.visualEditing ? ["visual-editor"] : []),
    ...(desktopFeatures.slideOverview ? ["slide-overview"] : []),
    "media"
  ].join(" ")
  applyDesktopFeatureFlags(document, featureFlags)
  if (!updateEnabled) document.querySelector("#check-for-updates")?.remove()

  const renderer = createRendererClient()
  const readPreviewTrace = installFetchTransport({
    renderer,
    getContext: async (source: string) => ({
      kind: activeWorkFolder?.source_file === "document.md" ? "document" : "presentation",
      title: document.querySelector<HTMLInputElement>("#desktop-editor-title")?.value.trim() || activeWorkFolder?.name || "Untitled",
      workId: activeWorkFolder?.id || "",
      mediaBaseUrl: activeWorkFolder ? mediaUrlsForWorkFolder(activeWorkFolder).assetBaseUrl : "",
      documentNodes: await previewDocumentNodes(source)
    })
  })

  renderEditorView(document.querySelector("#desktop-editor-mount"), {
    kind: "presentation",
    source: "",
    sourceName: "presentation[source]",
    mode: desktopFeatures.visualEditing ? "visual" : "source",
    visualDisabled: true,
    visualDisabledMessage: "Open a Work to render its preview",
    showTitle: true,
    showSubmit: false,
    showSaveStatus: false,
    persisted: false,
    desktopFeatures,
    authoringRegistry: desktopAuthoringRegistry(),
    documentTitles: [],
    ids: {
      field: "desktop-editor-field",
      source: "work-source",
      surface: "work-source-editor",
      label: "work-source-label",
      title: "desktop-editor-title",
      visualMode: "visual-mode",
      sourceMode: "source-mode",
      theme: "work-theme",
      typography: "work-typography",
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
    workView: document.querySelector("#work-view") as HTMLElement,
    workTitle: document.querySelector("#work-title") as HTMLElement,
    status: document.querySelector("#status-text") as HTMLElement,
    settingsDialog: document.querySelector("#settings-dialog") as HTMLDialogElement,
    settingsForm: document.querySelector("#settings-form") as HTMLFormElement,
    libraryTheme: document.querySelector("#library-theme") as HTMLSelectElement,
    aboutDialog: document.querySelector("#about-dialog") as HTMLDialogElement,
    editorField: document.querySelector("#desktop-editor-field") as HTMLElement,
    editorForm: document.querySelector("#desktop-editor-form") as HTMLFormElement,
    editorInput: document.querySelector("#work-source") as HTMLTextAreaElement,
    titleInput: document.querySelector("#desktop-editor-title") as HTMLInputElement,
    restoreDraft: document.querySelector("#restore-local-draft") as HTMLButtonElement,
    importConflictDialog: document.querySelector("#import-conflict-dialog") as HTMLDialogElement,
    importConflictMessage: document.querySelector("#import-conflict-message") as HTMLElement,
    updateDialog: document.querySelector("#update-dialog") as HTMLDialogElement,
    updateVersion: document.querySelector("#update-version") as HTMLElement,
    updateNotes: document.querySelector("#update-notes") as HTMLElement,
    updateProgress: document.querySelector("#update-progress") as HTMLElement,
    presentationExit: document.querySelector("#exit-presentation") as HTMLButtonElement,
    presentationStart: document.querySelector("#start-presentation") as HTMLButtonElement
  }

  let library: FileLibraryStatus | null = null
  let libraryConfig = { schema_version: 1, theme: "dark", hotkeys: {} }
  let workFolders: WorkFolder[] = []
  let activeWorkFolder: WorkFolder | null = null
  let presentationEditorHandle: any = null
  let saveFlow: any = null
  let sessionStatusKind = "clean"
  let lastSourceFile: string | null = null
  let e2eNextSaveDelayMs = 0
  const documentGraphCache = desktopFeatures.documentGraph
    ? documentGraphRuntime.createCache(async () => documentGraphRuntime.build(await fileLibrary.readDocumentGraph()))
    : null
  let pendingUpdate: any = null
  let libraryStatusLoaded = false
  let processingOpenedFiles = false
  let openFilesRequested = false
  let openFilesWaitingForSave = false
  let titleFlow: any = null
  const startupUpdateCheck = createIdleUpdateCheck(
    () => checkForUpdates(false),
    () => !elements.workView.hidden
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
      ...(updateEnabled && platform.updaterSeam ? { updater: platform.updaterSeam } : {})
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
      const isDocument = workFolders.find(workFolder => workFolder.id === id)?.source_file === "document.md"
      if ((typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) && e2eNextSaveDelayMs > 0) {
        const delay = e2eNextSaveDelayMs
        e2eNextSaveDelayMs = 0
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      const result = await transport.saveSource(id, source)
      if (isDocument) documentGraphCache?.invalidate()
      return result
    }
  }
  function openSession(workFolder: WorkFolder): void {
    closeSession()
    lastSourceFile = workFolder.source_file
    const adapter = createCodeMirrorBinding({
      getEditor: () => editorFor(elements.editorField),
      getWorkId: () => activeWorkFolder?.id,
      getFallbackValue: () => elements.editorInput.value,
      setFallbackValue: value => { elements.editorInput.value = value },
      waitForEditor: () => waitForEditorController(elements.editorField, editorFor),
      materializeEdits: materializePendingVisualEdits
    })
    const session = createWorkSession({
      transport: sessionTransport,
      policy: {
        workId: workFolder.id,
        kind: workFolder.source_file === "document.md" ? "document" : "presentation",
        work: workFolder,
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
      if (activeWorkFolder && activeWorkFolder.source_file !== lastSourceFile) {
        lastSourceFile = activeWorkFolder.source_file
        syncSourceLabel()
      }
      if (status.kind === "clean" && openFilesWaitingForSave) {
        openFilesWaitingForSave = false
        queueMicrotask(() => void processOpenedFiles())
      }
    })
    session.onExternalChange((snapshot: any) => {
      if (snapshot.removed || !activeWorkFolder) return
      if (activeWorkFolder.source_file === "document.md" &&
          (snapshot.baseline.revision !== activeWorkFolder.content_hash || snapshot.sourceFile !== activeWorkFolder.source_file)) {
        documentGraphCache?.invalidate()
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
    getWork: () => activeWorkFolder,
    getTitle: () => elements.titleInput.value,
    renameWork,
    onRenamed: (renamed: any) => {
      elements.workTitle.textContent = renamed.name
      shellElement<HTMLElement>("#breadcrumb-current").textContent = renamed.name
    },
    onState: () => {},
    onError: showError
  })

  const bootstrapStages: StageMeasurement[] = []
  const openStageMeasurements: StageMeasurement[] = []

  function measureStage(start: () => () => void, action: () => any): any {
    if (!(typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) return action()

    const record = start()
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

  function measureBootstrapStage(name: string, action: () => any): any {
    return measureStage(() => {
      const startedAt = performance.now()
      return () => bootstrapStages.push({ name, milliseconds: performance.now() - startedAt })
    }, action)
  }

  function measureOpenStage(name: string, action: () => any): any {
    return measureStage(() => {
      const startedAt = performance.now()
      return () => recordOpenStage(name, startedAt)
    }, action)
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
            await openWork(id)
            if (activeWorkFolder?.id !== id || elements.editorForm.dataset.loadedWorkId !== id ||
                shellElement<HTMLButtonElement>("#visual-mode").disabled) throw new Error("The measured Work did not finish rendering.")
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
            return { total: workFolders.length, rendered: document.querySelectorAll("#work-list .library-card").length }
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
    elements.workView.hidden = true
    elements.libraryName.textContent = library ? library.root.split(/[\\/]/).filter(Boolean).at(-1) || library.root : "No library selected"
    shellElement<HTMLButtonElement>("#new-work").disabled = !library
    shellElement<HTMLButtonElement>("#import-elef").disabled = !library
    shellElement<HTMLElement>("#breadcrumb-current").textContent = "Works"
    // The first show preserves the boot filter (a deep-linked tab); every
    // return home resets to All and reloads, so cards and previews reflect
    // saves made in the editor (the pre-client card pass re-read preview
    // sources on every return; the client caches by revision and needs
    // the explicit reload to see them).
    if (libraryShown) {
      shell.setFilter("all")
      void refreshLibrary()
    } else libraryShown = true
    if (updateEnabled) void startupUpdateCheck.resume()
  }

  // The client owns the active tab; the host reads it back from the settled
  // DOM whenever a refresh or library event needs the graph decision.
  function currentFilter(): string {
    return mount.querySelector<HTMLElement>("[data-library-tab][aria-current='page']")?.dataset.libraryTab ?? "all"
  }

  async function documentGraphData(): Promise<any> {
    return documentGraphCache?.get() || { nodes: [], edges: [] }
  }

  async function previewDocumentNodes(source: string): Promise<any[]> {
    if (!desktopFeatures.documentGraph || !source.includes("[[")) return []
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
    if (!library || !desktopFeatures.documentGraph) return
    const request = graphRequests.request()
    try {
      const graph = await documentGraphData()
      // Reject stale results: navigation away from the library or a newer
      // graph request supersedes this payload.
      if (!graphRequests.isCurrent(request) || !libraryShown) return
      const slot = mount.querySelector("#document-graph-view") as HTMLElement | null
      if (!slot) return
      graphController?.destroy()
      documentGraphRuntime.renderGraphView(slot, graph)
      graphController = new documentGraphRuntime.GraphController(slot, graph, { onOpenWork: (id: string) => void openWork(id) })
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
      const [listedWorkFolders] = await Promise.all([
        fileLibrary.listWorkFolders(),
        loadDesktopAuthoringRegistry()
      ])
      workFolders = listedWorkFolders.map(ensureWorkFolderHash)
      documentGraphCache?.invalidate()
      libraryHost?.noteListedWorkFolders(listedWorkFolders)
      await shell.refresh()
      if (currentFilter() === "documents") await showDocumentGraph()
      setStatus(`${workFolders.length} ${workFolders.length === 1 ? "Work" : "Works"}`)
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
      documentGraphCache?.invalidate()
      libraryConfig = selected.config || libraryConfig
      workFolders = selected.work_folders.map(ensureWorkFolderHash)
      applyTheme(libraryConfig.theme)
      showLibrary()
      if (selected.config_notice) showNotice(selected.config_notice, "error")
      setStatus(`${workFolders.length} ${workFolders.length === 1 ? "Work" : "Works"}`)
      if (await fileLibrary.pendingOpenedElefCount()) void processOpenedFiles()
    } catch (error) {
      showError(error)
    }
  }

  // The create dialog is client-owned; the host only requests it. Creation
  // itself flows through the host adapter, then the navigate adapter opens
  // the new work, matching the old create-then-open sequence.
  function showCreateDialog(kind = "presentation") {
    mount.querySelector(".library-shared-view")?.dispatchEvent(
      new CustomEvent(CREATE_WORK_EVENT, { detail: { kind } })
    )
  }

  const openWork = createWorkOpenFlow(openWorkNow)

  async function openWorkNow(id: string): Promise<boolean> {
    // Hide the library before the first await: pending card-preview idle
    // callbacks would otherwise spend fetches and main-thread renders
    // through the whole open. Every early exit below restores visibility;
    // the success path leaves the editor swap in charge and failures return
    // through showLibrary.
    const libraryWasHidden = elements.library.hidden
    elements.library.hidden = true
    const restoreLibrary = () => { elements.library.hidden = libraryWasHidden }
    try {
      if (document.body.classList.contains("presenting-work")) await exitPresentation()
      elements.editorForm.previewController?.finishEditing()
      await Promise.resolve()
      if (activeWorkFolder && hasUnsavedChanges() && !(await flushSave())) { restoreLibrary(); return false }
      delete elements.editorForm.dataset.loadedWorkId
      let transition: { work: WorkFolder; prepared: unknown; revision: unknown } | null
      do {
        transition = await prepareWorkOpen<string, WorkFolder>(id, {
          read: target => measureOpenStage("readWork", () => transport.readWorkFolder(target)),
          isDirty: hasUnsavedChanges,
          getRevision: () => saveFlow?.revision ?? 0,
          flushSave,
          prepare: work => measureOpenStage("prepareWork", async () => {
            await registerEditorRuntime()
            let documentTitles: string[] = []
            if (desktopFeatures.documentGraph && (work.source_file === "document.md" || work.source.includes("[["))) {
              try {
                const graph = await documentGraphData()
                documentTitles = work.source_file === "document.md" ? graph.nodes.map((node: any) => node.title) : []
              } catch (_error) {
                documentTitles = work.source_file === "document.md"
                  ? workFolders.filter(item => item.kind === "document").map(item => item.name) : []
              }
            }
            return { documentTitles }
          })
        })
      } while (transition && (hasUnsavedChanges() || (saveFlow?.revision ?? 0) !== transition.revision))
      if (!transition) {
        if (activeWorkFolder) elements.editorForm.dataset.loadedWorkId = activeWorkFolder.id
        restoreLibrary()
        return false
      }
      const { work, prepared } = transition
      const { documentTitles } = prepared as { documentTitles: string[] }
      const isDocument = work.source_file === "document.md"
      if (work.id !== id) {
        workFolders = workFolders.map(item => item.id === id ? { ...item, id: work.id } : item)
        documentGraphCache?.invalidate()
        void shell.refresh()
      }
      // All asynchronous work is finished. Installing the buffer and changing
      // save ownership occur in one synchronous turn, with no stale A buffer
      // able to schedule a write for B during graph/controller preparation.
      closeSession()
      activeWorkFolder = null
      try {
        configureEditorKind(elements.editorField.closest(".editor-shell"), isDocument ? "document" : "presentation", {
          documentTitles,
          sourceName: isDocument ? "document[source]" : "presentation[source]",
          showTitle: true,
          formControllers: editorFormControllers,
          documentLinksEnabled: desktopFeatures.documentLinks,
          visualEditingEnabled: desktopFeatures.visualEditing,
          presentationEditingEnabled: desktopFeatures.presentationEditing,
          slideOverviewEnabled: desktopFeatures.slideOverview
        })
        const editor = await measureOpenStage("editorReady", () => editorFor(elements.editorField)?.editorReady
          ? editorFor(elements.editorField)
          : waitForEditorController(elements.editorField, editorFor))
        measureOpenStage("loadDocument", () => {
          editor.loadDocument(work.source)
          editor.setEditingMode(desktopFeatures.visualEditing ? "visual" : "source", { restoreCaret: false })
        })
      } catch (error) {
        elements.editorInput.disabled = true
        showLibrary()
        throw error
      }
      // The shared client presentation editor only handles presentation
      // works: mount it when one opens and destroy it when a document work
      // opens so it never double-handles document projection input beside
      // the document editor.
      if (isDocument) {
        presentationEditorHandle?.destroy()
        presentationEditorHandle = null
      } else if (desktopFeatures.presentationEditing && presentationEditorRuntime && !presentationEditorHandle) {
        presentationEditorHandle = presentationEditorRuntime.mount(elements.editorForm)
      }
    const viewSetupStartedAt = (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) ? performance.now() : null
      transport.activateWorkFolder(work, id)
      activeWorkFolder = work
      openSession(work)
      elements.workTitle.textContent = work.name
      elements.workTitle.hidden = !isDocument
      elements.titleInput.value = work.name
      syncSourceLabel()
      elements.editorField.dataset.editorInitialSourceValue = JSON.stringify(work.source)
      const mediaUrls = mediaUrlsForWorkFolder(work)
      elements.editorForm.dataset.previewUrlValue = mediaUrls.previewUrl
      elements.editorForm.dataset.mediaEnabledValue = "true"
      elements.editorForm.dataset.mediaWorkKindValue = work.source_file === "document.md" ? "document" : "presentation"
      elements.editorForm.dataset.mediaUploadUrlValue = mediaUrls.uploadUrl
      elements.editorForm.dataset.mediaAssetBaseUrlValue = mediaUrls.assetBaseUrl
      if (desktopFeatures.documentLinks) elements.editorField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(documentTitles)
      const visualButton = document.querySelector("#visual-mode") as HTMLButtonElement | null
      if (visualButton && desktopFeatures.visualEditing) {
        visualButton.disabled = true
        visualButton.title = "Rendering preview…"
      }
      elements.editorInput.disabled = false
      shellElement<HTMLElement>("#work-id").textContent = work.id
      elements.editorForm.dataset.loadedWorkId = work.id
      const notice = document.querySelector("#work-notice") as HTMLElement
      notice.textContent = work.notices.join(" ")
      notice.hidden = work.notices.length === 0
      elements.library.hidden = true
      elements.workView.hidden = false
      elements.presentationStart.hidden = isDocument
      document.body.dataset.desktopView = "editor"
      shellElement<HTMLElement>("#breadcrumb-current").textContent = work.name
      setStatus("Work opened")
      if (viewSetupStartedAt !== null) recordOpenStage("workViewSetup", viewSetupStartedAt)
      await measureOpenStage("previewRefresh", () => elements.editorForm.previewController?.refresh())
      // The refresh skips its enable event while projection editing is
      // active, and the deferred install waits on a focusout that may never
      // come. Restore the toggle from the installed preview so the awaited
      // render cannot leave Visual permanently disabled.
      if (visualButton && desktopFeatures.visualEditing) enableVisualModeFromInstalledPreview(elements.editorForm)
      return true
    } catch (error) {
      showError(error)
      return false
    }
  }

  async function renameWork(workFolder: WorkFolder, name: string): Promise<any> {
    if (typeof name !== "string" || name.trim() === workFolder.name) return
    const renamed = await fileLibrary.renameWorkFolder(workFolder.id, name.trim())
    if (activeWorkFolder && activeWorkFolder.id === workFolder.id) Object.assign(activeWorkFolder, renamed)
    workFolders = workFolders.map(item => item.id === workFolder.id ? { ...item, ...renamed } : item)
    await shell.refresh()
    return renamed
  }

  // Card rename/delete run inside the client through the host adapter; the
  // host only keeps its editor-side caches consistent and reports status.
  function handleLibraryEvent(event: any): void {
    if (event.type === "renamed") {
      if (activeWorkFolder && activeWorkFolder.id === event.work.id) Object.assign(activeWorkFolder, { name: event.work.title })
      workFolders = workFolders.map(item => item.id === event.work.id ? { ...item, name: event.work.title } : item)
    }
    if (event.type === "deleted") {
      if (activeWorkFolder?.id === event.work.id) {
        activeWorkFolder = null
        closeSession()
      }
      workFolders = workFolders.filter(item => item.id !== event.work.id)
      setStatus(`Moved “${event.work.title}” to Trash`)
    }
    if (currentFilter() === "documents") void showDocumentGraph()
  }

  function showImportConflict(error: any): void {
    const incoming = error.details?.incoming_name || "This Work"
    const existing = error.details?.existing_name || "an existing Work"
    elements.importConflictMessage.textContent = `“${incoming}” has the same identity as “${existing}”.`
    elements.importConflictDialog.showModal()
  }

  async function completeImport(imported: any): Promise<void> {
    if (imported.replaced && activeWorkFolder?.id === imported.work_folder.id) {
      activeWorkFolder = null
      closeSession()
      showLibrary()
    }
    await refreshLibrary()
    setStatus((imported.replaced ? "Replaced" : "Imported") + ` “${imported.work_folder.name}”`)
    if (imported.name_collision) {
      showNotice(`A Work with an equivalent name already exists. Imported as “${imported.work_folder.name}”.`, "warning")
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

  async function exportCurrentWork(): Promise<void> {
    if (!activeWorkFolder) {
      showNotice("Open a Work before exporting it.")
      return
    }
    if (hasUnsavedChanges() && !(await flushSave({ force: true }))) return
    try {
      if (await fileLibrary.exportElef(activeWorkFolder.id)) setStatus("Work exported")
    } catch (error) {
      showError(error)
    }
  }

  async function exportPptxCurrentWork(): Promise<void> {
    if (!activeWorkFolder) {
      showNotice("Open a Work before exporting it.")
      return
    }
    if (activeWorkFolder.source_file === "document.md") {
      showNotice("PowerPoint export is available for presentations.", "error")
      return
    }
    if (hasUnsavedChanges() && !(await flushSave({ force: true }))) return
    const status = shellElement<HTMLElement>("#export-pptx-status")
    try {
      status.textContent = "Preparing PowerPoint…"
      const saved = await fileLibrary.exportPptx(activeWorkFolder.id, {
        title: elements.titleInput.value.trim() || activeWorkFolder.name,
        source: currentSource()
      })
      if (saved) {
        status.textContent = "PowerPoint exported."
        setStatus("PowerPoint exported")
      } else {
        status.textContent = ""
      }
    } catch (error) {
      status.textContent = (error as { message?: unknown } | null)?.message as string || "The PowerPoint export failed."
      // Keep the failure diagnosable where the status toast cannot go: the
      // e2e harness cannot read the console, so the stack rides along.
      status.dataset.errorStack = String((error as { stack?: unknown } | null)?.stack ?? error).slice(0, 2000)
      console.error("[pptx-export]", error)
      showError(error)
    }
  }

  async function importWork(): Promise<void> {
    if (!library) {
      showNotice("Choose a library before importing a Work.")
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
    if (!updateEnabled) return false
    if (showNoUpdate) startupUpdateCheck.cancel()
    try {
      const update = await checkForUpdate()
      if (!update) {
        if (showNoUpdate) setStatus("Elef is up to date")
        return false
      }
      await pendingUpdate?.dispose().catch(() => {})
      pendingUpdate = update
      elements.updateVersion.textContent = "Version " + update.version + " is ready to install on quit."
      elements.updateNotes.textContent = update.notes
      elements.updateProgress.textContent = "The update signature will be verified before installation."
      elements.updateDialog.showModal()
      return true
    } catch (_error) {
      if (showNoUpdate) showError({ message: "Could not check for updates. Try again while online." })
      return false
    }
  }

  // Safe-quit arming: the update installs only during a safe ordinary quit,
  // after the quiet-save flush succeeds. Arming transfers the checked update
  // into the update runtime (which owns the pending state); the dialog close
  // handler then has nothing to dispose.
  async function armUpdateForQuit(): Promise<void> {
    if (!pendingUpdate || !updateRuntime) return
    const update = pendingUpdate
    pendingUpdate = null
    updateRuntime.armPendingUpdate(update)
    elements.updateDialog.close()
    setStatus(`Elef will install version ${update.version} when you quit.`)
  }

  async function printCurrentWork(): Promise<void> {
    if (!activeWorkFolder) {
      showNotice("Open a Work before printing it.")
      return
    }
    if (hasUnsavedChanges() && !(await flushSave())) return
    const preview = document.querySelector("#desktop-preview") as HTMLElement
    if (!preview.childElementCount && !(await elements.editorForm.previewController?.refresh())) {
      showNotice("Render the Work before printing it.", "error")
      return
    }
    document.body.classList.add("printing-work")
    await new Promise(resolve => requestAnimationFrame(resolve))
    window.addEventListener("afterprint", () => {
      document.body.classList.remove("printing-work")
    }, { once: true })
    window.print()
  }

  // Present mode runs on the shared client presentation mount (the retired
  // Stimulus "presentation" controller is gone). The mount persists across
  // works on this form; start() re-discovers the live projection slides and
  // preview re-renders resync scaling plus navigation while presenting.
  let presentationMount: any = null

  function presentationStage(): HTMLElement | null {
    return elements.editorForm.querySelector(".presentation-editor-projection") as HTMLElement | null
  }

  // renderEditorView rebuilds the projection on every work open, so each
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
    if (!activeWorkFolder || activeWorkFolder.source_file === "document.md") {
      showNotice("Open a presentation Work to start presentation mode.")
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
    document.body.classList.add("presenting-work")
    elements.presentationExit.hidden = false
    elements.presentationStart.hidden = true
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
    if (!document.body.classList.contains("presenting-work")) return
    if (event.key !== "Escape") return
    event.preventDefault()
    void exitPresentation()
  }

  async function exitPresentation(): Promise<void> {
    if (!document.body.classList.contains("presenting-work")) return
    document.body.classList.remove("presenting-work")
    elements.presentationExit.hidden = true
    elements.presentationStart.hidden = !activeWorkFolder || activeWorkFolder.source_file === "document.md"
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
    if (!activeWorkFolder) return
    shellElement<HTMLElement>("#work-source-name").textContent = activeWorkFolder.source_file
    shellElement<HTMLElement>("#work-kind").textContent = activeWorkFolder.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION"
    // PowerPoint export is presentation-only (export registry); documents
    // keep no PPTX option, and the handler gates the menu path as well.
    shellElement<HTMLElement>("#export-pptx").hidden = activeWorkFolder.source_file === "document.md"
  }

  async function handleMenuAction(action: string): Promise<any> {
    if (action === "quit") return getCurrentWindow().close()
    if (action === "choose-library") return chooseLibrary()
    if (action === "refresh-library") return refreshLibrary()
    if (action === "open-work") {
      if (!library) return chooseLibrary()
      if (hasUnsavedChanges() && !(await flushSave())) return
      showLibrary()
      mount.querySelector<HTMLElement>("#library-search")?.focus()
      return
    }
    if (action === "new-presentation") return showCreateDialog("presentation")
    if (action === "new-document") return showCreateDialog("document")
    if (action === "save") return flushSave({ force: true })
    if (action === "export-elef") return exportCurrentWork()
    if (action === "export-pptx") return exportPptxCurrentWork()
    if (action === "import-elef") return importWork()
    if (action === "settings") return showSettings()
    if (action === "check-for-updates") return checkForUpdates(true)
    if (action === "export-diagnostics") return fileLibrary.exportDiagnostics()
    if (action === "about") return elements.aboutDialog.showModal()
    if (action === "start-presentation") return startPresentation()
    if (action === "print") return printCurrentWork()
  }

  shellElement<HTMLElement>("#choose-library").addEventListener("click", () => void chooseLibrary())
  shellElement<HTMLElement>("#change-library").addEventListener("click", () => void chooseLibrary())
  shellElement<HTMLElement>(".brand").addEventListener("click", event => {
    event.preventDefault()
    shellElement<HTMLElement>("#back-to-library").click()
  })
  shellElement<HTMLElement>("#open-settings").addEventListener("click", () => void showSettings())
  shellElement<HTMLElement>("#new-work").addEventListener("click", () => {
    showCreateDialog(currentFilter() === "documents" ? "document" : "presentation")
  })
  shellElement<HTMLElement>("#refresh-library").addEventListener("click", () => void refreshLibrary())
  shellElement<HTMLElement>("#import-elef").addEventListener("click", () => void importWork())
  // The Export menu holds one option per format (the PPTX option hides for
  // documents in syncSourceLabel). Desktop export never navigates, so the
  // menu closes on activation, outside pointerdown, and Escape.
  function closeExportMenu(): void {
    shellElement<HTMLDetailsElement>("#export-menu").open = false
  }
  shellElement<HTMLElement>("#export-pptx").addEventListener("click", () => {
    closeExportMenu()
    void exportPptxCurrentWork()
  })
  // The Print / Save PDF option reuses the File → Print… seam for both
  // kinds; PDF bytes come from the platform print pipeline on both hosts.
  shellElement<HTMLElement>("#print-work").addEventListener("click", () => {
    closeExportMenu()
    void printCurrentWork()
  })
  document.addEventListener("pointerdown", event => {
    if (event.target instanceof Element && !event.target.closest("#export-menu")) closeExportMenu()
  })
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeExportMenu()
  })
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
  // The updater affordances exist only on updater-capable builds; the shell
  // removes the check button where updates are disabled, so its listener is
  // attached conditionally. The dialog itself stays in the DOM everywhere.
  if (updateEnabled) shellElement<HTMLElement>("#check-for-updates").addEventListener("click", () => void checkForUpdates(true))
  shellElement<HTMLElement>("#install-update").addEventListener("click", () => void armUpdateForQuit())
  elements.presentationExit.addEventListener("click", () => void exitPresentation())
  elements.presentationStart.addEventListener("click", () => void startPresentation())
  shellElement<HTMLElement>("#update-later").addEventListener("click", () => elements.updateDialog.close())
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
    onError: showError,
    updateRuntime
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
      graphEnabled: desktopFeatures.documentGraph,
      // The desktop has no URL routing: work targets open in the embedded
      // editor, tab targets only move the location hash for deep-linking.
      navigate: target => {
        if (!("url" in target)) {
          void openWork(target.workId)
          return
        }
        if (target.url.startsWith("#")) location.hash = target.url
        if (parseLibraryRoute(target.url)?.filter === "documents") void showDocumentGraph()
      },
      resolveMediaBaseUrl: work => mediaUrlsForWorkFolder(work.id).assetBaseUrl,
      presentWork: work => {
        void openWork(work.id).then(opened => {
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
      workFolders = (status?.work_folders || []).map(ensureWorkFolderHash)
      await mountLibrary(status)
      applyTheme(libraryConfig.theme)
      measureBootstrapStage("initial-library-render", showLibrary)
      if (status?.config_notice) showNotice(status.config_notice, "error")
      setStatus(library ? `${workFolders.length} ${workFolders.length === 1 ? "Work" : "Works"}` : "Choose a library folder to begin")
      libraryStatusLoaded = true
    },
    waitForPaint: () => measureBootstrapStage("initial-paint", () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
    markInteractive: () => {
      if ((typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) window.__elefPerformanceTestHooks?.interactive()
    },
    waitForEditor: async () => {
      // Prewarm the preview worker off the interactive path: the library no
      // longer renders card previews through it, so without this the first
      // work open pays the cold-worker spawn and bundle parse.
      void renderer.warmup()
      await measureBootstrapStage("editor-runtime", () => registerEditorRuntime())
      configureEditorKind(elements.editorField.closest(".editor-shell"), "presentation", {
        showTitle: true,
        formControllers: editorFormControllers,
        documentLinksEnabled: desktopFeatures.documentLinks,
        visualEditingEnabled: desktopFeatures.visualEditing,
        presentationEditingEnabled: desktopFeatures.presentationEditing,
        slideOverviewEnabled: desktopFeatures.slideOverview
      })
      await measureBootstrapStage("editor-ready", () => waitForEditorController(elements.editorField, editorFor))
    },
    confirmReady: async () => {
      const removed = await measureBootstrapStage("native-ready-ack", () => fileLibrary.confirmAppReady())
      if ((typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) window.__elefPerformanceTestHooks?.ready(removed)
      void fileLibrary.pendingOpenedElefCount()
        .then((count: any) => { if (count) void processOpenedFiles() })
        .catch(showError)
      if (updateEnabled) startupUpdateCheck.schedule(10_000)
    }
  }).catch((error: any) => {
    recordBootstrapFailure?.()
    showError(error)
  })

}

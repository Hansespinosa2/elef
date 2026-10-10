import { createDeckOpenFlow, prepareDeckOpen } from "./deck_open_flow.js";
import { measurePaintedAction } from "./performance_measurement.js";
import { editorFor } from "./editor_controller_lookup.js";
import { mountHostPresentationEditor } from "./presentation_editor_host.js";
import { createDocumentGraphCache } from "./document_graph_cache.js";
import { createRequestGuard } from "./request_identity.js";
import { buildDocumentGraph } from "@elef/work-model";
import { waitForEditorController } from "./editor_ready.js";
import { createWorkSession, createTitleSaveFlow } from "@elef/client";
import { createCodeMirrorBinding } from "./editor_binding.js";
import { presentConflictDialog } from "./conflict_dialog.js";
import { createRendererClient } from "./renderer_worker_client.js";
import { applyDesktopFeatureFlags } from "./feature_flags.js";
import { configureEditorKind, renderEditorView } from "./editor_view.js";
import { CREATE_WORK_EVENT, GraphController, mountElef, mountPresentation, mountVimSettings, parseLibraryRoute, renderGraphView } from "@elef/client";
function ensureDeckHash(deck) {
  deck.content_hash ??= "";
  return deck;
}
function shellElement(selector) {
  return document.querySelector(selector);
}
function startFileLibraryApplication(platform) {
  const {
    fileLibrary,
    createLibraryHost,
    listen,
    getCurrentWindow,
    completeBootstrap,
    createCloseFlow,
    createTransportAdapter,
    installFetchTransport,
    mediaUrlsForDeck,
    checkForUpdate,
    createIdleUpdateCheck,
    installPendingUpdate,
    desktopAuthoringRegistry,
    loadDesktopAuthoringRegistry,
    quietSavePolicy,
    registerEditorRuntime
  } = platform;
  applyDesktopFeatureFlags(document);
  const renderer = createRendererClient();
  const readPreviewTrace = installFetchTransport({
    renderer,
    getContext: async (source) => ({
      kind: activeDeck?.source_file === "document.md" ? "document" : "presentation",
      title: document.querySelector("#desktop-editor-title")?.value.trim() || activeDeck?.name || "Untitled",
      deckId: activeDeck?.id || "",
      mediaBaseUrl: activeDeck ? mediaUrlsForDeck(activeDeck).assetBaseUrl : "",
      documentNodes: await previewDocumentNodes(source)
    })
  });
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
  });
  const editorFieldHost = document.querySelector("#desktop-editor-field");
  const editorFormHost = document.querySelector("#desktop-editor-form");
  editorFieldHost.removeAttribute("data-controller");
  editorFormHost.removeAttribute("data-controller");
  const mount = document.querySelector("#library-view-mount");
  let shell = null;
  let libraryHost = null;
  const elements = {
    libraryName: document.querySelector("#library-name"),
    welcome: document.querySelector("#welcome-view"),
    library: document.querySelector("#library-view"),
    deckView: document.querySelector("#deck-view"),
    deckTitle: document.querySelector("#deck-title"),
    status: document.querySelector("#status-text"),
    settingsDialog: document.querySelector("#settings-dialog"),
    settingsForm: document.querySelector("#settings-form"),
    libraryTheme: document.querySelector("#library-theme"),
    aboutDialog: document.querySelector("#about-dialog"),
    editorField: document.querySelector("#desktop-editor-field"),
    editorForm: document.querySelector("#desktop-editor-form"),
    editorInput: document.querySelector("#deck-source"),
    titleInput: document.querySelector("#desktop-editor-title"),
    restoreDraft: document.querySelector("#restore-local-draft"),
    importConflictDialog: document.querySelector("#import-conflict-dialog"),
    importConflictMessage: document.querySelector("#import-conflict-message"),
    updateDialog: document.querySelector("#update-dialog"),
    updateVersion: document.querySelector("#update-version"),
    updateNotes: document.querySelector("#update-notes"),
    updateProgress: document.querySelector("#update-progress"),
    presentationExit: document.querySelector("#exit-presentation")
  };
  let library = null;
  let libraryConfig = { schema_version: 1, theme: "dark", hotkeys: {} };
  let decks = [];
  let activeDeck = null;
  let saveFlow = null;
  let sessionStatusKind = "clean";
  let lastSourceFile = null;
  let e2eNextSaveDelayMs = 0;
  const documentGraphCache = createDocumentGraphCache(async () => buildDocumentGraph(await fileLibrary.readDocumentGraph()));
  let pendingUpdate = null;
  let updateInstalling = false;
  let libraryStatusLoaded = false;
  let processingOpenedFiles = false;
  let openFilesRequested = false;
  let openFilesWaitingForSave = false;
  let titleFlow = null;
  const startupUpdateCheck = createIdleUpdateCheck(
    () => checkForUpdates(false),
    () => !elements.deckView.hidden
  );
  const authoringHostDialog = document.querySelector("#authoring-dialog");
  const authoringMount = document.querySelector("#authoring-settings-mount");
  let authoringShell = null;
  function closeAuthoringSettings() {
    if (authoringShell) {
      authoringShell.unmount();
      authoringShell = null;
    }
    if (authoringHostDialog.open) authoringHostDialog.close();
  }
  async function openAuthoringSettings() {
    closeAuthoringSettings();
    authoringShell = await mountElef(authoringMount, libraryHost, {
      initialUrl: "/snippets",
      authoring: {
        transport: platform.authoringTransport,
        renderExample: (source) => renderer.renderMarkdownBlock(source),
        reloadEditorRegistry: loadDesktopAuthoringRegistry,
        onClose: closeAuthoringSettings,
        onSaved: setStatus
      },
      updater: platform.updaterSeam
    });
    authoringHostDialog.showModal();
  }
  const vimMount = document.querySelector("#vim-settings-mount");
  if (vimMount) {
    const editorForVim = () => document.querySelector(".source-field")?.editorController || null;
    mountVimSettings(vimMount, {
      editorBridge: {
        setVimEnabled: (enabled) => editorForVim()?.setVimEnabled(enabled),
        setEscapeKey: (key) => editorForVim()?.setEscapeKey(key),
        clearEscapeKey: () => editorForVim()?.clearEscapeKey(),
        setLineNumberMode: (mode) => editorForVim()?.setLineNumberMode(mode),
        setModeAwareCursor: (enabled) => editorForVim()?.setModeAwareCursor(enabled)
      }
    });
  }
  const transport = createTransportAdapter({ onConflict: (event) => saveFlow?.handleConflict(event) });
  const sessionTransport = {
    ...transport,
    saveSource: async (id, source) => {
      const isDocument = decks.find((deck) => deck.id === id)?.source_file === "document.md";
      if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__ && e2eNextSaveDelayMs > 0) {
        const delay = e2eNextSaveDelayMs;
        e2eNextSaveDelayMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const result = await transport.saveSource(id, source);
      if (isDocument) documentGraphCache.invalidate();
      return result;
    }
  };
  function openSession(deck) {
    closeSession();
    lastSourceFile = deck.source_file;
    const adapter = createCodeMirrorBinding({
      getEditor: () => editorFor(elements.editorField),
      getDeckId: () => activeDeck?.id,
      getFallbackValue: () => elements.editorInput.value,
      setFallbackValue: (value) => {
        elements.editorInput.value = value;
      },
      waitForEditor: () => waitForEditorController(elements.editorField, editorFor),
      materializeEdits: materializePendingVisualEdits
    });
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
    });
    session.onStatus((status) => {
      sessionStatusKind = status.kind;
      elements.restoreDraft.hidden = !session.canRestoreDraft;
      if (activeDeck && activeDeck.source_file !== lastSourceFile) {
        lastSourceFile = activeDeck.source_file;
        syncSourceLabel();
      }
      if (status.kind === "clean" && openFilesWaitingForSave) {
        openFilesWaitingForSave = false;
        queueMicrotask(() => void processOpenedFiles());
      }
    });
    session.onExternalChange((snapshot) => {
      if (snapshot.removed || !activeDeck) return;
      if (activeDeck.source_file === "document.md" && (snapshot.baseline.revision !== activeDeck.content_hash || snapshot.sourceFile !== activeDeck.source_file)) {
        documentGraphCache.invalidate();
      }
    });
    const editor = editorFor(elements.editorField);
    editor?.attachSession?.(session);
    saveFlow = session;
  }
  function closeSession() {
    if (!saveFlow) return;
    editorFor(elements.editorField)?.detachSession?.(saveFlow);
    saveFlow.dispose();
    saveFlow = null;
    sessionStatusKind = "clean";
  }
  titleFlow = createTitleSaveFlow({
    getDeck: () => activeDeck,
    getTitle: () => elements.titleInput.value,
    renameDeck,
    onRenamed: (renamed) => {
      elements.deckTitle.textContent = renamed.name;
      shellElement("#breadcrumb-current").textContent = renamed.name;
    },
    onState: () => {
    },
    onError: showError
  });
  const bootstrapStages = [];
  const openStageMeasurements = [];
  function measureBootstrapStage(name, action) {
    if (!(typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) return action();
    const startedAt = performance.now();
    const record = () => bootstrapStages.push({ name, milliseconds: performance.now() - startedAt });
    try {
      const result = action();
      if (result && typeof result.then === "function") {
        return result.then((value) => {
          record();
          return value;
        }, (error) => {
          record();
          throw error;
        });
      }
      record();
      return result;
    } catch (error) {
      record();
      throw error;
    }
  }
  function measureOpenStage(name, action) {
    if (!(typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) return action();
    const startedAt = performance.now();
    const record = () => recordOpenStage(name, startedAt);
    try {
      const result = action();
      if (result && typeof result.then === "function") {
        return result.then((value) => {
          record();
          return value;
        }, (error) => {
          record();
          throw error;
        });
      }
      record();
      return result;
    } catch (error) {
      record();
      throw error;
    }
  }
  function recordOpenStage(name, startedAt) {
    openStageMeasurements.push({ name, milliseconds: performance.now() - startedAt });
    if (openStageMeasurements.length > 512) openStageMeasurements.shift();
  }
  if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) {
    let interactiveAt = null;
    let nativeReadyAt = null;
    let previousInstallationsRemoved = null;
    let typingSave = null;
    Object.defineProperty(window, "__elefPerformanceTestHooks", {
      value: Object.freeze({
        get interactiveAt() {
          return interactiveAt;
        },
        get nativeReadyAt() {
          return nativeReadyAt;
        },
        get previousInstallationsRemoved() {
          return previousInstallationsRemoved;
        },
        bootstrapStages: () => bootstrapStages.map((stage) => ({ ...stage })),
        navigationTiming() {
          const navigation = performance.getEntriesByType("navigation")[0];
          if (!navigation) return null;
          return {
            responseEnd: navigation.responseEnd,
            domInteractive: navigation.domInteractive,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd
          };
        },
        interactive: () => {
          interactiveAt = performance.timeOrigin + performance.now();
        },
        ready: (removed) => {
          nativeReadyAt = performance.timeOrigin + performance.now();
          previousInstallationsRemoved = removed;
        },
        async open(id) {
          const traceStart = readPreviewTrace?.().length || 0;
          const openStageStart = openStageMeasurements.length;
          const measured = await measurePaintedAction(async () => {
            await openDeck(id);
            if (activeDeck?.id !== id || elements.editorForm.dataset.loadedDeckId !== id || shellElement("#visual-mode").disabled) throw new Error("The measured deck did not finish rendering.");
            const projection = elements.editorForm.querySelector(".presentation-editor-projection");
            if (!projection) throw new Error("The measured presentation projection did not render.");
            return { id, slides: projection.querySelectorAll(".slide-frame > .slide").length };
          });
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return {
            ...measured,
            result: {
              ...measured.result,
              previewTrace: readPreviewTrace?.().slice(traceStart) || [],
              openTrace: openStageMeasurements.slice(openStageStart)
            }
          };
        },
        async list() {
          return measurePaintedAction(async () => {
            await refreshLibrary();
            const notice = document.querySelector("#notice");
            if (notice && !notice.hidden && notice.dataset.tone === "error") throw new Error("The measured library refresh failed.");
            return { total: decks.length, rendered: document.querySelectorAll("#deck-list .library-card").length };
          });
        },
        typingValue: () => currentSource(),
        startTypingDuringSave(text) {
          const editor = editorFor(elements.editorField);
          if (!editor) throw new Error("The measured source editor is not ready.");
          editor.setEditingMode("source");
          const original = currentSource();
          const expected = original + "\n" + text;
          editor.replaceRange("\n", editor.value.length);
          e2eNextSaveDelayMs = 500;
          typingSave = { expected, saving: flushSave() };
          editor.setSelectionRange(editor.value.length);
          editor.focus();
          return true;
        },
        async finishTypingDuringSave() {
          if (!typingSave) throw new Error("Autosave typing was not started.");
          const { expected, saving } = typingSave;
          typingSave = null;
          if (!await saving) throw new Error("The in-flight save did not finish while input was arriving.");
          const actual = currentSource();
          if (actual !== expected) throw new Error(`Input changed during autosave: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
          if (!await flushSave({ force: true })) throw new Error("The final source could not be saved after input stopped.");
          const saved = currentSource();
          if (saved !== expected) throw new Error(`The editor source changed after save: expected ${JSON.stringify(expected)}, got ${JSON.stringify(saved)}.`);
          return saved;
        },
        close() {
          setTimeout(() => void getCurrentWindow().close(), 250);
          return true;
        }
      })
    });
    Object.defineProperty(window, "__elefSaveTestHooks", {
      value: Object.freeze({
        pause: () => saveFlow?.pause(),
        saveStatus: () => {
          if (titleFlow?.isDirty() || titleFlow?.isBlocked()) return "dirty";
          return sessionStatusKind;
        },
        async flush() {
          try {
            if (!saveFlow) return true;
            const result = await saveFlow.flush({ force: true });
            return result.kind === "clean" || result.kind === "saved";
          } finally {
            saveFlow?.resume();
          }
        },
        runSnapshotCadence: () => saveFlow?.runSnapshotCadence?.() ?? null
      })
    });
  }
  function setStatus(message) {
    elements.status.textContent = message;
  }
  function showNotice(message, tone = "info") {
    shell?.notify(message, tone);
  }
  function clearNotice() {
    shell?.notify(null);
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = ["system", "light", "dark"].includes(theme) ? theme : "system";
  }
  function showError(error) {
    const message = typeof error?.message === "string" ? error.message : "The operation could not be completed.";
    setStatus(message);
    showNotice(message, "error");
  }
  let libraryShown = false;
  function showLibrary() {
    elements.editorForm.previewController?.finishEditing();
    document.body.dataset.desktopView = "library";
    elements.welcome.hidden = Boolean(library);
    elements.library.hidden = !library;
    elements.deckView.hidden = true;
    elements.libraryName.textContent = library ? library.root.split(/[\\/]/).filter(Boolean).at(-1) || library.root : "No library selected";
    shellElement("#new-deck").disabled = !library;
    shellElement("#import-elef").disabled = !library;
    shellElement("#breadcrumb-current").textContent = "Decks";
    if (libraryShown) {
      shell.setFilter("all");
      void refreshLibrary();
    } else libraryShown = true;
    void startupUpdateCheck.resume();
  }
  function currentFilter() {
    return mount.querySelector("[data-library-tab][aria-current='page']")?.dataset.libraryTab ?? "all";
  }
  async function documentGraphData() {
    return documentGraphCache.get();
  }
  async function previewDocumentNodes(source) {
    if (!source.includes("[[")) return [];
    try {
      return (await documentGraphData()).nodes;
    } catch (_error) {
      return [];
    }
  }
  const graphRequests = createRequestGuard();
  let graphController = null;
  async function showDocumentGraph() {
    if (!library) return;
    const request = graphRequests.request();
    try {
      const graph = await documentGraphData();
      if (!graphRequests.isCurrent(request) || !libraryShown) return;
      const slot = mount.querySelector("#document-graph-view");
      if (!slot) return;
      graphController?.destroy();
      renderGraphView(slot, graph);
      graphController = new GraphController(slot, graph, { onOpenDeck: (id) => void openDeck(id) });
      slot.hidden = currentFilter() !== "documents";
    } catch (error) {
      showError(error);
    }
  }
  async function refreshLibrary() {
    if (!library) return;
    try {
      const [listedDecks] = await Promise.all([
        fileLibrary.listDecks(),
        loadDesktopAuthoringRegistry()
      ]);
      decks = listedDecks.map(ensureDeckHash);
      documentGraphCache.invalidate();
      libraryHost?.noteListedDecks(listedDecks);
      await shell.refresh();
      if (currentFilter() === "documents") await showDocumentGraph();
      setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`);
      clearNotice();
    } catch (error) {
      showError(error);
    }
  }
  async function chooseLibrary() {
    if (hasUnsavedChanges() && !await flushSave()) return;
    clearNotice();
    setStatus("Choose a folder for your library\u2026");
    try {
      const selected = await fileLibrary.chooseLibraryRoot();
      if (!selected) {
        setStatus("Library selection cancelled");
        return;
      }
      library = selected;
      libraryHost?.noteRootChanged();
      await loadDesktopAuthoringRegistry();
      documentGraphCache.invalidate();
      libraryConfig = selected.config || libraryConfig;
      decks = selected.decks.map(ensureDeckHash);
      applyTheme(libraryConfig.theme);
      showLibrary();
      if (selected.config_notice) showNotice(selected.config_notice, "error");
      setStatus(`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`);
      if (await fileLibrary.pendingOpenedElefCount()) void processOpenedFiles();
    } catch (error) {
      showError(error);
    }
  }
  function showCreateDialog(kind = "presentation") {
    mount.querySelector(".library-shared-view")?.dispatchEvent(
      new CustomEvent(CREATE_WORK_EVENT, { detail: { kind } })
    );
  }
  const openDeck = createDeckOpenFlow(openDeckNow);
  async function openDeckNow(id) {
    const libraryWasHidden = elements.library.hidden;
    elements.library.hidden = true;
    const restoreLibrary = () => {
      elements.library.hidden = libraryWasHidden;
    };
    try {
      if (document.body.classList.contains("presenting-deck")) await exitPresentation();
      elements.editorForm.previewController?.finishEditing();
      await Promise.resolve();
      if (activeDeck && hasUnsavedChanges() && !await flushSave()) {
        restoreLibrary();
        return false;
      }
      delete elements.editorForm.dataset.loadedDeckId;
      let transition;
      do {
        transition = await prepareDeckOpen(id, {
          read: (target) => measureOpenStage("readDeck", () => transport.readDeck(target)),
          isDirty: hasUnsavedChanges,
          getRevision: () => saveFlow?.revision ?? 0,
          flushSave,
          prepare: (deck2) => measureOpenStage("prepareDeck", async () => {
            await registerEditorRuntime();
            let documentTitles2 = [];
            if (deck2.source_file === "document.md" || deck2.source.includes("[[")) {
              try {
                const graph = await documentGraphData();
                documentTitles2 = deck2.source_file === "document.md" ? graph.nodes.map((node) => node.title) : [];
              } catch (_error) {
                documentTitles2 = deck2.source_file === "document.md" ? decks.filter((item) => item.kind === "document").map((item) => item.name) : [];
              }
            }
            return { documentTitles: documentTitles2 };
          })
        });
      } while (transition && (hasUnsavedChanges() || (saveFlow?.revision ?? 0) !== transition.revision));
      if (!transition) {
        if (activeDeck) elements.editorForm.dataset.loadedDeckId = activeDeck.id;
        restoreLibrary();
        return false;
      }
      const { deck, prepared } = transition;
      const { documentTitles } = prepared;
      const isDocument = deck.source_file === "document.md";
      if (deck.id !== id) {
        decks = decks.map((item) => item.id === id ? { ...item, id: deck.id } : item);
        documentGraphCache.invalidate();
        void shell.refresh();
      }
      closeSession();
      activeDeck = null;
      try {
        configureEditorKind(elements.editorField.closest(".editor-shell"), isDocument ? "document" : "presentation", {
          documentTitles,
          sourceName: isDocument ? "document[source]" : "presentation[source]",
          showTitle: true,
          formControllers: "preview visual-editor slide-overview media"
        });
        const editor = await measureOpenStage("editorReady", () => editorFor(elements.editorField)?.editorReady ? editorFor(elements.editorField) : waitForEditorController(elements.editorField, editorFor));
        measureOpenStage("loadDocument", () => {
          editor.loadDocument(deck.source);
          editor.setEditingMode("visual", { restoreCaret: false });
        });
      } catch (error) {
        elements.editorInput.disabled = true;
        showLibrary();
        throw error;
      }
      if (!isDocument && !elements.editorForm.presentationEditorController) {
        mountHostPresentationEditor(elements.editorForm);
      }
      const viewSetupStartedAt = typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__ ? performance.now() : null;
      transport.activateDeck(deck, id);
      activeDeck = deck;
      openSession(deck);
      elements.deckTitle.textContent = deck.name;
      elements.deckTitle.hidden = !isDocument;
      elements.titleInput.value = deck.name;
      shellElement("#deck-kind").textContent = deck.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION";
      shellElement("#deck-source-name").textContent = deck.source_file;
      elements.editorField.dataset.editorInitialSourceValue = JSON.stringify(deck.source);
      const mediaUrls = mediaUrlsForDeck(deck);
      elements.editorForm.dataset.previewUrlValue = mediaUrls.previewUrl;
      elements.editorForm.dataset.mediaEnabledValue = "true";
      elements.editorForm.dataset.mediaWorkKindValue = deck.source_file === "document.md" ? "document" : "presentation";
      elements.editorForm.dataset.mediaUploadUrlValue = mediaUrls.uploadUrl;
      elements.editorForm.dataset.mediaAssetBaseUrlValue = mediaUrls.assetBaseUrl;
      elements.editorField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(documentTitles);
      const visualButton = document.querySelector("#visual-mode");
      visualButton.disabled = true;
      visualButton.title = "Rendering preview\u2026";
      elements.editorInput.disabled = false;
      shellElement("#deck-id").textContent = deck.id;
      elements.editorForm.dataset.loadedDeckId = deck.id;
      const notice = document.querySelector("#deck-notice");
      notice.textContent = deck.notices.join(" ");
      notice.hidden = deck.notices.length === 0;
      elements.library.hidden = true;
      elements.deckView.hidden = false;
      document.body.dataset.desktopView = "editor";
      shellElement("#breadcrumb-current").textContent = deck.name;
      setStatus("Deck opened");
      if (viewSetupStartedAt !== null) recordOpenStage("deckViewSetup", viewSetupStartedAt);
      await measureOpenStage("previewRefresh", () => elements.editorForm.previewController?.refresh());
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }
  async function renameDeck(deck, name) {
    if (typeof name !== "string" || name.trim() === deck.name) return;
    const renamed = await fileLibrary.renameDeck(deck.id, name.trim());
    if (activeDeck && activeDeck.id === deck.id) Object.assign(activeDeck, renamed);
    decks = decks.map((item) => item.id === deck.id ? { ...item, ...renamed } : item);
    await shell.refresh();
    return renamed;
  }
  function handleLibraryEvent(event) {
    if (event.type === "renamed") {
      if (activeDeck && activeDeck.id === event.work.id) Object.assign(activeDeck, { name: event.work.title });
      decks = decks.map((item) => item.id === event.work.id ? { ...item, name: event.work.title } : item);
    }
    if (event.type === "deleted") {
      if (activeDeck?.id === event.work.id) {
        activeDeck = null;
        closeSession();
      }
      decks = decks.filter((item) => item.id !== event.work.id);
      setStatus(`Moved \u201C${event.work.title}\u201D to Trash`);
    }
    if (currentFilter() === "documents") void showDocumentGraph();
  }
  function showImportConflict(error) {
    const incoming = error.details?.incoming_name || "This deck";
    const existing = error.details?.existing_name || "an existing deck";
    elements.importConflictMessage.textContent = `\u201C${incoming}\u201D has the same identity as \u201C${existing}\u201D.`;
    elements.importConflictDialog.showModal();
  }
  async function completeImport(imported) {
    if (imported.replaced && activeDeck?.id === imported.deck.id) {
      activeDeck = null;
      closeSession();
      showLibrary();
    }
    await refreshLibrary();
    setStatus((imported.replaced ? "Replaced" : "Imported") + ` \u201C${imported.deck.name}\u201D`);
    if (imported.name_collision) {
      showNotice(`A deck with an equivalent name already exists. Imported as \u201C${imported.deck.name}\u201D.`, "warning");
    }
  }
  async function processOpenedFiles() {
    openFilesRequested = true;
    if (!libraryStatusLoaded) return;
    if (processingOpenedFiles) return;
    processingOpenedFiles = true;
    try {
      while (openFilesRequested) {
        openFilesRequested = false;
        if (hasUnsavedChanges() && !await flushSave()) {
          openFilesWaitingForSave = true;
          break;
        }
        while (true) {
          try {
            const imported = await fileLibrary.importOpenedElef();
            if (!imported) break;
            await completeImport(imported);
          } catch (error) {
            if (error?.code === "invalid_library") {
              await chooseLibrary();
              if (library) continue;
            } else if (error?.code === "import_conflict") {
              showImportConflict(error);
            } else {
              showError(error);
            }
            break;
          }
        }
      }
    } finally {
      processingOpenedFiles = false;
      if (openFilesRequested) void processOpenedFiles();
    }
  }
  function scheduleSave() {
    saveFlow?.noteChange();
  }
  function materializePendingVisualEdits() {
    const editor = editorFor(elements.editorField);
    if (editor?.editorReady) editor.projectionController()?.flushPendingProjectionEdits?.();
  }
  function hasUnsavedChanges() {
    materializePendingVisualEdits();
    return Boolean(saveFlow?.dirty || titleFlow?.isDirty());
  }
  async function flushSave(options) {
    hasUnsavedChanges();
    if (titleFlow && !await titleFlow.flush(options)) return false;
    if (!saveFlow) return true;
    const result = await saveFlow.flush(options);
    return result.kind === "clean" || result.kind === "saved";
  }
  async function flushForClose() {
    hasUnsavedChanges();
    if (titleFlow && !await titleFlow.flush()) return "failed";
    if (!saveFlow) return "saved";
    const result = await saveFlow.flush();
    if (result.kind === "clean" || result.kind === "saved") return "saved";
    if (result.kind === "conflict") return "conflict";
    return "failed";
  }
  function showConflict(conflict) {
    const dialog = elements.editorForm.querySelector("#conflict-dialog");
    presentConflictDialog(dialog, {
      message: "The source file changed outside Elef. Choose which version to keep, or edit a merge.",
      localSource: conflict.localSource,
      diskSource: conflict.diskSource,
      diskSourceFile: conflict.diskSourceFile,
      mergeSource: currentSource()
    });
  }
  function currentSource() {
    return editorFor(elements.editorField)?.sourceValue ?? elements.editorInput.value;
  }
  async function showSettings() {
    try {
      libraryConfig = await fileLibrary.readLibraryConfig();
      elements.libraryTheme.value = libraryConfig.theme;
      elements.settingsDialog.showModal();
    } catch (error) {
      showError(error);
    }
  }
  async function saveSettings(event) {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    const next = { ...libraryConfig, schema_version: 1, theme: elements.libraryTheme.value };
    try {
      await fileLibrary.writeLibraryConfig(next);
      libraryConfig = next;
      applyTheme(next.theme);
      elements.settingsDialog.close();
      setStatus("Library settings saved");
    } catch (error) {
      showError(error);
    }
  }
  async function exportCurrentDeck() {
    if (!activeDeck) {
      showNotice("Open a deck before exporting it.");
      return;
    }
    if (hasUnsavedChanges() && !await flushSave({ force: true })) return;
    try {
      if (await fileLibrary.exportElef(activeDeck.id)) setStatus("Deck exported");
    } catch (error) {
      showError(error);
    }
  }
  async function importDeck() {
    if (!library) {
      showNotice("Choose a library before importing a deck.");
      return;
    }
    if (hasUnsavedChanges() && !await flushSave()) return;
    try {
      const imported = await fileLibrary.importElef();
      if (!imported) return;
      await completeImport(imported);
    } catch (error) {
      if (error?.code === "import_conflict") {
        showImportConflict(error);
        return;
      }
      showError(error);
    }
  }
  async function resolveImportConflict(resolution) {
    elements.importConflictDialog.close();
    try {
      const imported = await fileLibrary.resolveImportConflict(resolution);
      if (imported) await completeImport(imported);
      void processOpenedFiles();
    } catch (error) {
      showError(error);
    }
  }
  async function checkForUpdates(showNoUpdate = true) {
    if (showNoUpdate) startupUpdateCheck.cancel();
    if (updateInstalling) return false;
    try {
      const update = await checkForUpdate();
      if (!update) {
        if (showNoUpdate) setStatus("Elef is up to date");
        return false;
      }
      await pendingUpdate?.dispose().catch(() => {
      });
      pendingUpdate = update;
      elements.updateVersion.textContent = "Version " + update.version + " is ready to install.";
      elements.updateNotes.textContent = update.notes;
      elements.updateProgress.textContent = "The update signature will be verified before installation.";
      elements.updateDialog.showModal();
      return true;
    } catch (_error) {
      if (showNoUpdate) showError({ message: "Could not check for updates. Try again while online." });
      return false;
    }
  }
  async function installUpdate() {
    if (!pendingUpdate || updateInstalling) return;
    updateInstalling = true;
    const button = document.querySelector("#install-update");
    const later = document.querySelector("#update-later");
    button.disabled = true;
    later.disabled = true;
    try {
      const installed = await installPendingUpdate(pendingUpdate, {
        prepare: async () => !hasUnsavedChanges() || await flushSave({ force: true }),
        onProgress: (event) => {
          if (event.event === "Started" || event.event === "Progress") {
            elements.updateProgress.textContent = "Downloading update\u2026";
          }
          if (event.event === "Finished") elements.updateProgress.textContent = "Installing update\u2026";
        }
      });
      if (!installed) elements.updateProgress.textContent = "Installation paused. Save your changes and choose Install to try again.";
    } catch (_error) {
      showError({ message: "The update could not be installed. Your current version is still available." });
    } finally {
      updateInstalling = false;
      button.disabled = false;
      later.disabled = false;
    }
  }
  async function printCurrentDeck() {
    if (!activeDeck) {
      showNotice("Open a deck before printing it.");
      return;
    }
    if (hasUnsavedChanges() && !await flushSave()) return;
    const preview = document.querySelector("#desktop-preview");
    if (!preview.childElementCount && !await elements.editorForm.previewController?.refresh()) {
      showNotice("Render the deck before printing it.", "error");
      return;
    }
    document.body.classList.add("printing-deck");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    window.addEventListener("afterprint", () => {
      document.body.classList.remove("printing-deck");
    }, { once: true });
    window.print();
  }
  let presentationMount = null;
  function presentationStage() {
    return elements.editorForm.querySelector(".presentation-editor-projection");
  }
  let presentationResyncListening = false;
  function mountFreshPresentation() {
    presentationMount?.destroy();
    presentationMount = mountPresentation(elements.editorForm, {
      getStage: presentationStage,
      document
    });
    if (!presentationResyncListening) {
      presentationResyncListening = true;
      elements.editorForm.addEventListener("elef:preview-updated", resyncPresentationMount);
    }
    return presentationMount;
  }
  function resyncPresentationMount() {
    presentationMount?.resync();
  }
  async function startPresentation() {
    if (!activeDeck || activeDeck.source_file === "document.md") {
      showNotice("Open a presentation deck to start presentation mode.");
      return;
    }
    if (!await elements.editorForm.previewController?.refresh()) {
      showNotice("Render the presentation before starting presentation mode.", "error");
      return;
    }
    const presentation = mountFreshPresentation();
    if (!presentation.controller.start()) {
      showNotice("This presentation has no slides to show.", "error");
      return;
    }
    document.body.classList.add("presenting-deck");
    elements.presentationExit.hidden = false;
    document.addEventListener("keydown", presentationKeydown, true);
    try {
      await getCurrentWindow().setFullscreen(true);
    } catch (_error) {
      showNotice("Presentation mode is open. Use Esc to return to editing.");
    } finally {
      presentationStage()?.focus({ preventScroll: true });
    }
  }
  function presentationKeydown(event) {
    if (!document.body.classList.contains("presenting-deck")) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    void exitPresentation();
  }
  async function exitPresentation() {
    if (!document.body.classList.contains("presenting-deck")) return;
    document.body.classList.remove("presenting-deck");
    elements.presentationExit.hidden = true;
    document.removeEventListener("keydown", presentationKeydown, true);
    presentationMount?.destroy();
    presentationMount = null;
    try {
      await getCurrentWindow().setFullscreen(false);
    } catch (_error) {
    }
  }
  if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) {
    globalThis.__elefPresentationTestHooks = { start: startPresentation };
  }
  async function resolveConflictWithDisk() {
    if (!await saveFlow.useDiskVersion()) return;
    syncSourceLabel();
    const conflictDialog = elements.editorForm.querySelector("#conflict-dialog");
    conflictDialog.close();
  }
  function resolveConflictWithLocal() {
    if (!saveFlow.keepLocalVersion()) return;
    syncSourceLabel();
    const conflictDialog = elements.editorForm.querySelector("#conflict-dialog");
    conflictDialog.close();
  }
  async function resolveConflictWithMerge() {
    const mergedSource = elements.editorForm.querySelector("#conflict-merge").value;
    if (!await saveFlow.saveMergedVersion(mergedSource)) return;
    syncSourceLabel();
    const conflictDialog = elements.editorForm.querySelector("#conflict-dialog");
    conflictDialog.close();
  }
  function syncSourceLabel() {
    if (!activeDeck) return;
    shellElement("#deck-source-name").textContent = activeDeck.source_file;
    shellElement("#deck-kind").textContent = activeDeck.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION";
  }
  async function handleMenuAction(action) {
    if (action === "quit") return getCurrentWindow().close();
    if (action === "choose-library") return chooseLibrary();
    if (action === "refresh-library") return refreshLibrary();
    if (action === "open-deck") {
      if (!library) return chooseLibrary();
      if (hasUnsavedChanges() && !await flushSave()) return;
      showLibrary();
      mount.querySelector("#library-search")?.focus();
      return;
    }
    if (action === "new-presentation") return showCreateDialog("presentation");
    if (action === "new-document") return showCreateDialog("document");
    if (action === "save") return flushSave({ force: true });
    if (action === "export-elef") return exportCurrentDeck();
    if (action === "import-elef") return importDeck();
    if (action === "settings") return showSettings();
    if (action === "check-for-updates") return checkForUpdates(true);
    if (action === "about") return elements.aboutDialog.showModal();
    if (action === "start-presentation") return startPresentation();
    if (action === "print") return printCurrentDeck();
  }
  shellElement("#choose-library").addEventListener("click", () => void chooseLibrary());
  shellElement("#change-library").addEventListener("click", () => void chooseLibrary());
  shellElement(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    shellElement("#back-to-library").click();
  });
  shellElement("#open-settings").addEventListener("click", () => void showSettings());
  shellElement("#new-deck").addEventListener("click", () => {
    showCreateDialog(currentFilter() === "documents" ? "document" : "presentation");
  });
  shellElement("#refresh-library").addEventListener("click", () => void refreshLibrary());
  shellElement("#import-elef").addEventListener("click", () => void importDeck());
  shellElement("#back-to-library").addEventListener("click", () => {
    if (hasUnsavedChanges()) {
      void flushSave().then((saved) => {
        if (!saved) return;
        showLibrary();
        setStatus("Library");
      });
      return;
    }
    showLibrary();
    setStatus("Library");
  });
  elements.settingsForm.addEventListener("submit", (event) => void saveSettings(event));
  shellElement("#manage-authoring").addEventListener("click", () => {
    elements.settingsDialog.close();
    void openAuthoringSettings();
  });
  shellElement("#check-for-updates").addEventListener("click", () => void checkForUpdates(true));
  shellElement("#install-update").addEventListener("click", () => void installUpdate());
  elements.presentationExit.addEventListener("click", () => void exitPresentation());
  shellElement("#update-later").addEventListener("click", () => elements.updateDialog.close());
  elements.updateDialog.addEventListener("cancel", (event) => {
    if (updateInstalling) event.preventDefault();
  });
  elements.updateDialog.addEventListener("close", () => {
    const update = pendingUpdate;
    pendingUpdate = null;
    void update?.dispose().catch(() => {
    });
  });
  shellElement("#import-conflict-replace").addEventListener("click", () => void resolveImportConflict("replace"));
  shellElement("#import-conflict-keep-both").addEventListener("click", () => void resolveImportConflict("keep_both"));
  shellElement("#import-conflict-cancel").addEventListener("click", () => void resolveImportConflict("cancel"));
  elements.editorField.addEventListener("input", () => scheduleSave());
  elements.titleInput.addEventListener("input", () => titleFlow.noteChange());
  const useDiskButton = elements.editorForm.querySelector("#use-disk-version");
  useDiskButton.addEventListener("click", resolveConflictWithDisk);
  const keepLocalButton = elements.editorForm.querySelector("#keep-local-version");
  keepLocalButton.addEventListener("click", resolveConflictWithLocal);
  const saveMergedButton = elements.editorForm.querySelector("#save-merged-version");
  saveMergedButton.addEventListener("click", resolveConflictWithMerge);
  const conflictCancelDialog = elements.editorForm.querySelector("#conflict-dialog");
  conflictCancelDialog.addEventListener("cancel", (event) => {
    if (saveFlow?.conflict) event.preventDefault();
  });
  elements.restoreDraft.addEventListener("click", () => {
    void saveFlow?.restoreDraft();
  });
  window.addEventListener("blur", () => void flushSave());
  void getCurrentWindow().onCloseRequested(createCloseFlow({
    isDirty: () => hasUnsavedChanges(),
    flushForClose,
    close: () => getCurrentWindow().close(),
    confirmDiscard: () => fileLibrary.confirmDiscardUnsavedChanges(),
    onError: showError
  }));
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      mount.querySelector("#library-search")?.focus();
    }
  });
  void listen("desktop-menu-action", (event) => void handleMenuAction(event.payload));
  const openedFileListener = listen("desktop-open-elef", () => void processOpenedFiles());
  async function mountLibrary(status) {
    libraryHost = createLibraryHost(status);
    shell = await mountElef(mount, libraryHost, {
      initialUrl: location.href,
      // The desktop has no URL routing: work targets open in the embedded
      // editor, tab targets only move the location hash for deep-linking.
      navigate: (target) => {
        if (!("url" in target)) {
          void openDeck(target.workId);
          return;
        }
        if (target.url.startsWith("#")) location.hash = target.url;
        if (parseLibraryRoute(target.url)?.filter === "documents") void showDocumentGraph();
      },
      resolveMediaBaseUrl: (work) => mediaUrlsForDeck(work.id).assetBaseUrl,
      presentWork: (work) => {
        void openDeck(work.id).then((opened) => {
          if (opened) void startPresentation();
        });
      },
      onLibraryEvent: handleLibraryEvent
    });
  }
  void completeBootstrap({
    initialize: async () => {
      const [status] = await measureBootstrapStage("library-status", () => Promise.all([fileLibrary.getLibraryStatus(), openedFileListener]));
      library = status;
      libraryConfig = status?.config || libraryConfig;
      decks = (status?.decks || []).map(ensureDeckHash);
      await mountLibrary(status);
      applyTheme(libraryConfig.theme);
      measureBootstrapStage("initial-library-render", showLibrary);
      if (status?.config_notice) showNotice(status.config_notice, "error");
      setStatus(library ? `${decks.length} ${decks.length === 1 ? "deck" : "decks"}` : "Choose a library folder to begin");
      libraryStatusLoaded = true;
    },
    waitForPaint: () => measureBootstrapStage("initial-paint", () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
    markInteractive: () => {
      if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) window.__elefPerformanceTestHooks?.interactive();
    },
    waitForEditor: async () => {
      void renderer.warmup();
      await measureBootstrapStage("editor-runtime", () => registerEditorRuntime());
      configureEditorKind(elements.editorField.closest(".editor-shell"), "presentation", {
        showTitle: true,
        formControllers: "preview visual-editor slide-overview media"
      });
      await measureBootstrapStage("editor-ready", () => waitForEditorController(elements.editorField, editorFor));
    },
    confirmReady: async () => {
      const removed = await measureBootstrapStage("native-ready-ack", () => fileLibrary.confirmAppReady());
      if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) window.__elefPerformanceTestHooks?.ready(removed);
      void fileLibrary.pendingOpenedElefCount().then((count) => {
        if (count) void processOpenedFiles();
      }).catch(showError);
      startupUpdateCheck.schedule(1e4);
    }
  }).catch(showError);
}
export {
  startFileLibraryApplication
};

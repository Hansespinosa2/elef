import { desktopMenuKeyAction } from "./desktop_menu_keys.js";
import { createWorkOpenFlow, prepareWorkOpen } from "./work_open_flow.js";
import { measurePaintedAction } from "./performance_measurement.js";
import { editorFor } from "./editor_controller_lookup.js";
import { createRequestGuard } from "./request_identity.js";
import { waitForEditorController } from "./editor_ready.js";
import { createWorkSession, createTitleSaveFlow } from "@elef/client";
import { createCodeMirrorBinding } from "./editor_binding.js";
import { presentConflictDialog } from "./conflict_dialog.js";
import { createRendererClient } from "./renderer_worker_client.js";
import { applyDesktopFeatureFlags } from "./feature_flags.js";
import { configureEditorKind, enableVisualModeFromInstalledPreview, renderEditorView } from "./editor_view.js";
import { CREATE_WORK_EVENT, exportMenuOptionsFor, mountElef, mountExportMenu, mountPresentation, parseLibraryRoute } from "@elef/client";
function ensureWorkFolderHash(workFolder) {
  workFolder.content_hash ??= "";
  return workFolder;
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
    mediaUrlsForWorkFolder,
    checkForUpdate,
    createIdleUpdateCheck,
    installPendingUpdate,
    desktopAuthoringRegistry,
    loadDesktopAuthoringRegistry,
    quietSavePolicy,
    registerEditorRuntime,
    recordBootstrapFailure,
    features,
    featureFlags,
    documentGraphRuntime,
    presentationEditorRuntime,
    updateEnabled = true,
    updateRuntime = null
  } = platform;
  const desktopFeatures = Object.freeze({
    visualEditing: features?.visualEditing !== false,
    presentationEditing: features?.presentationEditing !== false,
    slideOverview: features?.slideOverview !== false,
    documentGraph: features?.documentGraph !== false && Boolean(documentGraphRuntime),
    documentLinks: features?.documentLinks !== false
  });
  const editorFormControllers = [
    "preview",
    ...desktopFeatures.visualEditing ? ["visual-editor"] : [],
    ...desktopFeatures.slideOverview ? ["slide-overview"] : [],
    "media"
  ].join(" ");
  applyDesktopFeatureFlags(document, featureFlags);
  if (!updateEnabled) document.querySelector("#check-for-updates")?.remove();
  const renderer = createRendererClient();
  const readPreviewTrace = installFetchTransport({
    renderer,
    getContext: async (source) => ({
      kind: activeWorkFolder?.source_file === "document.md" ? "document" : "presentation",
      title: document.querySelector("#desktop-editor-title")?.value.trim() || activeWorkFolder?.name || "Untitled",
      workId: activeWorkFolder?.id || "",
      mediaBaseUrl: activeWorkFolder ? mediaUrlsForWorkFolder(activeWorkFolder).assetBaseUrl : "",
      documentNodes: await previewDocumentNodes(source)
    })
  });
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
    workView: document.querySelector("#work-view"),
    workTitle: document.querySelector("#work-title"),
    status: document.querySelector("#status-text"),
    settingsDialog: document.querySelector("#settings-dialog"),
    aboutDialog: document.querySelector("#about-dialog"),
    editorField: document.querySelector("#desktop-editor-field"),
    editorForm: document.querySelector("#desktop-editor-form"),
    editorInput: document.querySelector("#work-source"),
    titleInput: document.querySelector("#desktop-editor-title"),
    restoreDraft: document.querySelector("#restore-local-draft"),
    importConflictDialog: document.querySelector("#import-conflict-dialog"),
    importConflictMessage: document.querySelector("#import-conflict-message"),
    updateDialog: document.querySelector("#update-dialog"),
    updateVersion: document.querySelector("#update-version"),
    updateNotes: document.querySelector("#update-notes"),
    updateProgress: document.querySelector("#update-progress"),
    presentationExit: document.querySelector("#exit-presentation"),
    presentationStart: document.querySelector("#start-presentation")
  };
  let library = null;
  let exportMenu = null;
  let libraryConfig = {
    schema_version: 1,
    theme: "dark",
    typography: "book",
    hotkeys: {}
  };
  let workFolders = [];
  let activeWorkFolder = null;
  let presentationEditorHandle = null;
  let saveFlow = null;
  let sessionStatusKind = "clean";
  let lastSourceFile = null;
  let e2eNextSaveDelayMs = 0;
  const documentGraphCache = desktopFeatures.documentGraph ? documentGraphRuntime.createCache(async () => documentGraphRuntime.build(await fileLibrary.readDocumentGraph())) : null;
  let pendingUpdate = null;
  let libraryStatusLoaded = false;
  let processingOpenedFiles = false;
  let openFilesRequested = false;
  let openFilesWaitingForSave = false;
  let titleFlow = null;
  const startupUpdateCheck = createIdleUpdateCheck(
    () => checkForUpdates(false),
    () => !elements.workView.hidden
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
      ...updateEnabled && platform.updaterSeam ? { updater: platform.updaterSeam } : {}
    });
    authoringHostDialog.showModal();
  }
  const settingsHostDialog = elements.settingsDialog;
  const settingsMount = document.querySelector("#settings-page-mount");
  let settingsShell = null;
  function closeSettings() {
    if (settingsShell) {
      settingsShell.unmount();
      settingsShell = null;
    }
    if (settingsHostDialog.open) settingsHostDialog.close();
  }
  function vimEditorBridge() {
    const editorForVim = () => document.querySelector(".source-field")?.editorController || null;
    return {
      setVimEnabled: (enabled) => editorForVim()?.setVimEnabled(enabled),
      setEscapeKey: (key) => editorForVim()?.setEscapeKey(key),
      clearEscapeKey: () => editorForVim()?.clearEscapeKey(),
      setLineNumberMode: (mode) => editorForVim()?.setLineNumberMode(mode),
      setModeAwareCursor: (enabled) => editorForVim()?.setModeAwareCursor(enabled)
    };
  }
  async function showSettings() {
    try {
      closeSettings();
      if (libraryHost === null) {
        showError({ message: "The library is still loading. Try again in a moment." });
        return;
      }
      settingsShell = await mountElef(settingsMount, libraryHost, {
        initialUrl: "/settings",
        vimEditorBridge: vimEditorBridge(),
        onSettingsSaved: (saved) => {
          const theme = typeof saved["theme"] === "string" ? saved["theme"] : libraryConfig.theme;
          const typography = typeof saved["typography"] === "string" ? saved["typography"] : libraryConfig.typography;
          libraryConfig = { ...libraryConfig, schema_version: 1, theme, typography };
          applyTheme(theme);
          setStatus("Library settings saved");
        },
        ...updateEnabled && platform.updaterSeam ? { updater: platform.updaterSeam } : {}
      });
      settingsHostDialog.showModal();
    } catch (error) {
      showError(error);
    }
  }
  const transport = createTransportAdapter({ onConflict: (event) => saveFlow?.handleConflict(event) });
  const sessionTransport = {
    ...transport,
    saveSource: async (id, source) => {
      const isDocument = workFolders.find((workFolder) => workFolder.id === id)?.source_file === "document.md";
      if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__ && e2eNextSaveDelayMs > 0) {
        const delay = e2eNextSaveDelayMs;
        e2eNextSaveDelayMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const result = await transport.saveSource(id, source);
      if (isDocument) documentGraphCache?.invalidate();
      return result;
    }
  };
  function openSession(workFolder) {
    closeSession();
    lastSourceFile = workFolder.source_file;
    const adapter = createCodeMirrorBinding({
      getEditor: () => editorFor(elements.editorField),
      getWorkId: () => activeWorkFolder?.id,
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
    });
    session.onStatus((status) => {
      sessionStatusKind = status.kind;
      elements.restoreDraft.hidden = !session.canRestoreDraft;
      if (activeWorkFolder && activeWorkFolder.source_file !== lastSourceFile) {
        lastSourceFile = activeWorkFolder.source_file;
        syncSourceLabel();
      }
      if (status.kind === "clean" && openFilesWaitingForSave) {
        openFilesWaitingForSave = false;
        queueMicrotask(() => void processOpenedFiles());
      }
    });
    session.onExternalChange((snapshot) => {
      if (snapshot.removed || !activeWorkFolder) return;
      if (activeWorkFolder.source_file === "document.md" && (snapshot.baseline.revision !== activeWorkFolder.content_hash || snapshot.sourceFile !== activeWorkFolder.source_file)) {
        documentGraphCache?.invalidate();
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
    getWork: () => activeWorkFolder,
    getTitle: () => elements.titleInput.value,
    renameWork,
    onRenamed: (renamed) => {
      elements.workTitle.textContent = renamed.name;
      shellElement("#breadcrumb-current").textContent = renamed.name;
    },
    onState: () => {
    },
    onError: showError
  });
  const bootstrapStages = [];
  const openStageMeasurements = [];
  function measureStage(start, action) {
    if (!(typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) return action();
    const record = start();
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
  function measureBootstrapStage(name, action) {
    return measureStage(() => {
      const startedAt = performance.now();
      return () => bootstrapStages.push({ name, milliseconds: performance.now() - startedAt });
    }, action);
  }
  function measureOpenStage(name, action) {
    return measureStage(() => {
      const startedAt = performance.now();
      return () => recordOpenStage(name, startedAt);
    }, action);
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
            await openWork(id);
            if (activeWorkFolder?.id !== id || elements.editorForm.dataset.loadedWorkId !== id || shellElement("#visual-mode").disabled) throw new Error("The measured Work did not finish rendering.");
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
            return { total: workFolders.length, rendered: document.querySelectorAll("#work-list .library-card").length };
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
    const normalized = theme === "match" ? "system" : theme;
    document.documentElement.dataset.theme = ["system", "light", "dark"].includes(normalized) ? normalized : "system";
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
    elements.workView.hidden = true;
    elements.libraryName.textContent = library ? library.root.split(/[\\/]/).filter(Boolean).at(-1) || library.root : "No library selected";
    shellElement("#new-work").disabled = !library;
    shellElement("#import-elef").disabled = !library;
    shellElement("#breadcrumb-current").textContent = "Works";
    if (libraryShown) {
      shell.setFilter("all");
      void refreshLibrary();
    } else libraryShown = true;
    if (updateEnabled) void startupUpdateCheck.resume();
  }
  function currentFilter() {
    return mount.querySelector("[data-library-tab][aria-current='page']")?.dataset.libraryTab ?? "all";
  }
  async function documentGraphData() {
    return documentGraphCache?.get() || { nodes: [], edges: [] };
  }
  async function previewDocumentNodes(source) {
    if (!desktopFeatures.documentGraph || !source.includes("[[")) return [];
    try {
      return (await documentGraphData()).nodes;
    } catch (_error) {
      return [];
    }
  }
  const graphRequests = createRequestGuard();
  let graphController = null;
  async function showDocumentGraph() {
    if (!library || !desktopFeatures.documentGraph) return;
    const request = graphRequests.request();
    try {
      const graph = await documentGraphData();
      if (!graphRequests.isCurrent(request) || !libraryShown) return;
      const slot = mount.querySelector("#document-graph-view");
      if (!slot) return;
      graphController?.destroy();
      documentGraphRuntime.renderGraphView(slot, graph);
      graphController = new documentGraphRuntime.GraphController(slot, graph, { onOpenWork: (id) => void openWork(id) });
      slot.hidden = currentFilter() !== "documents";
    } catch (error) {
      showError(error);
    }
  }
  async function refreshLibrary() {
    if (!library) return;
    try {
      const [listedWorkFolders] = await Promise.all([
        fileLibrary.listWorkFolders(),
        loadDesktopAuthoringRegistry()
      ]);
      workFolders = listedWorkFolders.map(ensureWorkFolderHash);
      documentGraphCache?.invalidate();
      libraryHost?.noteListedWorkFolders(listedWorkFolders);
      await shell.refresh();
      if (currentFilter() === "documents") await showDocumentGraph();
      setStatus(`${workFolders.length} ${workFolders.length === 1 ? "Work" : "Works"}`);
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
      documentGraphCache?.invalidate();
      libraryConfig = selected.config || libraryConfig;
      workFolders = selected.work_folders.map(ensureWorkFolderHash);
      applyTheme(libraryConfig.theme);
      showLibrary();
      if (selected.config_notice) showNotice(selected.config_notice, "error");
      setStatus(`${workFolders.length} ${workFolders.length === 1 ? "Work" : "Works"}`);
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
  const openWork = createWorkOpenFlow(openWorkNow);
  async function openWorkNow(id) {
    const libraryWasHidden = elements.library.hidden;
    elements.library.hidden = true;
    const restoreLibrary = () => {
      elements.library.hidden = libraryWasHidden;
    };
    try {
      if (document.body.classList.contains("presenting-work")) await exitPresentation();
      elements.editorForm.previewController?.finishEditing();
      await Promise.resolve();
      if (activeWorkFolder && hasUnsavedChanges() && !await flushSave()) {
        restoreLibrary();
        return false;
      }
      delete elements.editorForm.dataset.loadedWorkId;
      let transition;
      do {
        transition = await prepareWorkOpen(id, {
          read: (target) => measureOpenStage("readWork", () => transport.readWorkFolder(target)),
          isDirty: hasUnsavedChanges,
          getRevision: () => saveFlow?.revision ?? 0,
          flushSave,
          prepare: (work2) => measureOpenStage("prepareWork", async () => {
            await registerEditorRuntime();
            let documentTitles2 = [];
            if (desktopFeatures.documentGraph && (work2.source_file === "document.md" || work2.source.includes("[["))) {
              try {
                const graph = await documentGraphData();
                documentTitles2 = work2.source_file === "document.md" ? graph.nodes.map((node) => node.title) : [];
              } catch (_error) {
                documentTitles2 = work2.source_file === "document.md" ? workFolders.filter((item) => item.kind === "document").map((item) => item.name) : [];
              }
            }
            return { documentTitles: documentTitles2 };
          })
        });
      } while (transition && (hasUnsavedChanges() || (saveFlow?.revision ?? 0) !== transition.revision));
      if (!transition) {
        if (activeWorkFolder) elements.editorForm.dataset.loadedWorkId = activeWorkFolder.id;
        restoreLibrary();
        return false;
      }
      const { work, prepared } = transition;
      const { documentTitles } = prepared;
      const isDocument = work.source_file === "document.md";
      if (work.id !== id) {
        workFolders = workFolders.map((item) => item.id === id ? { ...item, id: work.id } : item);
        documentGraphCache?.invalidate();
        void shell.refresh();
      }
      closeSession();
      activeWorkFolder = null;
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
        });
        const editor = await measureOpenStage("editorReady", () => editorFor(elements.editorField)?.editorReady ? editorFor(elements.editorField) : waitForEditorController(elements.editorField, editorFor));
        measureOpenStage("loadDocument", () => {
          editor.loadDocument(work.source);
          editor.setEditingMode(desktopFeatures.visualEditing ? "visual" : "source", { restoreCaret: false });
        });
      } catch (error) {
        elements.editorInput.disabled = true;
        showLibrary();
        throw error;
      }
      if (isDocument) {
        presentationEditorHandle?.destroy();
        presentationEditorHandle = null;
      } else if (desktopFeatures.presentationEditing && presentationEditorRuntime && !presentationEditorHandle) {
        presentationEditorHandle = presentationEditorRuntime.mount(elements.editorForm);
      }
      const viewSetupStartedAt = typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__ ? performance.now() : null;
      transport.activateWorkFolder(work, id);
      activeWorkFolder = work;
      openSession(work);
      elements.workTitle.textContent = work.name;
      elements.workTitle.hidden = !isDocument;
      elements.titleInput.value = work.name;
      syncSourceLabel();
      elements.editorField.dataset.editorInitialSourceValue = JSON.stringify(work.source);
      const mediaUrls = mediaUrlsForWorkFolder(work);
      elements.editorForm.dataset.previewUrlValue = mediaUrls.previewUrl;
      elements.editorForm.dataset.mediaEnabledValue = "true";
      elements.editorForm.dataset.mediaWorkKindValue = work.source_file === "document.md" ? "document" : "presentation";
      elements.editorForm.dataset.mediaUploadUrlValue = mediaUrls.uploadUrl;
      elements.editorForm.dataset.mediaAssetBaseUrlValue = mediaUrls.assetBaseUrl;
      if (desktopFeatures.documentLinks) elements.editorField.dataset.documentLinkPaletteTitlesValue = JSON.stringify(documentTitles);
      const visualButton = document.querySelector("#visual-mode");
      if (visualButton && desktopFeatures.visualEditing) {
        visualButton.disabled = true;
        visualButton.title = "Rendering preview\u2026";
      }
      elements.editorInput.disabled = false;
      shellElement("#work-id").textContent = work.id;
      elements.editorForm.dataset.loadedWorkId = work.id;
      const notice = document.querySelector("#work-notice");
      notice.textContent = work.notices.join(" ");
      notice.hidden = work.notices.length === 0;
      elements.library.hidden = true;
      elements.workView.hidden = false;
      elements.presentationStart.hidden = isDocument;
      document.body.dataset.desktopView = "editor";
      shellElement("#breadcrumb-current").textContent = work.name;
      setStatus("Work opened");
      if (viewSetupStartedAt !== null) recordOpenStage("workViewSetup", viewSetupStartedAt);
      await measureOpenStage("previewRefresh", () => elements.editorForm.previewController?.refresh());
      if (visualButton && desktopFeatures.visualEditing) enableVisualModeFromInstalledPreview(elements.editorForm);
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }
  async function renameWork(workFolder, name) {
    if (typeof name !== "string" || name.trim() === workFolder.name) return;
    const renamed = await fileLibrary.renameWorkFolder(workFolder.id, name.trim());
    if (activeWorkFolder && activeWorkFolder.id === workFolder.id) Object.assign(activeWorkFolder, renamed);
    workFolders = workFolders.map((item) => item.id === workFolder.id ? { ...item, ...renamed } : item);
    await shell.refresh();
    return renamed;
  }
  function handleLibraryEvent(event) {
    if (event.type === "renamed") {
      if (activeWorkFolder && activeWorkFolder.id === event.work.id) Object.assign(activeWorkFolder, { name: event.work.title });
      workFolders = workFolders.map((item) => item.id === event.work.id ? { ...item, name: event.work.title } : item);
    }
    if (event.type === "deleted") {
      if (activeWorkFolder?.id === event.work.id) {
        activeWorkFolder = null;
        closeSession();
      }
      workFolders = workFolders.filter((item) => item.id !== event.work.id);
      setStatus(`Moved \u201C${event.work.title}\u201D to Trash`);
    }
    if (currentFilter() === "documents") void showDocumentGraph();
  }
  function showImportConflict(error) {
    const incoming = error.details?.incoming_name || "This Work";
    const existing = error.details?.existing_name || "an existing Work";
    elements.importConflictMessage.textContent = `\u201C${incoming}\u201D has the same identity as \u201C${existing}\u201D.`;
    elements.importConflictDialog.showModal();
  }
  async function completeImport(imported) {
    if (imported.replaced && activeWorkFolder?.id === imported.work_folder.id) {
      activeWorkFolder = null;
      closeSession();
      showLibrary();
    }
    await refreshLibrary();
    setStatus((imported.replaced ? "Replaced" : "Imported") + ` \u201C${imported.work_folder.name}\u201D`);
    if (imported.name_collision) {
      showNotice(`A Work with an equivalent name already exists. Imported as \u201C${imported.work_folder.name}\u201D.`, "warning");
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
  async function exportCurrentWork() {
    if (!activeWorkFolder) {
      showNotice("Open a Work before exporting it.");
      return;
    }
    if (hasUnsavedChanges() && !await flushSave({ force: true })) return;
    try {
      if (await fileLibrary.exportElef(activeWorkFolder.id)) setStatus("Work exported");
    } catch (error) {
      showError(error);
    }
  }
  async function exportPptxCurrentWork() {
    if (!activeWorkFolder) {
      showNotice("Open a Work before exporting it.");
      return;
    }
    if (activeWorkFolder.source_file === "document.md") {
      showNotice("PowerPoint export is available for presentations.", "error");
      return;
    }
    if (hasUnsavedChanges() && !await flushSave({ force: true })) return;
    const status = shellElement("#export-pptx-status");
    try {
      status.textContent = "Preparing PowerPoint\u2026";
      const saved = await fileLibrary.exportPptx(activeWorkFolder.id, {
        title: elements.titleInput.value.trim() || activeWorkFolder.name,
        source: currentSource()
      });
      if (saved) {
        status.textContent = "PowerPoint exported.";
        setStatus("PowerPoint exported");
      } else {
        status.textContent = "";
      }
    } catch (error) {
      status.textContent = error?.message || "The PowerPoint export failed.";
      status.dataset.errorStack = String(error?.stack ?? error).slice(0, 2e3);
      console.error("[pptx-export]", error);
      showError(error);
    }
  }
  async function importWork() {
    if (!library) {
      showNotice("Choose a library before importing a Work.");
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
    if (!updateEnabled) return false;
    if (showNoUpdate) startupUpdateCheck.cancel();
    try {
      const update = await checkForUpdate();
      if (!update) {
        if (showNoUpdate) setStatus("Elef is up to date");
        return false;
      }
      await pendingUpdate?.dispose().catch(() => {
      });
      pendingUpdate = update;
      elements.updateVersion.textContent = "Version " + update.version + " is ready to install on quit.";
      elements.updateNotes.textContent = update.notes;
      elements.updateProgress.textContent = "The update signature will be verified before installation.";
      elements.updateDialog.showModal();
      return true;
    } catch (_error) {
      if (showNoUpdate) showError({ message: "Could not check for updates. Try again while online." });
      return false;
    }
  }
  async function armUpdateForQuit() {
    if (!pendingUpdate || !updateRuntime) return;
    const update = pendingUpdate;
    pendingUpdate = null;
    updateRuntime.armPendingUpdate(update);
    elements.updateDialog.close();
    setStatus(`Elef will install version ${update.version} when you quit.`);
  }
  async function printCurrentWork() {
    if (!activeWorkFolder) {
      showNotice("Open a Work before printing it.");
      return;
    }
    if (hasUnsavedChanges() && !await flushSave()) return;
    const preview = document.querySelector("#desktop-preview");
    if (!preview.childElementCount && !await elements.editorForm.previewController?.refresh()) {
      showNotice("Render the Work before printing it.", "error");
      return;
    }
    document.body.classList.add("printing-work");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const printViaNative = typeof fileLibrary.printWork === "function";
      if (printViaNative) await fileLibrary.printWork();
      else window.print();
      if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) {
        globalThis.__elefPrintResult = { native: printViaNative };
      }
    } catch (error) {
      console.error("[desktop-print]", error);
      showNotice("The print dialog could not be opened.", "error");
    } finally {
      document.body.classList.remove("printing-work");
    }
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
    if (!activeWorkFolder || activeWorkFolder.source_file === "document.md") {
      showNotice("Open a presentation Work to start presentation mode.");
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
    document.body.classList.add("presenting-work");
    elements.presentationExit.hidden = false;
    elements.presentationStart.hidden = true;
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
    if (!document.body.classList.contains("presenting-work")) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    void exitPresentation();
  }
  async function exitPresentation() {
    if (!document.body.classList.contains("presenting-work")) return;
    document.body.classList.remove("presenting-work");
    elements.presentationExit.hidden = true;
    elements.presentationStart.hidden = !activeWorkFolder || activeWorkFolder.source_file === "document.md";
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
  function exportMenuProps() {
    const kind = activeWorkFolder?.source_file === "document.md" ? "document" : "presentation";
    return {
      menuId: "export-menu",
      buttonId: "export-menu-button",
      menuLabel: "Export",
      statusId: "export-pptx-status",
      options: exportMenuOptionsFor({
        kind,
        editions: [{
          edition: "draft",
          onPrint: () => printCurrentWork(),
          onExportPptx: () => exportPptxCurrentWork(),
          printOptionId: "print-work",
          pptxOptionId: "export-pptx"
        }]
      })
    };
  }
  function syncSourceLabel() {
    if (!activeWorkFolder) return;
    shellElement("#work-source-name").textContent = activeWorkFolder.source_file;
    shellElement("#work-kind").textContent = activeWorkFolder.source_file === "document.md" ? "DOCUMENT" : "PRESENTATION";
    exportMenu?.update(exportMenuProps());
  }
  async function handleMenuAction(action) {
    if (action === "quit") return getCurrentWindow().close();
    if (action === "choose-library") return chooseLibrary();
    if (action === "refresh-library") return refreshLibrary();
    if (action === "open-work") {
      if (!library) return chooseLibrary();
      if (hasUnsavedChanges() && !await flushSave()) return;
      showLibrary();
      mount.querySelector("#library-search")?.focus();
      return;
    }
    if (action === "show-library") {
      if (!library) return chooseLibrary();
      if (hasUnsavedChanges() && !await flushSave()) return;
      showLibrary();
      return;
    }
    if (action === "new-presentation") return showCreateDialog("presentation");
    if (action === "new-document") return showCreateDialog("document");
    if (action === "save") return flushSave({ force: true });
    if (action === "export-elef") return exportCurrentWork();
    if (action === "export-pptx") return exportPptxCurrentWork();
    if (action === "import-elef") return importWork();
    if (action === "settings") return showSettings();
    if (action === "check-for-updates") return checkForUpdates(true);
    if (action === "export-diagnostics") return fileLibrary.exportDiagnostics();
    if (action === "about") return elements.aboutDialog.showModal();
    if (action === "start-presentation") return startPresentation();
    if (action === "print") return printCurrentWork();
  }
  shellElement("#choose-library").addEventListener("click", () => void chooseLibrary());
  shellElement("#change-library").addEventListener("click", () => void chooseLibrary());
  shellElement(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    shellElement("#back-to-library").click();
  });
  shellElement("#open-settings").addEventListener("click", () => void showSettings());
  shellElement("#new-work").addEventListener("click", () => {
    showCreateDialog(currentFilter() === "documents" ? "document" : "presentation");
  });
  shellElement("#refresh-library").addEventListener("click", () => void refreshLibrary());
  shellElement("#import-elef").addEventListener("click", () => void importWork());
  exportMenu = mountExportMenu(shellElement("#export-menu-mount"), exportMenuProps());
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
  settingsHostDialog.addEventListener("close", () => {
    if (settingsShell) {
      settingsShell.unmount();
      settingsShell = null;
    }
  });
  shellElement("#manage-authoring").addEventListener("click", () => {
    closeSettings();
    void openAuthoringSettings();
  });
  if (updateEnabled) shellElement("#check-for-updates").addEventListener("click", () => void checkForUpdates(true));
  shellElement("#install-update").addEventListener("click", () => void armUpdateForQuit());
  elements.presentationExit.addEventListener("click", () => void exitPresentation());
  elements.presentationStart.addEventListener("click", () => void startPresentation());
  shellElement("#update-later").addEventListener("click", () => elements.updateDialog.close());
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
    onError: showError,
    updateRuntime
  }));
  window.addEventListener("keydown", (event) => {
    const action = desktopMenuKeyAction(event);
    if (action === "focus-search") {
      event.preventDefault();
      mount.querySelector("#library-search")?.focus();
    } else if (action === "start-presentation") {
      event.preventDefault();
      void handleMenuAction("start-presentation");
    }
  });
  void listen("desktop-menu-action", (event) => void handleMenuAction(event.payload));
  const openedFileListener = listen("desktop-open-elef", () => void processOpenedFiles());
  async function mountLibrary(status) {
    libraryHost = createLibraryHost(status);
    shell = await mountElef(mount, libraryHost, {
      initialUrl: location.href,
      graphEnabled: desktopFeatures.documentGraph,
      // The desktop has no URL routing: work targets open in the embedded
      // editor, tab targets only move the location hash for deep-linking.
      navigate: (target) => {
        if (!("url" in target)) {
          void openWork(target.workId);
          return;
        }
        if (target.url.startsWith("#")) location.hash = target.url;
        if (parseLibraryRoute(target.url)?.filter === "documents") void showDocumentGraph();
      },
      resolveMediaBaseUrl: (work) => mediaUrlsForWorkFolder(work.id).assetBaseUrl,
      presentWork: (work) => {
        void openWork(work.id).then((opened) => {
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
      workFolders = (status?.work_folders || []).map(ensureWorkFolderHash);
      await mountLibrary(status);
      applyTheme(libraryConfig.theme);
      measureBootstrapStage("initial-library-render", showLibrary);
      if (status?.config_notice) showNotice(status.config_notice, "error");
      setStatus(library ? `${workFolders.length} ${workFolders.length === 1 ? "Work" : "Works"}` : "Choose a library folder to begin");
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
        formControllers: editorFormControllers,
        documentLinksEnabled: desktopFeatures.documentLinks,
        visualEditingEnabled: desktopFeatures.visualEditing,
        presentationEditingEnabled: desktopFeatures.presentationEditing,
        slideOverviewEnabled: desktopFeatures.slideOverview
      });
      await measureBootstrapStage("editor-ready", () => waitForEditorController(elements.editorField, editorFor));
    },
    confirmReady: async () => {
      const removed = await measureBootstrapStage("native-ready-ack", () => fileLibrary.confirmAppReady());
      if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) window.__elefPerformanceTestHooks?.ready(removed);
      void fileLibrary.pendingOpenedElefCount().then((count) => {
        if (count) void processOpenedFiles();
      }).catch(showError);
      if (updateEnabled) startupUpdateCheck.schedule(1e4);
    }
  }).catch((error) => {
    recordBootstrapFailure?.();
    showError(error);
  });
}
export {
  startFileLibraryApplication
};

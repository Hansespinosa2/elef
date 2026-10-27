import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { completeBootstrap } from "./bootstrap-flow.js"
import { createCloseFlow } from "./close-flow.js"
import { createDiagnosticFailures } from "./diagnostic-failures.js"
import { installDesktopDropGuard } from "./desktop-drop-guard.js"
import { createTransportAdapter } from "./transport-adapter.js"
import { createMediaFetch, mediaUrlsForWorkFolder } from "./media-transport.js"
import { createPreviewFetch } from "./preview-transport.js"
import { createIdleUpdateCheck } from "./update-flow.js"
import { createFileLibraryTransport } from "#desktop/file-library-transport"
import { createDesktopUpdateRuntime } from "#desktop/update-runtime"
import { continuousEditorRuntime, presentationEditorRuntime, registerEditorRuntime } from "#desktop/editor-runtime"
import { documentGraphRuntime } from "#desktop/document-graph-runtime"
import { desktopFeatureFlags, desktopFeatures, desktopProfile } from "./desktop-profile.js"
import { createTauriHost } from "./tauri-host.js"
import { createTauriAuthoringTransport } from "./tauri-authoring-transport.js"
import builtInRegistry from "../../../../apps/web/app/javascript/data/default_authoring_registry.json"
import { mergeAuthoringRegistryEntries, startFileLibraryApplication } from "@elef/editor-runtime"
import { createQuietSavePolicy } from "./quiet-save-policy.js"
import { desktopAuthoringRegistry, loadDesktopAuthoringRegistry } from "./authoring-registry-loader.js"
import "../../../../apps/web/app/assets/stylesheets/application.css"

const fileLibrary = createFileLibraryTransport({ invoke })
const updateRuntime = createDesktopUpdateRuntime({ invoke })
const diagnosticFailures = createDiagnosticFailures(invoke)
const nativeFetch = globalThis.fetch.bind(globalThis)
installDesktopDropGuard()

startFileLibraryApplication({
  fileLibrary,
  profile: desktopProfile,
  features: desktopFeatures,
  featureFlags: desktopFeatureFlags,
  documentGraphRuntime,
  presentationEditorRuntime,
  continuousEditorRuntime,
  updateRuntime,
  updateEnabled: updateRuntime.enabled,
  createLibraryHost: (initialStatus) => createTauriHost({ invoke, initialStatus, updaterEnabled: updateRuntime.enabled }),
  listen,
  getCurrentWindow,
  completeBootstrap,
  createCloseFlow,
  createTransportAdapter: options => createTransportAdapter({ invoke, ...options }),
  installFetchTransport: options => {
    const mediaFetch = createMediaFetch({ invoke, fetchImpl: nativeFetch })
    const previewTrace = []
    if (__ELEF_E2E__) globalThis.__elefPreviewTrace = previewTrace
    globalThis.fetch = createPreviewFetch({
      ...options,
      fetchImpl: mediaFetch,
      onFailure: diagnosticFailures.recordPreviewFailure,
      onEvent: __ELEF_E2E__ ? event => {
        previewTrace.push(event)
        if (previewTrace.length > 512) previewTrace.shift()
      } : undefined
    })
    return () => previewTrace.slice()
  },
  mediaUrlsForWorkFolder,
  checkForUpdate: updateRuntime.checkForUpdate,
  createIdleUpdateCheck,
  installPendingUpdate: updateRuntime.installPendingUpdate,
  desktopAuthoringRegistry,
  loadDesktopAuthoringRegistry,
  authoringTransport: createTauriAuthoringTransport({
    invoke,
    builtInEntries: builtInRegistry,
    mergeEntries: mergeAuthoringRegistryEntries
  }),
  updaterSeam: updateRuntime.updaterSeam,
  quietSavePolicy: createQuietSavePolicy(),
  recordBootstrapFailure: diagnosticFailures.recordBootstrapFailure,
  registerEditorRuntime
})

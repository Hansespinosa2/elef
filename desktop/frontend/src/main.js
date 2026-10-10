import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { completeBootstrap } from "./bootstrap-flow.js"
import { createCloseFlow } from "./close-flow.js"
import { createTransportAdapter } from "./transport-adapter.js"
import { createMediaFetch, mediaUrlsForDeck } from "./media-transport.js"
import { createPreviewFetch } from "./preview-transport.js"
import { createDiagnosticFailures } from "./diagnostic-failures.js"
import { createIdleUpdateCheck } from "./update-flow.js"
import { createFileLibraryTransport } from "#desktop/file-library-transport"
import { createDesktopUpdateRuntime } from "#desktop/update-runtime"
import { desktopAuthoringRegistry, loadDesktopAuthoringRegistry } from "./authoring-registry-loader.js"
import { loadEditorRuntime, loadLibraryRuntime } from "#desktop/editor-runtime"
import { documentGraphRuntime } from "#desktop/document-graph-runtime"
import { startFileLibraryApplication } from "lib/file_library_application"
import "../../../app/assets/stylesheets/application.css"

const isStableProfile = __ELEF_DESKTOP_PROFILE__ === "stable"
const updateRuntime = createDesktopUpdateRuntime({ invoke })
const diagnosticFailures = createDiagnosticFailures(invoke)
const desktopFeatures = Object.freeze({
  visualEditing: !isStableProfile,
  presentationEditing: !isStableProfile,
  slideOverview: !isStableProfile,
  documentGraph: !isStableProfile,
  documentLinks: !isStableProfile
})
const featureFlags = Object.freeze({
  ELEF_ENABLE_REVISIONS: !isStableProfile,
  ELEF_ENABLE_LINEAGE: !isStableProfile
})

const fileLibrary = createFileLibraryTransport({ invoke })
const nativeFetch = globalThis.fetch.bind(globalThis)

startFileLibraryApplication({
  fileLibrary,
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
  mediaUrlsForDeck,
  checkForUpdate: updateRuntime.checkForUpdate,
  createIdleUpdateCheck,
  installPendingUpdate: updateRuntime.installPendingUpdate,
  profile: __ELEF_DESKTOP_PROFILE__,
  features: desktopFeatures,
  featureFlags,
  documentGraphRuntime,
  updateEnabled: updateRuntime.enabled,
  recordBootstrapFailure: diagnosticFailures.recordBootstrapFailure,
  desktopAuthoringRegistry,
  loadDesktopAuthoringRegistry,
  loadEditorRuntime,
  loadLibraryRuntime
})

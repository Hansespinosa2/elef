import { Channel, invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { relaunch } from "@tauri-apps/plugin-process"
import { check as checkUpdater } from "@tauri-apps/plugin-updater"
import { completeBootstrap } from "./bootstrap-flow.js"
import { createCloseFlow } from "./close-flow.js"
import { createTransportAdapter } from "./transport-adapter.js"
import { createMediaFetch, mediaUrlsForDeck } from "./media-transport.js"
import { createPreviewFetch } from "./preview-transport.js"
import { checkForDesktopUpdate, createIdleUpdateCheck, installDesktopUpdate } from "./update-flow.js"
import { createFileLibraryTransport } from "./file-library-transport.js"
import { createTauriHost } from "./tauri-host.js"
import { createTauriAuthoringTransport } from "./tauri-authoring-transport.js"
import { createDesktopUpdaterSeam } from "./update-flow.js"
import builtInRegistry from "../../../../apps/web/app/javascript/data/default_authoring_registry.json"
import { mergeAuthoringRegistryEntries, registerEditorRuntime, startFileLibraryApplication } from "@elef/editor-runtime"
import { createQuietSavePolicy } from "./quiet_save_policy.js"
import { desktopAuthoringRegistry, loadDesktopAuthoringRegistry } from "./authoring-registry-loader.js"
import "../../../../apps/web/app/assets/stylesheets/application.css"

const fileLibrary = createFileLibraryTransport({ invoke })
const nativeFetch = globalThis.fetch.bind(globalThis)

startFileLibraryApplication({
  fileLibrary,
  createLibraryHost: (initialStatus) => createTauriHost({ invoke, initialStatus }),
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
      onEvent: __ELEF_E2E__ ? event => {
        previewTrace.push(event)
        if (previewTrace.length > 512) previewTrace.shift()
      } : undefined
    })
    return () => previewTrace.slice()
  },
  mediaUrlsForDeck,
  checkForUpdate: () => checkForDesktopUpdate(
    () => checkUpdater({ timeout: 10_000 }),
    (version, onProgress) => invoke("install_update", { version, onProgress: new Channel(onProgress) })
  ),
  createIdleUpdateCheck,
  installPendingUpdate: (update, options) => installDesktopUpdate(update, { ...options, relaunch }),
  desktopAuthoringRegistry,
  loadDesktopAuthoringRegistry,
  authoringTransport: createTauriAuthoringTransport({
    invoke,
    builtInEntries: builtInRegistry,
    mergeEntries: mergeAuthoringRegistryEntries
  }),
  updaterSeam: createDesktopUpdaterSeam({ check: () => checkUpdater({ timeout: 10_000 }) }),
  quietSavePolicy: createQuietSavePolicy(),
  registerEditorRuntime
})

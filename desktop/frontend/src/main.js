import { Channel, invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { relaunch } from "@tauri-apps/plugin-process"
import { check as checkUpdater } from "@tauri-apps/plugin-updater"
import { completeBootstrap } from "./bootstrap-flow.js"
import { createCloseFlow } from "./close-flow.js"
import { createTransportAdapter } from "./transport-adapter.js"
import { createMediaFetch } from "./media-transport.js"
import { createPreviewFetch } from "./preview-transport.js"
import { checkForDesktopUpdate, createIdleUpdateCheck, installDesktopUpdate } from "./update-flow.js"
import { createFileLibraryTransport } from "./file-library-transport.js"
import { desktopAuthoringRegistry, loadDesktopAuthoringRegistry } from "./authoring-registry-loader.js"
import { loadEditorRuntime, loadLibraryRuntime } from "lib/editor_runtime"
import { startFileLibraryApplication } from "lib/file_library_application"
import "../../../app/assets/stylesheets/application.css"

const fileLibrary = createFileLibraryTransport({ invoke })

startFileLibraryApplication({
  fileLibrary,
  listen,
  getCurrentWindow,
  completeBootstrap,
  createCloseFlow,
  createTransportAdapter: options => createTransportAdapter({ invoke, ...options }),
  createMediaFetch: options => createMediaFetch({ invoke, ...options }),
  createPreviewFetch,
  checkForUpdate: () => checkForDesktopUpdate(
    () => checkUpdater({ timeout: 10_000 }),
    (version, onProgress) => invoke("install_update", { version, onProgress: new Channel(onProgress) })
  ),
  createIdleUpdateCheck,
  installPendingUpdate: (update, options) => installDesktopUpdate(update, { ...options, relaunch }),
  desktopAuthoringRegistry,
  loadDesktopAuthoringRegistry,
  loadEditorRuntime,
  loadLibraryRuntime
})

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
import { desktopAuthoringRegistry, loadDesktopAuthoringRegistry } from "./authoring-registry-loader.js"
import { loadDesktopEditorRuntime, loadDesktopLibraryRuntime } from "./editor-runtime.js"
import { startFileLibraryApplication } from "lib/file_library_application"
import "../../../app/assets/stylesheets/application.css"

startFileLibraryApplication({
  Channel,
  invoke,
  listen,
  getCurrentWindow,
  relaunch,
  checkUpdater,
  completeBootstrap,
  createCloseFlow,
  createTransportAdapter,
  createMediaFetch,
  createPreviewFetch,
  checkForDesktopUpdate,
  createIdleUpdateCheck,
  installDesktopUpdate,
  desktopAuthoringRegistry,
  loadDesktopAuthoringRegistry,
  loadDesktopEditorRuntime,
  loadDesktopLibraryRuntime
})

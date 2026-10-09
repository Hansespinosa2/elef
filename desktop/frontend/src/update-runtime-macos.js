import { Channel } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"
import { check as checkUpdater } from "@tauri-apps/plugin-updater"
import { checkForDesktopUpdate, installDesktopUpdate } from "./update-flow.js"

export function createDesktopUpdateRuntime({ invoke }) {
  return Object.freeze({
    enabled: true,
    checkForUpdate: () => checkForDesktopUpdate(
      () => checkUpdater({ timeout: 10_000 }),
      (version, onProgress) => invoke("install_update", { version, onProgress: new Channel(onProgress) })
    ),
    installPendingUpdate: (update, options) => installDesktopUpdate(update, { ...options, relaunch })
  })
}

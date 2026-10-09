import { Channel } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"
import { checkForDesktopUpdate, installDesktopUpdate } from "./update-flow.js"

export function createDesktopUpdateRuntime({ invoke }) {
  return Object.freeze({
    enabled: true,
    checkForUpdate: () => checkForDesktopUpdate(() => invoke("stage_update", { onProgress: new Channel(() => {}) })),
    installPendingUpdate: update => installDesktopUpdate(update, {
      install: version => invoke("install_update", { version }),
      relaunch
    })
  })
}

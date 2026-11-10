import { Channel } from "@tauri-apps/api/core"
import { check as pluginCheck } from "@tauri-apps/plugin-updater"
import { checkForDesktopUpdate, createDesktopUpdaterSeam, installDesktopUpdate } from "./update-flow.js"

// macOS owns preparation and activation. Consent, download, signature checking
// and installation into a private copy happen before quit. Quit activates only
// that native-held copy, without another prompt, network request or restart.
export function createDesktopUpdateRuntime({ invoke, check = pluginCheck } = {}) {
  if (typeof invoke !== "function") throw new TypeError("The macOS update runtime needs the Tauri invoke bridge.")
  const checkForPluginUpdate = () => check({ timeout: 10_000 })
  let armed = null
  const disposeArmed = () => {
    const update = armed
    armed = null
    if (update) void update.dispose().catch(() => {})
  }
  return Object.freeze({
    enabled: true,
    checkForUpdate: () => checkForDesktopUpdate(
      checkForPluginUpdate,
      (version, onProgress) => invoke("install_update", { version, prepareOnly: false, onProgress: new Channel(onProgress) })
    ),
    installPendingUpdate: (update, options) => installDesktopUpdate(update, options),
    updaterSeam: createDesktopUpdaterSeam({ check: checkForPluginUpdate }),
    async armPendingUpdate(update, { onProgress = () => {} } = {}) {
      if (armed) {
        await update.dispose().catch(() => {})
        return false
      }
      const preparation = invoke("install_update", {
        version: update.version, prepareOnly: true, onProgress: new Channel(onProgress)
      })
      // Arm immediately so every quit path waits for an in-flight download.
      // Activation still requires the native preparation to succeed first.
      const pending = {
        ...update,
        install: async progress => await preparation ? update.install(progress) : false
      }
      armed = pending
      try {
        const prepared = await preparation
        if (!prepared && armed === pending) disposeArmed()
        return prepared
      } catch (error) {
        if (armed === pending) disposeArmed()
        throw error
      }
    },
    peekArmedUpdate() {
      return armed
    },
    takeArmedUpdate() {
      const update = armed
      armed = null
      return update
    },
    clearArmedUpdate() {
      disposeArmed()
    }
  })
}

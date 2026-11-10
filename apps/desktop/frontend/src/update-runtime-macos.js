import { Channel } from "@tauri-apps/api/core"
import { relaunch as pluginRelaunch } from "@tauri-apps/plugin-process"
import { check as pluginCheck } from "@tauri-apps/plugin-updater"
import { checkForDesktopUpdate, createDesktopUpdaterSeam, installDesktopUpdate } from "./update-flow.js"

// macOS-only update runtime: the single updater-capable runtime. The build
// selects it only for Stable macOS and the macOS E2E bundle; every other
// build resolves #desktop/update-runtime to the disabled runtime, so Linux
// bundles carry no updater code path at all. The plugin check plus the
// native confirmed install command are the whole flow (no staged split).
// The runtime also owns the safe-quit arming state: the update dialog arms
// a checked update here, and the close flow installs it on a safe ordinary
// quit after the quiet-save flush succeeds.
export function createDesktopUpdateRuntime({ invoke, check = pluginCheck, relaunch = pluginRelaunch } = {}) {
  if (typeof invoke !== "function") throw new TypeError("The macOS update runtime needs the Tauri invoke bridge.")
  // Keep packaged E2E WebDriver attached until replacement assertions finish;
  // its runner launches the installed app in a second session. Production
  // builds erase this dependency injection. Tauri's IPC bridge stays intact.
  if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) {
    const hooks = { installRequests: [], relaunchRequested: false }
    globalThis.__elefUpdateTestHooks = hooks
    const nativeInvoke = invoke
    invoke = (command, args) => {
      if (command === "install_update") hooks.installRequests.push(args.version)
      return nativeInvoke(command, args)
    }
    relaunch = async () => { hooks.relaunchRequested = true }
  }
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
      (version, onProgress) => invoke("install_update", { version, onProgress: new Channel(onProgress) })
    ),
    installPendingUpdate: (update, options) => installDesktopUpdate(update, { ...options, relaunch }),
    updaterSeam: createDesktopUpdaterSeam({ check: checkForPluginUpdate }),
    armPendingUpdate(update) {
      disposeArmed()
      armed = update
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

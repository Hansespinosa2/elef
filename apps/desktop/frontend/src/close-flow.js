// Native close/Quit flow: dirty windows flush silently before closing. A clean
// flush closes; a conflict stays open because the conflict dialog already
// warns; only a failed flush asks the native discard confirmation.
//
// Safe-quit update activation composes with the flush outcomes when the host
// passes its update runtime (macOS only, where the update dialog can arm an
// update; the disabled runtime never arms):
// - clean, or a "saved" flush, with an armed update installs it and relaunches
//   instead of closing; a cancelled native confirmation disarms and the
//   requested quit proceeds instead;
// - a "failed" or "conflict" flush with an armed update defers the update
//   (disarms it) and stays open with no new prompt; without an armed update
//   the failed/conflict paths behave exactly as before;
// - an install error is reported and the app stays open with the update
//   disarmed, so the next quit is an ordinary quit.
export function createCloseFlow({ isDirty, flushForClose, close, confirmDiscard = null, onError = () => {}, updateRuntime = null }) {
  let pending = null
  const installArmedUpdate = async () => {
    const armed = updateRuntime.takeArmedUpdate()
    if (!armed) return "absent"
    let installed = false
    try {
      installed = await updateRuntime.installPendingUpdate(armed, {})
    } finally {
      await armed.dispose().catch(() => {})
    }
    return installed ? "installed" : "deferred"
  }
  return event => {
    let dirty
    try {
      dirty = isDirty()
    } catch (error) {
      event.preventDefault()
      onError(error)
      return
    }
    const armed = updateRuntime?.peekArmedUpdate() ?? null
    if (!dirty && !armed) return
    event.preventDefault()
    if (pending) return pending
    pending = (async () => {
      try {
        if (!dirty) {
          // A clean quit with an armed update is already safe: install and
          // relaunch instead of closing.
          if (await installArmedUpdate() !== "installed") await close()
          return
        }
        const outcome = await flushForClose()
        if (outcome === "saved") {
          if (armed && await installArmedUpdate() === "installed") return
          await close()
        } else if (armed) {
          // An unsafe save defers the armed update and keeps the app open.
          updateRuntime.clearArmedUpdate()
        } else if (outcome === "failed" && typeof confirmDiscard === "function") {
          if (await confirmDiscard()) await close()
        }
      } catch (error) {
        onError(error)
      } finally {
        pending = null
      }
    })()
    return pending
  }
}

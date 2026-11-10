// Native close/Quit flow: dirty windows flush silently before closing. `close`
// completes an approved close without emitting another close request. A clean
// flush closes; a conflict stays open because the conflict dialog already
// warns; only a failed flush asks the native discard confirmation.
//
// A consented update may still be downloading. Keep the window open and input
// inert until preparation and safe-save activation finish. Failed/conflicted
// saves retain the prepared update for the next safe quit. Installation errors
// stay visible; only a successful activation (or cancelled preparation) closes.
export function createCloseFlow({ isDirty, flushForClose, close, confirmDiscard = null, onError = () => {}, updateRuntime = null, setClosing = () => {} }) {
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
    // Taking the armed update clears it before the asynchronous native install.
    // Keep *all* subsequent close requests blocked until that operation ends,
    // even when saving has made the editor clean and no armed handle remains.
    if (pending) {
      event.preventDefault()
      return pending
    }
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
    pending = (async () => {
      try {
        setClosing(true)
        if (!dirty) {
          await installArmedUpdate()
          await close()
          return
        }
        const outcome = await flushForClose()
        if (outcome === "saved") {
          if (armed) await installArmedUpdate()
          await close()
        } else if (armed) {
          // Preserve the approved update while the user resolves the save.
          // The next safe quit can activate it without asking for consent again.
        } else if (outcome === "failed" && typeof confirmDiscard === "function") {
          if (await confirmDiscard()) await close()
        }
      } catch (error) {
        onError(error)
      } finally {
        setClosing(false)
        pending = null
      }
    })()
    return pending
  }
}

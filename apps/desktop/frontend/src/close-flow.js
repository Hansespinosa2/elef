// Native close/Quit flow: dirty windows flush silently before closing. A clean
// flush closes; a conflict stays open because the conflict dialog already
// warns; only a failed flush asks the native discard confirmation.
export function createCloseFlow({ isDirty, flushForClose, close, confirmDiscard = null, onError = () => {} }) {
  let pending = null
  return event => {
    try {
      if (!isDirty()) return
    } catch (error) {
      event.preventDefault()
      onError(error)
      return
    }
    event.preventDefault()
    if (pending) return pending
    pending = (async () => {
      try {
        const outcome = await flushForClose()
        if (outcome === "saved") {
          await close()
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

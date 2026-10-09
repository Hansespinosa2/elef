export function createCloseFlow({
  isDirty,
  flushSave,
  close,
  shouldPrepareClose = () => false,
  prepareClose = async () => "close",
  onError = () => {}
}) {
  let pending = null
  return event => {
    let dirty
    let needsPreparation
    try {
      dirty = isDirty()
      needsPreparation = shouldPrepareClose()
    } catch (error) {
      event.preventDefault()
      onError(error)
      return
    }
    if (!dirty && !needsPreparation) return
    event.preventDefault()
    if (pending) return pending
    pending = (async () => {
      try {
        if (dirty && !await flushSave()) return
        const outcome = await prepareClose()
        if (outcome !== "relaunch") await close()
      } catch (error) {
        onError(error)
      } finally {
        pending = null
      }
    })()
    return pending
  }
}

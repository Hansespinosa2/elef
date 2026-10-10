export function createCloseFlow({
  isDirty,
  flushSave,
  close,
  shouldPrepareClose = () => false,
  prepareClose = async () => "close",
  setEditingLocked = () => {},
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
    try {
      // Lock editing in the same turn as the close request. The save and the
      // safe-version recheck below both await, so leaving the editor active
      // would allow new input after the dirty snapshot had been taken.
      setEditingLocked(true)
    } catch (error) {
      onError(error)
      return
    }
    pending = (async () => {
      let keepEditingLocked = false
      try {
        if (dirty && !await flushSave()) return
        const outcome = await prepareClose()
        if (outcome === "relaunch") {
          keepEditingLocked = true
          return
        }
        await close()
      } catch (error) {
        onError(error)
      } finally {
        pending = null
        if (!keepEditingLocked) {
          try {
            setEditingLocked(false)
          } catch (error) {
            onError(error)
          }
        }
      }
    })()
    return pending
  }
}

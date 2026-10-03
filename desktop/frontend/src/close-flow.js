export function createCloseFlow({ isDirty, flushSave, close, onError = () => {} }) {
  let pending = null
  return event => {
    if (!isDirty()) return
    event.preventDefault()
    if (pending) return pending
    pending = (async () => {
      try {
        if (await flushSave()) await close()
      } catch (error) {
        onError(error)
      } finally {
        pending = null
      }
    })()
    return pending
  }
}

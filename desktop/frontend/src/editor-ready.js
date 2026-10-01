export function waitForEditorController(field, findController, { timeoutMs = 5_000 } = {}) {
  const available = findController(field)
  if (available) return Promise.resolve(available)

  return new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      field.removeEventListener("elef:editor-ready", onReady)
    }
    const onReady = () => {
      cleanup()
      const controller = findController(field)
      if (controller) resolve(controller)
      else reject(editorUnavailable())
    }
    field.addEventListener("elef:editor-ready", onReady, { once: true })
    timer = setTimeout(() => {
      cleanup()
      reject(editorUnavailable())
    }, timeoutMs)
  })
}

function editorUnavailable() {
  return Object.assign(new Error("The editor did not finish loading. Try closing and reopening this deck."), {
    code: "editor_unavailable",
    retryable: true
  })
}

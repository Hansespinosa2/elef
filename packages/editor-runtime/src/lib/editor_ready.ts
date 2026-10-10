import type { Controller } from "@hotwired/stimulus";

export function waitForEditorController(
  field: Element,
  findController: (field: Element) => Controller | null | undefined,
  { timeoutMs = 5_000 }: { timeoutMs?: number } = {}
): Promise<Controller> {
  const available = findController(field)
  if (available?.editorReady === true) return Promise.resolve(available)

  return new Promise<Controller>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(timer)
      field.removeEventListener("elef:editor-ready", onReady)
    }
    const onReady = () => {
      cleanup()
      const controller = findController(field)
      if (controller?.editorReady === true) resolve(controller)
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

import type { EditorHandle } from "@elef/client/editor";

export function waitForEditorController(
  field: Element,
  findController: (field: Element) => EditorHandle | null | undefined,
  { timeoutMs = 5_000 }: { timeoutMs?: number } = {}
): Promise<EditorHandle> {
  const available = findController(field)
  if (available?.editorReady === true) return Promise.resolve(available)

  return new Promise<EditorHandle>((resolve, reject) => {
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
  return Object.assign(new Error("The editor did not finish loading. Try closing and reopening this Work."), {
    code: "editor_unavailable",
    retryable: true
  })
}

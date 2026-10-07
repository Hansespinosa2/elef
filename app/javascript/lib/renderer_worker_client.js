const RENDER_TIMEOUT_MS = 4_000

export function createRendererClient({
  WorkerClass = globalThis.Worker,
  timeoutMs = RENDER_TIMEOUT_MS,
  workerUrl = new URL("./renderer-worker.js", import.meta.url)
} = {}) {
  let worker = null
  let nextId = 0
  const pending = new Map()

  function failAll(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
    worker?.terminate()
    worker = null
  }

  function ensureWorker() {
    if (worker) return worker
    if (typeof WorkerClass !== "function") throw Object.assign(new Error("Preview workers are unavailable."), { code: "unsupported", retryable: false })
    worker = new WorkerClass(workerUrl, { type: "module", name: "elef-markdown-renderer" })
    worker.addEventListener("message", ({ data }) => {
      const request = pending.get(data?.id)
      if (!request) return
      pending.delete(data.id)
      clearTimeout(request.timer)
      if (data.error) {
        request.reject(Object.assign(new Error(data.error.message), data.error))
      } else {
        request.resolve(data.result)
      }
    })
    worker.addEventListener("error", () => failAll(Object.assign(new Error("The preview renderer stopped unexpectedly."), { code: "render_error", retryable: true })))
    return worker
  }

  function request(input) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const request = pending.get(id)
        pending.delete(id)
        const error = Object.assign(new Error("Preview took too long and was stopped. Your source is safe."), { code: "render_timeout", retryable: true })
        request?.reject(error)
        failAll(error)
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        ensureWorker().postMessage({ id, input })
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  }

  return {
    render(input) {
      return request(input)
    },
    renderMarkdownBlock(source) {
      return request({ kind: "markdown-block", source })
    },
    terminate() {
      failAll(Object.assign(new Error("Preview renderer was closed."), { code: "render_cancelled", retryable: false }))
    },
    get pendingCount() { return pending.size }
  }
}

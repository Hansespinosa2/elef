const RENDER_TIMEOUT_MS = 4_000

export function createRendererClient({
  WorkerClass = globalThis.Worker,
  timeoutMs = RENDER_TIMEOUT_MS,
  workerUrl = new URL("./renderer-worker.js", import.meta.url)
} = {}) {
  let worker = null
  let nextId = 0
  const pending = new Map()
  // Best-effort prewarm, attempted once: real requests use ids from 1 up,
  // so id 0 never collides with the pending map and its reply is ignored.
  const WARMUP_ID = 0
  let warmupPromise = null

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

  // A tiny deck through the same entry point as every preview: two slides
  // (splitter), inline math (KaTeX) and a fenced block (highlight), so the
  // first real render meets compiled code, not a cold worker.
  const WARMUP_DECK = "# Warmup\n\nInline $x^2$ math.\n\n```js\nconst warm = 1\n```\n\n---\n\nSecond slide.\n"

  function warmup() {
    if (!warmupPromise) {
      warmupPromise = (async () => {
        try {
          // Bypass the pending/timeout machinery on purpose: a slow or
          // failing warmup must never cancel a real render, it only leaves
          // the first render to pay the cold-worker cost as before.
          const prewarmed = ensureWorker()
          prewarmed.postMessage({ id: WARMUP_ID, input: { source: WARMUP_DECK } })
          prewarmed.postMessage({ id: WARMUP_ID, input: { kind: "markdown-block", source: "Elef" } })
        } catch (_error) {
          // Missing/broken workers resolve silently; the render path still
          // reports its own errors when a real preview is requested.
        }
      })()
    }
    return warmupPromise
  }

  return {
    warmup() {
      return warmup()
    },
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

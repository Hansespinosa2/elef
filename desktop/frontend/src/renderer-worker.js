import { renderPreview } from "./renderer.js"

self.addEventListener("message", (event) => {
  const { id, input } = event.data || {}
  try {
    self.postMessage({ id, result: renderPreview(input) })
  } catch (error) {
    self.postMessage({
      id,
      error: {
        code: typeof error?.code === "string" ? error.code : "render_error",
        message: typeof error?.message === "string" ? error.message : "Preview could not be rendered.",
        retryable: error?.retryable === true
      }
    })
  }
})

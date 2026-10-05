export function renderWorkerMessage(data, renderPreview) {
  const { id, input } = data || {}
  try {
    return { id, result: renderPreview(input) }
  } catch (error) {
    return {
      id,
      error: {
        code: typeof error?.code === "string" ? error.code : "render_error",
        message: typeof error?.message === "string" ? error.message : "Preview could not be rendered.",
        retryable: error?.retryable === true
      }
    }
  }
}

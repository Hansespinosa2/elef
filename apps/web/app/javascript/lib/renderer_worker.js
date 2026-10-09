export function renderWorkerMessage(data, renderPreview, renderMarkdownBlock = renderPreview) {
  const { id, input } = data || {}
  try {
    const result = input?.kind === "markdown-block"
      ? renderMarkdownBlock(input.source)
      : renderPreview(input)
    return { id, result }
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

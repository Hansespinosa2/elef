function renderWorkerMessage(data, renderPreview, renderMarkdownBlock = renderPreview) {
  const { id, input } = data || {};
  try {
    const result = input?.kind === "markdown-block" ? renderMarkdownBlock(input.source) : renderPreview(input);
    return { id, result };
  } catch (error) {
    const failure = error;
    return {
      id,
      error: {
        code: typeof failure?.code === "string" ? failure.code : "render_error",
        message: typeof failure?.message === "string" ? failure.message : "Preview could not be rendered.",
        retryable: failure?.retryable === true
      }
    };
  }
}
export {
  renderWorkerMessage
};

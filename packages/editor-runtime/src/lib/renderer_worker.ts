export interface WorkerRenderInput {
  kind?: string;
  source?: string;
  [key: string]: unknown;
}

export interface WorkerRenderMessage {
  id?: unknown;
  input?: WorkerRenderInput;
}

export function renderWorkerMessage(
  data: WorkerRenderMessage | null | undefined,
  renderPreview: (input: any) => unknown,
  renderMarkdownBlock: (source: any) => unknown = renderPreview
) {
  const { id, input } = data || {}
  try {
    const result = input?.kind === "markdown-block"
      ? renderMarkdownBlock(input.source)
      : renderPreview(input)
    return { id, result }
  } catch (error) {
    const failure = error as { code?: unknown; message?: unknown; retryable?: unknown } | null | undefined
    return {
      id,
      error: {
        code: typeof failure?.code === "string" ? failure.code : "render_error",
        message: typeof failure?.message === "string" ? failure.message : "Preview could not be rendered.",
        retryable: failure?.retryable === true
      }
    }
  }
}

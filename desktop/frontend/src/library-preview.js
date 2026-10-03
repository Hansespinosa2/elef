export function createLibraryPreviewLoader({ readPreview, render, install }) {
  return async function loadLibraryPreview(container, deck) {
    if (!container || !deck || container.dataset.previewState) return false
    container.dataset.previewState = "loading"
    try {
      const preview = await readPreview(deck.id)
      const rendered = await render({
        source: preview.source,
        kind: deck.kind,
        title: deck.name,
        deckId: deck.id,
        mediaBaseUrl: `elefasset://localhost/${encodeURIComponent(deck.id)}`,
        documentNodes: []
      })
      install(container, rendered.html, { interactive: false })
      // Reattach only the trusted sizing controller after sanitization. The
      // preview has no authoring controller, IPC action or editable content.
      container.classList.add("library-preview")
      container.dataset.controller = "presentation-canvas"
      const canvas = deck.kind === "document"
        ? container.querySelector(".document-reader") : container.querySelector(".slide")
      if (canvas) {
        canvas.dataset.presentationCanvasTarget = "canvas"
        if (deck.kind === "document") {
          canvas.classList.add("library-preview-page")
          canvas.classList.remove("document-editor-projection")
          container.dataset.presentationCanvasDesignWidthValue = "794"
          container.dataset.presentationCanvasDesignHeightValue = "1123"
        } else {
          const surface = container.querySelector(".presentation-surface")
          surface?.classList.remove("presentation-editor-projection")
          surface?.classList.add("library-preview-stage")
        }
      }
      container.setAttribute("inert", "")
      container.dataset.previewState = "ready"
      return true
    } catch (error) {
      container.replaceChildren()
      container.textContent = error?.code === "too_large"
        ? "Preview unavailable for large source files."
        : "Preview unavailable."
      container.dataset.previewState = "unavailable"
      return false
    }
  }
}

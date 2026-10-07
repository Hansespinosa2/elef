export function createLibraryPreviewLoader({ readPreview, render, install, mediaBaseUrlForDeck = () => "" }) {
  return async function loadLibraryPreview(container, deck) {
    if (!container || !deck || container.dataset.previewState) return false
    container.dataset.previewState = "loading"
    try {
      const preview = await readPreview(deck.id)
      const mediaBaseUrl = mediaBaseUrlForDeck(deck)
      const rendered = await render({
        source: preview.source,
        kind: deck.kind,
        title: deck.name,
        deckId: deck.id,
        mediaBaseUrl,
        documentNodes: []
      })
      install(container, rendered.html, { interactive: false, documentPagination: deck.kind === "document", mediaBaseUrl })
      container.classList.add("library-preview")
      if (deck.kind === "document") {
        container.querySelector(".document-reader")?.classList.remove("document-editor-projection")
      } else {
        container.dataset.controller = "presentation-canvas"
        const canvas = container.querySelector(".slide")
        if (canvas) canvas.dataset.presentationCanvasTarget = "canvas"
        const surface = container.querySelector(".presentation-surface")
        surface?.classList.remove("presentation-editor-projection")
        surface?.classList.add("library-preview-stage")
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

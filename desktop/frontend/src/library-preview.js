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

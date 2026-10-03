function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character])
}

// Preview and controls are trusted rendered slots supplied by the host. Never
// pass Markdown or user strings into these slots; all metadata is escaped here.
export function renderLibraryCard({ id, title, kind, metadata, editUrl, previewHtml = "", controlsHtml = "", note = "", desktop = false }) {
  if (!/^(?:\/(?!\/)|#)/.test(String(editUrl))) throw new TypeError("Library cards require a local navigation target")
  const native = desktop ? " deck-card" : ""
  const preview = desktop ? " deck-card-preview" : ""
  const open = desktop ? " deck-open" : ""
  const name = desktop ? " deck-name" : ""
  const meta = desktop ? " deck-meta" : ""
  return `<article id="${escape(id)}" class="library-card rounded-2xl border border-[#ddd5c8] bg-[#fffdf8]${native}" role="listitem">
    <div class="library-card-media">
      <div class="library-card-preview${preview}" aria-hidden="true" inert>${previewHtml}</div>
      <a class="library-card-open${open}" href="${escape(editUrl)}" aria-label="${desktop ? "Open" : "Edit"} ${escape(title)}"></a>
      <div class="library-card-controls">${controlsHtml}</div>
    </div>
    <div class="library-card-body">
      <p class="library-card-eyebrow eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em] text-[#6d4aff]">${kind === "document" ? "Document" : "Presentation"}</p>
      <h2 class="library-card-title mb-2 text-2xl font-bold"><a class="hover:underline${name}" href="${escape(editUrl)}">${escape(title)}</a></h2>
      <p class="library-card-meta text-[#6f675c]${meta}">${escape(metadata)}</p>
      ${note ? `<p class="library-card-note text-sm text-[#6f675c]">${escape(note)}</p>` : ""}
    </div>
  </article>`
}

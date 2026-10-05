function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character])
}

function formattedUpdateDate(updatedAt) {
  const timestamp = typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt || "")
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "date unavailable"
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(timestamp))
}

function libraryMetadata(kind, updatedAt) {
  const description = kind === "document" ? "Continuous Markdown" : "Markdown slides"
  return `${description} · Updated ${formattedUpdateDate(updatedAt)}`
}

// Preview and controls are trusted rendered slots supplied by the host. Never
// pass Markdown or user strings into these slots; all metadata is escaped here.
export function renderLibraryCard({ id, title, kind, updatedAt, editUrl, previewHtml = "", controlsHtml = "", note = "" }) {
  if (!/^(?:\/(?!\/)|#)/.test(String(editUrl))) throw new TypeError("Library cards require a local navigation target")
  return `<article id="${escape(id)}" class="library-card rounded-2xl border border-[#ddd5c8] bg-[#fffdf8]" role="listitem">
    <div class="library-card-media">
      <div class="library-card-preview" aria-hidden="true" inert>${previewHtml}</div>
      <a class="library-card-open" href="${escape(editUrl)}" aria-label="Edit ${escape(title)}"></a>
      <div class="library-card-controls">${controlsHtml}</div>
    </div>
    <div class="library-card-body">
      <p class="library-card-eyebrow eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em] text-[#6d4aff]">${kind === "document" ? "Document" : "Presentation"}</p>
      <h2 class="library-card-title mb-2 text-2xl font-bold"><a class="hover:underline" href="${escape(editUrl)}">${escape(title)}</a></h2>
      <p class="library-card-meta text-[#6f675c]">${escape(libraryMetadata(kind, updatedAt))}</p>
      ${note ? `<p class="library-card-note text-sm text-[#6f675c]">${escape(note)}</p>` : ""}
    </div>
  </article>`
}

export function createLibraryCard(document, deck, actions) {
  const template = document.createElement("template")
  template.innerHTML = renderLibraryCard({
    id: deck.id, title: deck.name, kind: deck.kind,
    updatedAt: deck.modified_ms,
    editUrl: "#" + encodeURIComponent(deck.id)
  })
  const card = template.content.firstElementChild
  const preview = card.querySelector(".library-card-preview")
  preview.dataset.deckId = deck.id
  preview.dataset.previewState = ""
  preview.textContent = "Loading preview…"
  for (const open of card.querySelectorAll(".library-card-open, .library-card-title a")) {
    open.addEventListener("click", event => {
      event.preventDefault()
      actions.open(deck.id)
    })
  }

  const menu = document.createElement("details")
  menu.className = "library-card-menu"
  const trigger = document.createElement("summary")
  trigger.className = "library-card-menu-trigger"
  trigger.setAttribute("aria-label", `More actions for ${deck.name}`)
  trigger.textContent = "..."
  menu.append(trigger)

  const options = document.createElement("div")
  options.className = "library-card-menu-options"
  const rename = document.createElement("details")
  rename.className = "library-card-submenu rename-menu"
  const label = document.createElement("summary")
  label.textContent = "Rename"
  rename.append(label)

  const form = document.createElement("form")
  form.className = "library-rename"
  const name = document.createElement("input")
  name.type = "text"
  name.value = deck.name
  name.setAttribute("aria-label", `Rename ${deck.name}`)
  name.required = true
  const save = document.createElement("button")
  save.className = "deck-action"
  save.type = "submit"
  save.textContent = "Save title"
  form.append(name, save)
  form.addEventListener("submit", event => {
    event.preventDefault()
    void actions.rename(deck, name.value)
  })
  rename.append(form)
  options.append(rename)

  const remove = document.createElement("button")
  remove.className = "deck-action danger is-danger"
  remove.type = "button"
  remove.textContent = "Delete"
  remove.addEventListener("click", () => actions.delete(deck))
  options.append(remove)
  menu.append(options)
  card.querySelector(".library-card-controls").append(menu)

  if (deck.warnings.length) {
    const warning = document.createElement("p")
    warning.className = "deck-warning"
    warning.textContent = deck.warnings.join(" ")
    warning.setAttribute("role", "note")
    card.append(warning)
  }
  return card
}

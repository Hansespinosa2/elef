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

const PREVIEW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M10.2 8.9 15.6 12l-5.4 3.1V8.9Z"/></svg>'
const FORM_METHODS = new Set(["post", "patch", "delete"])

function localUrl(value, label) {
  const url = String(value ?? "")
  if (!/^\/(?!\/)/.test(url)) throw new TypeError(`${label} must be a local URL`)
  return url
}

function formFields(method, fields, authenticityToken) {
  const hidden = []
  if (authenticityToken) hidden.push({ name: "authenticity_token", value: authenticityToken })
  if (method !== "post") hidden.push({ name: "_method", value: method })
  hidden.push(...fields)
  return hidden.map(({ name, value }) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join("")
}

function serverForm({ url, method = "post", fields = [], authenticityToken, label, buttonClass = "deck-action", confirm, turbo }) {
  const action = localUrl(url, "Library action")
  const requestMethod = String(method).toLowerCase()
  if (!FORM_METHODS.has(requestMethod)) throw new TypeError("Unsupported library form method")
  const confirmation = confirm ? ` data-turbo-confirm="${escape(confirm)}"` : ""
  const turboSetting = turbo === false ? ' data-turbo="false"' : ""
  return `<form class="button_to" action="${escape(action)}" method="post"${confirmation}${turboSetting}>${formFields(requestMethod, fields, authenticityToken)}<button class="${escape(buttonClass)}" type="submit">${escape(label)}</button></form>`
}

function renderMenuAction(name, label, options = {}, authenticityToken, buttonClass = "deck-action") {
  if (options.url) {
    return serverForm({ ...options, authenticityToken, label, buttonClass })
  }
  return `<button class="${escape(buttonClass)}" type="button" data-library-card-action="${escape(name)}">${escape(label)}</button>`
}

function renderRename(title, options = {}, authenticityToken) {
  const inputAttributes = [
    'type="text"',
    options.name ? `name="${escape(options.name)}"` : "",
    options.id ? `id="${escape(options.id)}"` : "",
    `value="${escape(title)}"`,
    `aria-label="Rename ${escape(title)}"`,
    "required"
  ].filter(Boolean).join(" ")
  const input = `<input ${inputAttributes}>`
  const submit = '<button class="deck-action" type="submit">Save title</button>'
  if (options.url) {
    const action = localUrl(options.url, "Rename action")
    const requestMethod = String(options.method || "post").toLowerCase()
    if (!FORM_METHODS.has(requestMethod)) throw new TypeError("Unsupported rename method")
    return `<form class="library-rename" action="${escape(action)}" method="post">${formFields(requestMethod, options.fields || [], authenticityToken)}${input}${submit}</form>`
  }
  return `<form class="library-rename" data-library-card-action="rename">${input}${submit}</form>`
}

// Hosts supply persistence details; the markup, labels, and control structure
// stay shared. Desktop omits URLs and binds these controls to native actions.
export function renderLibraryCardControls({ title, kind, previewUrl, rename, fork, present, remove, authenticityToken }) {
  const previewLabel = `Preview ${String(title ?? "")}`
  const previewAttributes = `class="library-card-preview-button" aria-label="${escape(previewLabel)}" title="${escape(previewLabel)}"`
  const preview = previewUrl
    ? `<a ${previewAttributes} href="${escape(localUrl(previewUrl, "Preview target"))}">${PREVIEW_ICON}<span class="sr-only">Preview</span></a>`
    : `<button ${previewAttributes} type="button" data-library-card-action="preview">${PREVIEW_ICON}<span class="sr-only">Preview</span></button>`

  const renameControl = `<details class="library-card-submenu rename-menu"><summary>Rename</summary>${renderRename(title, rename, authenticityToken)}</details>`
  const forkChoices = Array.isArray(fork?.choices) ? fork.choices : []
  const forkControl = forkChoices.length
    ? `<details class="library-card-submenu fork-menu"><summary>Fork</summary><div class="fork-menu-options">${forkChoices.map(choice => renderMenuAction("fork", choice.label, choice, authenticityToken)).join("")}</div></details>`
    : ""
  const presentControl = kind === "presentation"
    ? renderMenuAction("present", "Present", present, authenticityToken)
    : ""
  const deleteControl = renderMenuAction("delete", "Delete", remove, authenticityToken, "deck-action danger is-danger")

  return `${preview}
    <details class="library-card-menu">
      <summary class="library-card-menu-trigger" aria-label="More actions for ${escape(title)}"><span aria-hidden="true">...</span></summary>
      <div class="library-card-menu-options">${renameControl}${forkControl}${presentControl}${deleteControl}</div>
    </details>`
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
    editUrl: "#" + encodeURIComponent(deck.id),
    controlsHtml: renderLibraryCardControls({ title: deck.name, kind: deck.kind })
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

  const controls = card.querySelector(".library-card-controls")
  controls.querySelector("[data-library-card-action='rename']")?.addEventListener("submit", event => {
    event.preventDefault()
    const name = event.currentTarget.querySelector('input[type="text"]').value
    void actions.rename(deck, name)
  })
  for (const button of controls.querySelectorAll("button[data-library-card-action]")) {
    const name = button.dataset.libraryCardAction
    button.addEventListener("click", () => actions[name]?.(deck))
  }

  if (deck.warnings.length) {
    const warning = document.createElement("p")
    warning.className = "deck-warning"
    warning.textContent = deck.warnings.join(" ")
    warning.setAttribute("role", "note")
    card.append(warning)
  }
  return card
}

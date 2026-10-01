function addText(document, parent, tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = text
  parent.append(element)
  return element
}

export function createDeckCard(document, deck, actions) {
  const card = document.createElement("article")
  card.className = "deck-card"
  card.setAttribute("role", "listitem")

  const preview = document.createElement("div")
  preview.className = "deck-card-preview"
  preview.dataset.deckId = deck.id
  preview.dataset.previewState = ""
  preview.setAttribute("aria-hidden", "true")
  preview.setAttribute("inert", "")
  preview.textContent = "Loading preview…"
  card.append(preview)

  const open = document.createElement("button")
  open.className = "deck-open"
  open.type = "button"
  open.setAttribute("aria-label", `Open ${deck.name}`)
  const glyph = addText(document, open, "span", "deck-glyph", deck.kind === "document" ? "▤" : "▱")
  glyph.setAttribute("aria-hidden", "true")
  const info = document.createElement("span")
  info.className = "deck-info"
  addText(document, info, "strong", "deck-name", deck.name)
  addText(document, info, "span", "deck-meta", `${deck.kind === "document" ? "Document" : "Presentation"} · ${deck.source_file}`)
  open.append(info)
  const arrow = addText(document, open, "span", "deck-arrow", "↗")
  arrow.setAttribute("aria-hidden", "true")
  open.addEventListener("click", () => actions.open(deck.id))
  card.append(open)

  const buttons = document.createElement("div")
  buttons.className = "deck-actions"
  const rename = addText(document, buttons, "button", "deck-action", "Rename")
  rename.type = "button"
  rename.addEventListener("click", () => actions.rename(deck))
  const remove = addText(document, buttons, "button", "deck-action danger", "Delete")
  remove.type = "button"
  remove.addEventListener("click", () => actions.delete(deck))
  card.append(buttons)

  if (deck.warnings.length) {
    const warning = addText(document, card, "p", "deck-warning", deck.warnings.join(" "))
    warning.setAttribute("role", "note")
  }
  return card
}

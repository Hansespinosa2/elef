import { renderLibraryCard } from "../../../app/javascript/lib/library_card.js"

export function createDeckCard(document, deck, actions) {
  const template = document.createElement("template")
  template.innerHTML = renderLibraryCard({
    id: deck.id, title: deck.name, kind: deck.kind,
    updatedAt: deck.modified_ms,
    editUrl: "#" + encodeURIComponent(deck.id), desktop: true
  })
  const card = template.content.firstElementChild
  const preview = card.querySelector(".deck-card-preview")
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

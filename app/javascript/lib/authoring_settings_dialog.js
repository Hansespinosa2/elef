import { buildAuthoringEntry, removeAuthoringEntry, upsertAuthoringEntry } from "./authoring_settings.js"
import { writeAuthoringRegistry } from "./authoring_registry_write.js"

export function createAuthoringSettingsDialog({
  elements,
  readRegistries,
  writeRegistry,
  reloadEditorRegistry,
  onSaved = () => {}
}) {
  let registries = { snippets: [], math_shortcuts: [] }
  let hashes = { snippets: null, math_shortcuts: null }
  let activeRegistry = "snippets"
  let pendingDeletion = null

  function entryLabel(entry, registry) {
    if (registry === "math_shortcuts") return `${entry.prefix || "@"}${(entry.aliases || []).join(", ")}`
    return `${entry.category === "Elef DSL" ? ":" : "/"}${entry.trigger || ""}`
  }

  function renderEntries() {
    const entries = registries[activeRegistry] || []
    const document = elements.list.ownerDocument
    elements.list.replaceChildren()
    elements.count.textContent = `${entries.length} personal ${activeRegistry === "snippets" ? "snippet" : "shortcut"}${entries.length === 1 ? "" : "s"}`
    elements.empty.hidden = entries.length > 0

    for (const entry of entries) {
      const card = document.createElement("article")
      card.className = "authoring-entry-card"
      const heading = document.createElement("div")
      heading.className = "authoring-entry-card-heading"
      const title = document.createElement("div")
      const trigger = document.createElement("code")
      trigger.textContent = entryLabel(entry, activeRegistry)
      const name = document.createElement("h3")
      name.textContent = String(entry.name || "Untitled")
      title.append(trigger, name)
      const actions = document.createElement("div")
      actions.className = "authoring-entry-actions"
      const edit = document.createElement("button")
      edit.className = "quiet-button"
      edit.type = "button"
      edit.textContent = "Edit"
      edit.addEventListener("click", () => beginEntryForm(entry))
      const remove = document.createElement("button")
      remove.className = "quiet-button authoring-delete"
      remove.type = "button"
      remove.textContent = "Delete"
      remove.addEventListener("click", () => requestDeletion(entry, activeRegistry))
      actions.append(edit, remove)
      heading.append(title, actions)
      const description = document.createElement("p")
      description.textContent = String(entry.description || "")
      const body = document.createElement("pre")
      body.textContent = String(activeRegistry === "snippets" ? entry.body || "" : entry.expansion || "")
      card.append(heading, description, body)
      elements.list.append(card)
    }
  }

  function closeEntryForm() {
    elements.form.reset?.()
    elements.form.hidden = true
    const label = activeRegistry === "snippets" ? "snippet" : "shortcut"
    elements.formHeading.textContent = `New ${label}`
    elements.saveButton.textContent = `Save ${label}`
  }

  function setRegistry(registry) {
    activeRegistry = registry === "math_shortcuts" ? "math_shortcuts" : "snippets"
    const isSnippet = activeRegistry === "snippets"
    elements.title.textContent = isSnippet ? "Snippets" : "Math shortcuts"
    elements.newButton.textContent = isSnippet ? "New snippet" : "New shortcut"
    elements.formHeading.textContent = isSnippet ? "New snippet" : "New shortcut"
    elements.saveButton.textContent = isSnippet ? "Save snippet" : "Save shortcut"
    elements.snippetFields.hidden = !isSnippet
    elements.snippetFields.disabled = !isSnippet
    elements.mathFields.hidden = isSnippet
    elements.mathFields.disabled = isSnippet
    for (const tab of elements.tabs) {
      const selected = tab.dataset.authoringTab === activeRegistry
      tab.classList.toggle("is-active", selected)
      tab.setAttribute("aria-pressed", String(selected))
    }
    elements.status.textContent = ""
    closeEntryForm()
    renderEntries()
  }

  async function open() {
    try {
      const result = await readRegistries()
      registries = {
        snippets: result.snippets || [],
        math_shortcuts: result.math_shortcuts || []
      }
      hashes = result.hashes || { snippets: null, math_shortcuts: null }
      setRegistry(activeRegistry)
    } catch (_error) {
      registries = { snippets: [], math_shortcuts: [] }
      hashes = { snippets: null, math_shortcuts: null }
      setRegistry(activeRegistry)
      elements.status.textContent = "Could not read authoring settings. Check that the library folder is available."
    }
    elements.dialog.showModal?.()
  }

  function beginEntryForm(entry = null) {
    closeEntryForm()
    elements.form.hidden = false
    elements.form.querySelector('[name="id"]').value = entry ? String(entry.id) : ""
    const isSnippet = activeRegistry === "snippets"
    const fields = isSnippet ? elements.snippetFields : elements.mathFields
    fields.querySelector(`[name="${isSnippet ? "name" : "math-name"}"]`).value = String(entry?.name || "")
    fields.querySelector(`[name="${isSnippet ? "description" : "math-description"}"]`).value = String(entry?.description || "")
    if (isSnippet) {
      fields.querySelector('[name="trigger"]').value = String(entry?.trigger || "")
      fields.querySelector('[name="category"]').value = String(entry?.category || "Markdown")
      fields.querySelector('[name="body"]').value = String(entry?.body || "")
    } else {
      fields.querySelector('[name="prefix"]').value = String(entry?.prefix || ".")
      fields.querySelector('[name="aliases"]').value = (entry?.aliases || []).join(", ")
      fields.querySelector('[name="expansion"]').value = String(entry?.expansion || "")
    }
    elements.formHeading.textContent = entry
      ? `Edit ${isSnippet ? "snippet" : "shortcut"}`
      : `New ${isSnippet ? "snippet" : "shortcut"}`
    elements.saveButton.textContent = `Save ${isSnippet ? "snippet" : "shortcut"}`
    fields.querySelector("input:not([type=hidden])")?.focus()
  }

  async function persist(entries, action, registry) {
    await writeAuthoringRegistry({
      registry,
      entries,
      baseHash: hashes[registry],
      writeRegistry,
      updateLocal: ({ registry: savedRegistry, entries: savedEntries, contentHash }) => {
        registries[savedRegistry] = savedEntries
        hashes[savedRegistry] = contentHash
      },
      reloadEditorRegistry,
      isSelected: savedRegistry => activeRegistry === savedRegistry,
      onSuccess: ({ registry: savedRegistry, isSelected }) => {
        const label = savedRegistry === "snippets" ? "snippet" : "math shortcut"
        elements.status.textContent = `${action} saved to this library (${label}).`
        onSaved(`${action} saved`)
        if (isSelected) {
          closeEntryForm()
          renderEntries()
        }
      },
      onFailure: (error, { registry: failedRegistry }) => {
        const label = failedRegistry === "snippets" ? "Snippet" : "Math shortcut"
        if (error?.code === "conflict") {
          elements.status.textContent = `${label} settings changed outside Elef. Close and reopen settings to load the latest entries before saving.`
        } else if (error?.code === "invalid_input") {
          elements.status.textContent = "These settings are invalid. Check the name, trigger, category, aliases, and template."
        } else {
          elements.status.textContent = "Could not save authoring settings. Check that the library folder is writable."
        }
      }
    })
  }

  async function saveEntry(event) {
    event.preventDefault()
    const isSnippet = activeRegistry === "snippets"
    const fields = isSnippet ? elements.snippetFields : elements.mathFields
    const values = isSnippet
      ? {
          name: fields.querySelector('[name="name"]').value,
          description: fields.querySelector('[name="description"]').value,
          trigger: fields.querySelector('[name="trigger"]').value,
          category: fields.querySelector('[name="category"]').value,
          body: fields.querySelector('[name="body"]').value
        }
      : {
          name: fields.querySelector('[name="math-name"]').value,
          description: fields.querySelector('[name="math-description"]').value,
          prefix: fields.querySelector('[name="prefix"]').value,
          aliases: fields.querySelector('[name="aliases"]').value,
          expansion: fields.querySelector('[name="expansion"]').value
        }
    const existingId = elements.form.querySelector('[name="id"]').value
    const id = existingId || `personal-${crypto.randomUUID()}`
    try {
      const entry = buildAuthoringEntry(activeRegistry, values, id)
      const entries = upsertAuthoringEntry(registries[activeRegistry], entry)
      await persist(entries, existingId ? "Changes" : "New entry", activeRegistry)
    } catch (error) {
      elements.status.textContent = error.message
    }
  }

  function requestDeletion(entry, registry) {
    pendingDeletion = { entry, registry }
    elements.deleteMessage.textContent = `Delete “${String(entry.name || "this entry")}” from this library?`
    elements.deleteDialog.showModal?.()
  }

  async function confirmDeletion() {
    const pending = pendingDeletion
    if (!pending) return
    pendingDeletion = null
    elements.deleteDialog.close?.()
    await persist(removeAuthoringEntry(registries[pending.registry], pending.entry.id), "Entry deletion", pending.registry)
  }

  function cancelDeletion() {
    pendingDeletion = null
    elements.deleteDialog.close?.()
  }

  function connect() {
    for (const tab of elements.tabs) tab.addEventListener("click", () => setRegistry(tab.dataset.authoringTab))
    elements.newButton.addEventListener("click", () => beginEntryForm())
    elements.form.addEventListener("submit", event => void saveEntry(event))
    elements.cancelEntryButton.addEventListener("click", closeEntryForm)
    elements.closeButton.addEventListener("click", () => elements.dialog.close?.())
    elements.deleteDialog.addEventListener("close", () => { pendingDeletion = null })
    elements.confirmDelete.addEventListener("click", () => void confirmDeletion())
    elements.cancelDelete.addEventListener("click", cancelDeletion)
  }

  connect()
  return { open }
}

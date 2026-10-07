import { buildAuthoringEntry, removeAuthoringEntry, upsertAuthoringEntry } from "./authoring_settings.js"
import { writeAuthoringRegistry } from "./authoring_registry_write.js"
import { installSanitizedPreview } from "#elef/preview-sanitizer"

const CATEGORY_ORDER = new Map([["Markdown", 0], ["LaTeX", 1], ["Mermaid", 2], ["Elef DSL", 3]])

function compareText(left, right) {
  const a = String(left || "").toLowerCase()
  const b = String(right || "").toLowerCase()
  return a < b ? -1 : a > b ? 1 : 0
}

function sortedEntries(entries, registry) {
  return [...entries].sort((left, right) => {
    if (registry === "snippets") {
      const category = (CATEGORY_ORDER.get(left.category) ?? 4) - (CATEGORY_ORDER.get(right.category) ?? 4)
      if (category) return category
    }
    return compareText(left.name, right.name) || compareText(left.id, right.id)
  })
}

function snippetExample(body) {
  return String(body || "").replace(/\$\{\d+(?::([^}]*))?\}/g, (_match, label) => label || "example")
}

function mathExample(expansion) {
  return String(expansion || "").replace(/\$\{\d+(?::[^}]*)?\}/g, "x")
}

function makeElement(document, name, { className, text, type } = {}) {
  const element = document.createElement(name)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  if (type) element.type = type
  return element
}

function appendMathStep(document, parent, label, value) {
  const step = makeElement(document, "div", { className: "math-shortcut-step" })
  step.append(makeElement(document, "span", { text: label }), makeElement(document, "code", { text: value }))
  parent.append(step)
}

export function authoringSettingsElements(root = document) {
  const query = selector => root.querySelector(selector)
  return {
    dialog: query("#authoring-settings-dialog"),
    title: query("#authoring-settings-title"),
    tabs: root.querySelectorAll("[data-authoring-tab]"),
    status: query("#authoring-settings-status"),
    count: query("#authoring-settings-count"),
    list: query("#authoring-settings-list"),
    empty: query("#authoring-settings-empty"),
    search: query("#authoring-settings-search"),
    categoryField: query("#authoring-settings-category-field"),
    category: query("#authoring-settings-category"),
    newButton: query("#new-authoring-entry"),
    form: query("#authoring-entry-form"),
    formHeading: query("#authoring-entry-heading"),
    snippetFields: query(".authoring-snippet-fields"),
    mathFields: query(".authoring-math-fields"),
    saveButton: query("#save-authoring-entry"),
    deleteDialog: query("#delete-authoring-dialog"),
    deleteMessage: query("#delete-authoring-message"),
    confirmDelete: query("#confirm-authoring-delete"),
    cancelDelete: query("#cancel-authoring-delete"),
    cancelEntryButton: query("#cancel-authoring-entry"),
    closeButton: query("#close-authoring-settings")
  }
}

export function createAuthoringSettingsDialog({
  elements,
  readRegistries,
  writeRegistry,
  reloadEditorRegistry,
  renderMarkdownBlock = source => globalThis.ElefRenderer?.renderMarkdownBlock(source),
  onSaved = () => {},
  onClose = () => {}
}) {
  let registries = { snippets: [], math_shortcuts: [] }
  let hashes = { snippets: null, math_shortcuts: null }
  let activeRegistry = "snippets"
  let pendingDeletion = null
  let writeInProgress = false

  function entryLabel(entry, registry) {
    if (registry === "math_shortcuts") return `${entry.prefix || "@"}${(entry.aliases || []).join(", ")}`
    return `${entry.category === "Elef DSL" ? ":" : "/"}${entry.trigger || ""}`
  }

  function renderExample(container, source) {
    if (!renderMarkdownBlock) {
      container.textContent = source
      return
    }
    Promise.resolve(renderMarkdownBlock(source)).then(html => {
      if (!container.isConnected) return
      installSanitizedPreview(container, html, { interactive: false })
    }).catch(() => {
      if (container.isConnected) container.textContent = source
    })
  }

  function renderSnippetCard(entry, document) {
    const card = makeElement(document, "article", { className: "snippet-card library-card authoring-entry-card rounded-2xl border p-5" })
    const heading = makeElement(document, "div", { className: "flex items-start justify-between gap-4 authoring-entry-card-heading" })
    const title = makeElement(document, "div", { className: "min-w-0" })
    const category = makeElement(document, "p", { className: "snippet-category-badge", text: entry.category === "Elef DSL" ? "Elef directives" : entry.category })
    const name = makeElement(document, "h3", { className: "mt-1 text-2xl font-bold", text: entry.name || "Untitled" })
    const details = makeElement(document, "p", { className: "mt-1", text: `${entryLabel(entry, activeRegistry)} · ${entry.description || ""}` })
    const badge = makeElement(document, "span", { className: "snippet-origin-badge authoring-entry-badge", text: entry.built_in ? "Built-in" : "Personal" })
    title.append(category, name, details)
    heading.append(title, badge)
    const example = makeElement(document, "div", { className: "snippet-example mt-4" })
    example.append(makeElement(document, "p", { className: "snippet-example-label", text: "Template" }))
    const template = makeElement(document, "pre", { className: "snippet-template overflow-auto rounded-xl p-3 text-sm" })
    template.append(makeElement(document, "code", { text: entry.body || "" }))
    example.append(template, makeElement(document, "p", { className: "snippet-example-label mt-3", text: "Example" }))
    const preview = makeElement(document, "div", { className: "snippet-example-preview rounded-xl p-4" })
    example.append(preview)
    card.append(heading, example)
    if (!entry.built_in) card.append(renderActions(entry, document))
    renderExample(preview, snippetExample(entry.body))
    return card
  }

  function renderMathCard(entry, document) {
    const card = makeElement(document, "article", { className: "math-shortcut-card settings-card authoring-entry-card rounded-2xl border p-4" })
    const heading = makeElement(document, "div", { className: "math-shortcut-heading flex items-start justify-between gap-3 authoring-entry-card-heading" })
    const title = makeElement(document, "div", { className: "min-w-0" })
    title.append(
      makeElement(document, "p", { className: "math-shortcut-alias", text: entryLabel(entry, activeRegistry) }),
      makeElement(document, "h3", { className: "mt-1 text-xl font-bold", text: entry.name || "Untitled" }),
      makeElement(document, "p", { className: "mt-1 text-sm", text: entry.description || "" })
    )
    heading.append(title, makeElement(document, "span", { className: "snippet-origin-badge authoring-entry-badge", text: entry.built_in ? "Built-in" : "Personal" }))
    const example = makeElement(document, "div", { className: "math-shortcut-card-example mt-4" })
    example.append(makeElement(document, "p", { className: "snippet-example-label mb-2", text: "Example" }))
    const flow = makeElement(document, "div", { className: "math-shortcut-flow" })
    const alias = entry.aliases?.[0] || ""
    appendMathStep(document, flow, "Type", entry.prefix === "." ? `x.${alias}` : `@${alias}`)
    flow.append(makeElement(document, "span", { className: "math-shortcut-arrow", text: "→" }))
    appendMathStep(document, flow, "LaTeX", mathExample(entry.expansion))
    flow.append(makeElement(document, "span", { className: "math-shortcut-arrow", text: "→" }))
    const result = makeElement(document, "div", { className: "math-shortcut-step math-shortcut-result" })
    result.append(makeElement(document, "span", { text: "Result" }))
    const preview = makeElement(document, "div")
    result.append(preview)
    flow.append(result)
    example.append(flow)
    card.append(heading, example)
    if (!entry.built_in) card.append(renderActions(entry, document))
    renderExample(preview, `$${mathExample(entry.expansion)}$`)
    return card
  }

  function renderActions(entry, document) {
    const actions = makeElement(document, "div", { className: "authoring-entry-actions" })
    const edit = makeElement(document, "button", { className: "button", text: "Edit", type: "button" })
    edit.addEventListener("click", () => beginEntryForm(entry))
    const remove = makeElement(document, "button", { className: "button authoring-delete", text: "Delete", type: "button" })
    remove.addEventListener("click", () => requestDeletion(entry, activeRegistry))
    actions.append(edit, remove)
    return actions
  }

  function renderEntries() {
    const allEntries = registries[activeRegistry] || []
    const query = String(elements.search.value || "").trim().toLowerCase()
    const category = activeRegistry === "snippets" ? elements.category.value : ""
    const entries = sortedEntries(allEntries, activeRegistry).filter(entry => {
      if (category && entry.category !== category) return false
      const searchable = [entry.name, entry.trigger, entry.category, entry.description, entry.body, entry.expansion, ...(entry.aliases || [])]
        .join(" ").toLowerCase()
      return !query || searchable.includes(query)
    })
    const document = elements.list.ownerDocument
    elements.list.replaceChildren()
    const label = activeRegistry === "snippets" ? "snippet" : "math shortcut"
    const personalCount = allEntries.filter(entry => !entry.built_in).length
    elements.count.textContent = `${allEntries.length} ${label}${allEntries.length === 1 ? "" : "s"} · ${personalCount} personal`
    elements.empty.hidden = entries.length > 0
    elements.empty.textContent = query || category ? "No entries match this search." : "No entries are available."
    for (const entry of entries) {
      elements.list.append(activeRegistry === "snippets"
        ? renderSnippetCard(entry, document)
        : renderMathCard(entry, document))
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
    elements.categoryField.hidden = !isSnippet
    for (const tab of elements.tabs) {
      const selected = tab.dataset.authoringTab === activeRegistry
      tab.classList.toggle("is-active", selected)
      tab.setAttribute("aria-selected", String(selected))
      tab.setAttribute("tabindex", selected ? "0" : "-1")
    }
    elements.status.textContent = ""
    closeEntryForm()
    renderEntries()
  }

  async function open({ registry = activeRegistry, openNew = false, entryId = null } = {}) {
    let loadFailed = false
    try {
      const result = await readRegistries()
      registries = {
        snippets: result.snippets || [],
        math_shortcuts: result.math_shortcuts || []
      }
      hashes = result.hashes || { snippets: null, math_shortcuts: null }
    } catch (_error) {
      registries = { snippets: [], math_shortcuts: [] }
      hashes = { snippets: null, math_shortcuts: null }
      loadFailed = true
    }
    setRegistry(registry)
    if (loadFailed) elements.status.textContent = "Could not load authoring settings. Check that your work is available."
    elements.dialog.showModal?.()
    if (entryId) {
      const entry = (registries[activeRegistry] || []).find(candidate => String(candidate.id) === String(entryId))
      if (entry && !entry.built_in) beginEntryForm(entry)
    } else if (openNew) {
      beginEntryForm()
    }
    if (!entryId && !openNew) elements.search.focus?.()
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
    fields.querySelector("input:not([type=hidden])")?.focus?.()
  }

  async function persist(entries, action, registry) {
    if (writeInProgress) return false
    writeInProgress = true
    const personalEntries = entries.filter(entry => !entry.built_in)
    elements.saveButton.disabled = true
    try {
      return await writeAuthoringRegistry({
        registry,
        entries: personalEntries,
        baseHash: hashes[registry],
        writeRegistry,
        updateLocal: ({ registry: savedRegistry, entries: savedEntries, contentHash }) => {
          const builtIns = registries[savedRegistry].filter(entry => entry.built_in)
          registries[savedRegistry] = [...builtIns, ...savedEntries.filter(entry => !entry.built_in)]
          hashes[savedRegistry] = contentHash ?? null
        },
        reloadEditorRegistry,
        isSelected: savedRegistry => activeRegistry === savedRegistry,
        onSuccess: ({ registry: savedRegistry, isSelected }) => {
          const label = savedRegistry === "snippets" ? "snippet" : "math shortcut"
          elements.status.textContent = `${action} saved (${label}).`
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
            elements.status.textContent = "Could not save authoring settings. Check that the settings store is writable."
          }
        }
      })
    } finally {
      writeInProgress = false
      elements.saveButton.disabled = false
      elements.snippetFields.disabled = activeRegistry !== "snippets"
      elements.mathFields.disabled = activeRegistry !== "math_shortcuts"
    }
  }

  async function saveEntry(event) {
    event.preventDefault()
    if (writeInProgress) return
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
      fields.disabled = true
      await persist(entries, existingId ? "Changes" : "New entry", activeRegistry)
    } catch (error) {
      elements.status.textContent = error.message
    } finally {
      elements.snippetFields.disabled = activeRegistry !== "snippets"
      elements.mathFields.disabled = activeRegistry !== "math_shortcuts"
    }
  }

  function requestDeletion(entry, registry) {
    if (entry.built_in) return
    pendingDeletion = { entry, registry }
    elements.deleteMessage.textContent = `Delete “${String(entry.name || "this entry")}” from your authoring settings?`
    elements.deleteDialog.showModal?.()
  }

  async function confirmDeletion() {
    if (writeInProgress) return
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
    elements.search.addEventListener("input", renderEntries)
    elements.category.addEventListener("change", renderEntries)
    elements.form.addEventListener("submit", event => void saveEntry(event))
    elements.cancelEntryButton.addEventListener("click", closeEntryForm)
    elements.closeButton.addEventListener("click", () => elements.dialog.close?.())
    elements.dialog.addEventListener("close", onClose)
    elements.deleteDialog.addEventListener("close", () => { pendingDeletion = null })
    elements.confirmDelete.addEventListener("click", () => void confirmDeletion())
    elements.cancelDelete.addEventListener("click", cancelDeletion)
  }

  connect()
  return { open, close: () => elements.dialog.close?.() }
}

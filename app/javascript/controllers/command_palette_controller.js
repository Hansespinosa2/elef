import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["dialog", "heading", "input", "filters", "results", "status", "hint", "closeButton"]
  static values = { searchUrl: String, settingsUrl: String, commands: Array, theme: String, typography: String }

  connect() {
    this.mode = "commands"
    this.searchType = "all"
    this.appearanceCategory = null
    this.savingAppearance = false
    this.selectedIndex = 0
    this.resultsData = []
    this.visibleCommands = []
    this.searchSequence = 0
    const platform = navigator.userAgentData?.platform || navigator.platform || ""
    this.shortcutModifier = /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl+"
    this.handleGlobalKeydown = (event) => this.globalKeydown(event)
    window.addEventListener("keydown", this.handleGlobalKeydown)
    this.updateShortcutLabels()
    this.renderCommands()
  }

  disconnect() {
    window.removeEventListener("keydown", this.handleGlobalKeydown)
    this.cancelSearch()
  }

  globalKeydown(event) {
    if (event.altKey || event.isComposing) return

    const hasModifier = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (hasModifier && !event.shiftKey && key === "k") {
      event.preventDefault()
      this.openCommands()
    } else if (hasModifier && !event.shiftKey && key === "p") {
      event.preventDefault()
      this.openSearch()
    } else if (event.key === "Escape" && this.isOpen()) {
      event.preventDefault()
      if (this.mode === "appearance-values" || this.mode === "appearance-categories") this.goBackAppearance()
      else this.close()
    }
  }

  open() {
    this.openCommands()
  }

  openCommands() {
    this.openMode("commands")
  }

  openSearch() {
    this.openMode("search")
  }

  openMode(mode) {
    this.cancelSearch()
    this.searchType = "all"
    this.appearanceCategory = null
    this.selectedIndex = 0
    this.resultsData = []
    this.setModeChrome(mode)
    this.updateFilterSelection()

    if (!this.isOpen()) {
      if (typeof this.dialogTarget.showModal === "function") this.dialogTarget.showModal()
      else this.dialogTarget.setAttribute("open", "")
    }

    this.inputTarget.value = ""
    this.renderCurrentMode()
    this.setStatus(mode === "commands"
      ? `Choose an Elef action or press ${this.shortcutLabel("p")} to search your work.`
      : "Search all presentations and documents. Put words in quotes to find an exact phrase.")
    this.inputTarget.focus()
  }

  close() {
    this.cancelSearch()
    this.inputTarget.setAttribute("aria-expanded", "false")
    if (typeof this.dialogTarget.close === "function" && this.dialogTarget.open) this.dialogTarget.close()
    else this.dialogTarget.removeAttribute("open")
  }

  dialogClick(event) {
    if (event.target === this.dialogTarget) this.close()
  }

  dialogClosed() {
    this.cancelSearch()
    this.inputTarget.setAttribute("aria-expanded", "false")
  }

  closeButtonClick() {
    if (this.mode === "appearance-values" || this.mode === "appearance-categories") this.goBackAppearance()
    else this.close()
  }

  setSearchType(event) {
    this.searchType = event.currentTarget.dataset.type || "all"
    this.updateFilterSelection()
    this.inputChanged()
  }

  inputChanged() {
    this.cancelSearch()
    const query = this.inputTarget.value.trim()
    if (this.mode === "commands") {
      this.selectedIndex = 0
      this.renderCommands(query)
      const count = this.visibleCommands.length
      this.setStatus(`${count} command${count === 1 ? "" : "s"}`)
      return
    }

    if (this.mode === "appearance-categories" || this.mode === "appearance-values") {
      this.selectedIndex = 0
      this.renderAppearanceOptions(query)
      const count = this.visibleCommands.length
      this.setStatus(`${count} choice${count === 1 ? "" : "s"}`)
      return
    }

    if (!query) {
      this.resultsData = []
      this.selectedIndex = 0
      this.renderResults()
      this.setStatus("Search all presentations and documents. Put words in quotes to find an exact phrase.")
      return
    }

    this.resultsData = []
    this.selectedIndex = 0
    this.resultsTarget.replaceChildren()
    this.inputTarget.removeAttribute("aria-activedescendant")
    this.setStatus("Searching…")
    const sequence = this.searchSequence
    this.searchTimer = setTimeout(() => this.search(query, sequence), 140)
  }

  async search(query, sequence) {
    const controller = new AbortController()
    this.searchController = controller
    try {
      const url = new URL(this.searchUrlValue, window.location.origin)
      url.searchParams.set("q", query)
      if (this.searchType !== "all") url.searchParams.set("type", this.searchType)
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: controller.signal
      })
      if (!response.ok) throw new Error("Search request failed")

      const payload = await response.json()
      if (sequence !== this.searchSequence || this.mode !== "search" || !this.isOpen()) return

      this.resultsData = payload.results || []
      this.selectedIndex = 0
      this.renderResults()
      this.setStatus(this.resultsData.length
        ? `${this.resultsData.length} result${this.resultsData.length === 1 ? "" : "s"}`
        : "No matches. Try a title, alias, heading, or phrase from the text.")
    } catch (error) {
      if (error.name === "AbortError" || sequence !== this.searchSequence) return
      this.resultsData = []
      this.renderResults()
      this.setStatus("Search is unavailable right now.")
    }
  }

  keydown(event) {
    const count = this.mode === "search" ? this.resultsData.length : this.visibleCommands.length
    if (event.key === "Backspace" && this.mode === "appearance-values" && !this.inputTarget.value) {
      event.preventDefault()
      this.goBackAppearance()
      return
    }
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault()
      this.selectedIndex = (this.selectedIndex + 1) % count
      this.updateSelection()
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault()
      this.selectedIndex = (this.selectedIndex - 1 + count) % count
      this.updateSelection()
    } else if (event.key === "Home" && count > 0) {
      event.preventDefault()
      this.selectedIndex = 0
      this.updateSelection()
    } else if (event.key === "End" && count > 0) {
      event.preventDefault()
      this.selectedIndex = count - 1
      this.updateSelection()
    } else if (event.key === "Enter" && count > 0) {
      event.preventDefault()
      this.activateSelected()
    }
  }

  activateSelected() {
    if (this.mode === "search") {
      const result = this.resultsData[this.selectedIndex]
      if (result?.url) window.location.assign(result.url)
      return
    }

    const command = this.visibleCommands[this.selectedIndex]
    if (!command) return
    if (this.mode === "appearance-categories") {
      this.openAppearanceValues(command.id)
      return
    }
    if (this.mode === "appearance-values") {
      this.saveAppearance(command.id)
      return
    }
    if (command.url) {
      window.location.assign(command.url)
      return
    }
    this.runCommand(command.id)
  }

  runCommand(id) {
    if (id === "quick-open") {
      this.openSearch()
    } else if (id === "change-appearance") {
      this.openAppearanceCategories()
    } else if (id === "save") {
      const form = document.querySelector("form[data-controller~='autosave']")
      form?.requestSubmit()
      this.close()
    } else if (id === "toggle-vim") {
      const toggle = document.querySelector("[data-editor-target='vimToggle']")
      if (toggle) toggle.click()
      this.close()
    } else if (id === "vim-settings") {
      const summary = document.querySelector(".editor-settings summary")
      const details = summary?.closest("details")
      if (details) details.open = true
      this.close()
      summary?.focus()
    } else if (id === "toggle-metadata") {
      const editor = document.querySelector(".source-field")?.editorController
      editor?.toggleMetadataVisibility()
      this.close()
    }
  }

  renderCurrentMode() {
    if (this.mode === "search") this.renderResults()
    else if (this.mode === "appearance-categories" || this.mode === "appearance-values") this.renderAppearanceOptions()
    else this.renderCommands()
  }

  renderCommands(query = "") {
    const commands = this.commandsValue.filter((command) => {
      if (command.requiresEditor && !document.querySelector("form[data-controller~='autosave']")) return false
      return true
    })

    this.renderOptions(commands, query, "No matching commands.")
  }

  renderAppearanceOptions(query = this.inputTarget.value) {
    const themeLabels = { match: "Match workspace", light: "Light", dark: "Dark" }
    const typographyLabels = { book: "Book", modern: "Modern", technical: "Technical" }
    const options = this.mode === "appearance-categories"
      ? [
          { id: "theme", label: "Theme", description: `Current: ${themeLabels[this.themeValue] || "Match workspace"}` },
          { id: "typography", label: "Typography", description: `Current: ${typographyLabels[this.typographyValue] || "Book"}` }
        ]
      : (this.appearanceCategory === "theme"
          ? Object.entries(themeLabels).map(([id, label]) => ({ id, label, description: id === this.themeValue ? "Current workspace default" : "Set this workspace default" }))
          : Object.entries(typographyLabels).map(([id, label]) => ({ id, label, description: id === this.typographyValue ? "Current workspace default" : "Set this workspace default" })))

    if (this.mode === "appearance-values") this.headingTarget.textContent = `Change default ${this.appearanceCategory}`
    this.renderOptions(options, query, "No matching choices.")
  }

  renderOptions(options, query, emptyMessage) {
    const terms = this.normalize(query).split(/\s+/).filter(Boolean)
    this.visibleCommands = options.filter((option) => {
      const searchable = this.normalize(`${option.label} ${option.description || ""}`)
      return terms.every((term) => searchable.includes(term))
    })

    this.resultsTarget.replaceChildren()
    this.visibleCommands.forEach((command, index) => {
      const shortcut = command.shortcutKey ? this.shortcutLabel(command.shortcutKey) : command.shortcut
      const details = [command.description, shortcut].filter(Boolean).join(" · ")
      const button = this.commandButton(command.label, details, index)
      button.addEventListener("click", () => {
        this.selectedIndex = index
        this.activateSelected()
      })
      this.resultsTarget.append(button)
    })

    if (!this.visibleCommands.length) this.renderEmptyState(emptyMessage)
    this.updateSelection()
  }

  renderResults() {
    this.resultsTarget.replaceChildren()
    this.resultsData.forEach((result, index) => {
      const section = result.matched_in ? `In ${result.matched_in}` : ""
      const details = [result.type_label, section, result.context].filter(Boolean).join(" · ")
      const button = this.commandButton(result.title, details, index)
      button.dataset.resultUrl = result.url
      button.addEventListener("click", () => {
        this.selectedIndex = index
        this.activateSelected()
      })
      this.resultsTarget.append(button)
    })

    if (!this.resultsData.length && this.inputTarget.value.trim()) this.renderEmptyState("No matching work.")
    this.updateSelection()
  }

  renderEmptyState(message) {
    const empty = document.createElement("p")
    empty.className = "command-palette-empty"
    empty.textContent = message
    this.resultsTarget.append(empty)
  }

  openAppearanceCategories() {
    this.appearanceCategory = null
    this.inputTarget.value = ""
    this.selectedIndex = 0
    this.setModeChrome("appearance-categories")
    this.renderAppearanceOptions("")
    this.setStatus("Choose Theme or Typography. Enter opens its choices; Esc goes back.")
  }

  openAppearanceValues(category) {
    this.appearanceCategory = category
    this.inputTarget.value = ""
    this.selectedIndex = 0
    this.setModeChrome("appearance-values")
    this.renderAppearanceOptions("")
    this.setStatus(`Choose a ${category} default. Enter applies it immediately; Esc goes back.`)
  }

  goBackAppearance() {
    if (this.mode === "appearance-values") {
      this.openAppearanceCategories()
    } else if (this.mode === "appearance-categories") {
      this.openMode("commands")
    }
  }

  setModeChrome(mode) {
    this.mode = mode
    this.dialogTarget.dataset.mode = mode
    const modeCopy = {
      commands: {
        heading: "Command palette",
        placeholder: "Filter commands…",
        label: "Filter commands",
        listLabel: "Elef commands",
        button: "Esc",
        buttonLabel: "Close command palette",
        hint: "↑/↓ move · Enter choose · Esc close"
      },
      search: {
        heading: "Search presentations and documents",
        placeholder: "Search by title, alias, heading, or content…",
        label: "Search presentations and documents",
        listLabel: "Search results",
        button: "Esc",
        buttonLabel: "Close command palette",
        hint: "↑/↓ move · Enter open · Esc close"
      },
      "appearance-categories": {
        heading: "Change workspace appearance",
        placeholder: "Choose Theme or Typography…",
        label: "Choose Theme or Typography",
        listLabel: "Appearance settings",
        button: "Back",
        buttonLabel: "Back to commands",
        hint: "↑/↓ move · Enter choose · Esc back"
      },
      "appearance-values": {
        heading: "Change appearance default",
        placeholder: "Choose a value…",
        label: "Choose an appearance value",
        listLabel: "Appearance values",
        button: "Back",
        buttonLabel: "Back to appearance settings",
        hint: "↑/↓ move · Enter apply · Esc back"
      }
    }[mode]

    this.headingTarget.textContent = modeCopy.heading
    this.inputTarget.placeholder = modeCopy.placeholder
    this.inputTarget.setAttribute("aria-label", modeCopy.label)
    this.inputTarget.setAttribute("aria-expanded", "true")
    this.resultsTarget.setAttribute("aria-label", modeCopy.listLabel)
    this.filtersTarget.hidden = mode !== "search"
    this.closeButtonTarget.textContent = modeCopy.button
    this.closeButtonTarget.setAttribute("aria-label", modeCopy.buttonLabel)
    this.hintTarget.textContent = modeCopy.hint
  }

  async saveAppearance(value) {
    if (this.savingAppearance) return

    const category = this.appearanceCategory
    const labels = category === "theme"
      ? { match: "Match workspace", light: "Light", dark: "Dark" }
      : { book: "Book", modern: "Modern", technical: "Technical" }
    this.savingAppearance = true
    this.setStatus(`Updating workspace ${category}…`)

    try {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || ""
      const response = await fetch(this.settingsUrlValue, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ workspace: { [category]: value } })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "The workspace appearance could not be updated.")

      if (category === "theme") this.themeValue = value
      else this.typographyValue = value

      const categoryLabel = category === "theme" ? "theme" : "typography"
      const successMessage = `Workspace default ${categoryLabel} set to ${labels[value]}. Applies to new and unstyled work; work-specific settings take precedence.`
      this.appearanceCategory = null
      this.inputTarget.value = ""
      this.selectedIndex = 0
      this.setModeChrome("commands")
      this.renderCommands("")
      this.setStatus(successMessage)
    } catch (error) {
      this.setStatus(`${error.message} Try again or press Esc to go back.`)
    } finally {
      this.savingAppearance = false
    }
  }

  commandButton(label, description, index) {
    const button = document.createElement("button")
    button.type = "button"
    button.role = "option"
    button.id = `command-palette-option-${index}`
    button.className = "command-palette-option"
    button.dataset.index = index
    const title = document.createElement("strong")
    title.textContent = label
    const details = document.createElement("span")
    details.textContent = description || ""
    button.append(title, details)
    return button
  }

  updateSelection() {
    let selectedId = null
    this.resultsTarget.querySelectorAll("[role='option']").forEach((option, index) => {
      const selected = index === this.selectedIndex
      option.setAttribute("aria-selected", String(selected))
      if (selected) {
        selectedId = option.id
        option.scrollIntoView({ block: "nearest" })
      }
    })
    if (selectedId) this.inputTarget.setAttribute("aria-activedescendant", selectedId)
    else this.inputTarget.removeAttribute("aria-activedescendant")
  }

  updateFilterSelection() {
    this.filtersTarget.querySelectorAll("[data-type]").forEach((button) => {
      button.setAttribute("aria-pressed", String((button.dataset.type || "all") === this.searchType))
    })
  }

  updateShortcutLabels() {
    this.element.querySelectorAll("[data-command-palette-shortcut]").forEach((element) => {
      element.textContent = this.shortcutLabel(element.dataset.commandPaletteShortcut)
    })
  }

  shortcutLabel(key) {
    return `${this.shortcutModifier}${key.toUpperCase()}`
  }

  normalize(text) {
    return text.toString().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  }

  cancelSearch() {
    clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.searchController?.abort()
    this.searchController = null
    this.searchSequence = (this.searchSequence || 0) + 1
  }

  setStatus(text) {
    if (this.hasStatusTarget) this.statusTarget.textContent = text
  }

  isOpen() {
    return this.dialogTarget.open || this.dialogTarget.hasAttribute("open")
  }
}

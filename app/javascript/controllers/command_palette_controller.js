import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["dialog", "heading", "input", "filters", "results", "status"]
  static values = { searchUrl: String, commands: Array }

  connect() {
    this.mode = "commands"
    this.searchType = "all"
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
      this.close()
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
    this.mode = mode
    this.searchType = "all"
    this.selectedIndex = 0
    this.resultsData = []
    this.dialogTarget.dataset.mode = mode
    this.headingTarget.textContent = mode === "commands" ? "Command palette" : "Search presentations and documents"
    this.inputTarget.placeholder = mode === "commands" ? "Filter commands…" : "Search by title, alias, heading, or content…"
    this.inputTarget.setAttribute("aria-label", mode === "commands" ? "Filter commands" : "Search presentations and documents")
    this.inputTarget.setAttribute("aria-expanded", "true")
    this.resultsTarget.setAttribute("aria-label", mode === "commands" ? "Elef commands" : "Search results")
    this.filtersTarget.hidden = mode !== "search"
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
    if (command.url) {
      window.location.assign(command.url)
      return
    }
    this.runCommand(command.id)
  }

  runCommand(id) {
    if (id === "quick-open") {
      this.openSearch()
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
    else this.renderCommands()
  }

  renderCommands(query = "") {
    const terms = this.normalize(query).split(/\s+/).filter(Boolean)
    this.visibleCommands = this.commandsValue.filter((command) => {
      if (command.requiresEditor && !document.querySelector("form[data-controller~='autosave']")) return false
      const searchable = this.normalize(`${command.label} ${command.description || ""}`)
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

    if (!this.visibleCommands.length) this.renderEmptyState("No matching commands.")
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

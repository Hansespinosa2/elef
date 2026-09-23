import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["dialog", "input", "results", "status"]
  static values = { searchUrl: String, commands: Array }

  connect() {
    this.selectedIndex = 0
    this.resultsData = []
    this.handleGlobalKeydown = (event) => this.globalKeydown(event)
    window.addEventListener("keydown", this.handleGlobalKeydown)
    this.renderCommands()
  }

  disconnect() {
    window.removeEventListener("keydown", this.handleGlobalKeydown)
  }

  globalKeydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault()
      this.open()
    } else if (event.key === "Escape" && this.isOpen()) {
      event.preventDefault()
      this.close()
    }
  }

  open() {
    if (!this.isOpen()) {
      if (typeof this.dialogTarget.showModal === "function") this.dialogTarget.showModal()
      else this.dialogTarget.setAttribute("open", "")
    }
    this.inputTarget.value = ""
    this.selectedIndex = 0
    this.resultsData = []
    this.renderCommands()
    this.inputTarget.focus()
  }

  close() {
    if (typeof this.dialogTarget.close === "function") this.dialogTarget.close()
    else this.dialogTarget.removeAttribute("open")
  }

  inputChanged() {
    clearTimeout(this.searchTimer)
    const query = this.inputTarget.value.trim()
    if (!query) {
      this.resultsData = []
      this.selectedIndex = 0
      this.renderCommands()
      return
    }
    this.setStatus("Searching…")
    this.searchTimer = setTimeout(() => this.search(query), 120)
  }

  async search(query) {
    try {
      const response = await fetch(`${this.searchUrlValue}?q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } })
      const payload = await response.json()
      this.resultsData = payload.results || []
      this.selectedIndex = 0
      this.renderResults()
      this.setStatus(`${this.resultsData.length} result${this.resultsData.length === 1 ? "" : "s"}`)
    } catch (_error) {
      this.resultsData = []
      this.renderResults()
      this.setStatus("Search unavailable")
    }
  }

  keydown(event) {
    const count = this.resultsData.length || this.commandsValue.length
    if (event.key === "ArrowDown") {
      event.preventDefault()
      this.selectedIndex = (this.selectedIndex + 1) % Math.max(count, 1)
      this.updateSelection()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      this.selectedIndex = (this.selectedIndex - 1 + Math.max(count, 1)) % Math.max(count, 1)
      this.updateSelection()
    } else if ((event.key === "Enter" || event.key === "Tab") && count > 0) {
      event.preventDefault()
      this.activateSelected()
    }
  }

  activateSelected() {
    if (this.resultsData.length) {
      const result = this.resultsData[this.selectedIndex]
      if (result?.url) window.location.assign(result.url)
      return
    }

    const command = this.commandsValue[this.selectedIndex]
    if (!command) return
    if (command.url) {
      window.location.assign(command.url)
      return
    }
    this.runCommand(command.id)
  }

  runCommand(id) {
    if (id === "quick-open") {
      this.inputTarget.focus()
      this.setStatus("Type a title, alias, heading, or source phrase to search.")
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
      summary?.focus()
      this.close()
    } else if (id === "reveal-metadata") {
      const editor = document.querySelector(".source-field")?.editorController
      editor?.revealMetadata()
      this.close()
    }
  }

  renderCommands() {
    this.resultsTarget.replaceChildren()
    this.commandsValue.forEach((command, index) => {
      const button = this.commandButton(command.label, command.description, index)
      button.addEventListener("click", () => { this.selectedIndex = index; this.activateSelected() })
      this.resultsTarget.append(button)
    })
    this.updateSelection()
  }

  renderResults() {
    this.resultsTarget.replaceChildren()
    this.resultsData.forEach((result, index) => {
      const button = this.commandButton(result.title, `${result.type_label} · ${result.matched_in || "source"}${result.context ? ` · ${result.context}` : ""}`, index)
      button.dataset.resultUrl = result.url
      button.addEventListener("click", () => { this.selectedIndex = index; this.activateSelected() })
      this.resultsTarget.append(button)
    })
    this.updateSelection()
  }

  commandButton(label, description, index) {
    const button = document.createElement("button")
    button.type = "button"
    button.role = "option"
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
    this.resultsTarget.querySelectorAll("[role='option']").forEach((option, index) => {
      const selected = index === this.selectedIndex
      option.setAttribute("aria-selected", String(selected))
      if (selected) option.scrollIntoView({ block: "nearest" })
    })
  }

  setStatus(text) {
    if (this.hasStatusTarget) this.statusTarget.textContent = text
  }

  isOpen() {
    return this.dialogTarget.open || this.dialogTarget.hasAttribute("open")
  }
}

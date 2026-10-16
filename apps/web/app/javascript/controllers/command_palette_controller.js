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
    this.previouslyFocusedElement = null
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
    } else if (hasModifier && !event.shiftKey && key === "s") {
      // Owner ruling: Cmd+S prevents the browser save dialog in the editor
      // context and wires to Save. Outside the editor the browser keeps its
      // default, so this never fights save-page on library or settings.
      // Window-level, modifier-only: Vim normal mode consumes unmodified
      // keys and the vim layer passes modified keys through (verified in
      // @replit/codemirror-vim-core vim.js vimKeyFromEvent/handleKey), so
      // this fires with Vim mode enabled too.
      if (this.editorForm()) {
        event.preventDefault()
        this.runCommand("save")
      }
    } else if (hasModifier && !event.shiftKey && key === "enter") {
      // Present/publish chord. Conditional preventDefault: with no publish
      // target on the page (e.g. present mode itself) the key is left alone.
      if (this.publishTarget()) {
        event.preventDefault()
        this.runCommand("present")
      }
    } else if (event.key === "Escape" && this.isOpen()) {
      event.preventDefault()
      if (this.mode === "appearance-values" || this.mode === "appearance-categories") this.goBackAppearance()
      else this.close()
    }
  }

  editorForm() {
    return document.querySelector("form[data-controller~='autosave']")
  }

  publishTarget() {
    return document.querySelector("form[action*='publish'] button[type='submit'], form[action*='publish'] input[type='submit']")
      || document.querySelector("[data-command-palette-present]")
  }

  printTarget() {
    return document.querySelector("a[href*='/print']")
  }

  pptxTarget() {
    // The edit page renders the shared Export menu (options carry
    // data-export-format); show pages keep standalone pptx-export-host
    // buttons, which stay as the fallback.
    return document.querySelector("[data-export-format='pptx']")
      || document.querySelector("[data-controller='pptx-export-host'] button")
  }

  bugReportTrigger() {
    return document.querySelector(".bug-report-trigger")
  }

  loadSamplesTarget() {
    return document.querySelector("form[action*='load_samples']")
  }

  slideActionTarget(name) {
    return document.querySelector(`[data-action='slide-overview#${name}']`)
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
    if (!this.isOpen()) {
      this.previouslyFocusedElement = typeof document !== "undefined" ? document.activeElement : null
    }
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
    this.restoreFocus()
  }

  restoreFocus() {
    const element = this.previouslyFocusedElement
    this.previouslyFocusedElement = null
    if (element && element.isConnected && typeof element.focus === "function") element.focus()
  }

  dialogClick(event) {
    if (event.target === this.dialogTarget) this.close()
  }

  dialogClosed() {
    this.cancelSearch()
    this.inputTarget.setAttribute("aria-expanded", "false")
    this.restoreFocus()
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
      this.editorForm()?.requestSubmit()
      this.close()
    } else if (id === "present") {
      const target = this.publishTarget()
      if (!target) {
        this.setStatus("Present is not available on this page.")
      } else if (target.tagName === "FORM") {
        target.requestSubmit()
        this.close()
      } else {
        // Click, not requestSubmit: the click passes the dirty-navigation
        // guard, so presenting with unsaved changes still confirms first.
        target.click()
        this.close()
      }
    } else if (id === "print") {
      const target = this.printTarget()
      if (target) {
        this.close()
        window.location.assign(target.href)
      } else {
        this.setStatus("Print is not available on this page.")
      }
    } else if (id === "download-pptx") {
      const target = this.pptxTarget()
      if (target) {
        target.click()
        this.close()
      } else {
        this.setStatus("PowerPoint export is not available on this page.")
      }
    } else if (id === "report-bug") {
      const trigger = this.bugReportTrigger()
      if (trigger) {
        trigger.click()
        this.close()
      } else {
        this.setStatus("Bug reporting is not available on this page.")
      }
    } else if (id === "load-samples") {
      const target = this.loadSamplesTarget()
      if (target) {
        target.requestSubmit()
        this.close()
      } else {
        this.setStatus("Sample works can only be loaded from the library.")
      }
    } else if (id.startsWith("slide-")) {
      // Slide-structure actions ride the overview buttons for the selected
      // slide, so palette and toolbar share one behavior.
      const target = this.slideActionTarget(
        { "slide-add": "add", "slide-duplicate": "duplicate", "slide-delete": "delete", "slide-move-up": "moveUp", "slide-move-down": "moveDown" }[id]
      )
      if (target) {
        target.click()
        this.close()
      } else {
        this.setStatus("Slide actions need a presentation editor on this page.")
      }
    } else if (id === "toggle-vim") {
      const toggle = document.querySelector("[data-editor-target='vimToggle']")
      if (toggle) {
        toggle.click()
      } else {
        const editor = document.querySelector(".source-field")?.editorController
        editor?.toggleVim()
      }
      this.close()
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
      const button = this.commandButton(command.label, command.description || "", index, shortcut)
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

  commandButton(label, description, index, shortcut) {
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
    // Display convention (shared with docs/keyboard-shortcuts.md): every
    // palette row shows label + description + a <kbd> chord chip when the
    // action has a direct chord.
    if (shortcut) {
      const chip = document.createElement("kbd")
      chip.className = "command-palette-shortcut"
      chip.textContent = shortcut
      button.append(chip)
    }
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
    // Document-wide so icon-only action buttons (e.g. Present ⌘↵) share the
    // platform-correct chip, not just the palette triggers.
    const root = typeof document !== "undefined" ? document : this.element
    root.querySelectorAll("[data-command-palette-shortcut]").forEach((element) => {
      element.textContent = this.shortcutLabel(element.dataset.commandPaletteShortcut)
    })
  }

  shortcutLabel(key) {
    // Display convention: single letters uppercase (⌘S), Enter as ↵ (⌘↵).
    const display = key === "Enter" ? "↵" : key.toUpperCase()
    return `${this.shortcutModifier}${display}`
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

import { Controller } from "@hotwired/stimulus"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { tags } from "@lezer/highlight"
import { Vim, getCM, vim } from "@replit/codemirror-vim"

const ENABLED_STORAGE_KEY = "elef.editor.vim.enabled"
const ESCAPE_KEY_STORAGE_KEY = "elef.editor.vim.escapeKey"
const LEGACY_ESCAPE_ALIAS_STORAGE_KEY = "elef.editor.vim.escapeAlias"
const LINE_NUMBERS_STORAGE_KEY = "elef.editor.lineNumbers"
const MODE_AWARE_CURSOR_STORAGE_KEY = "elef.editor.vim.modeAwareCursor"
const SHIFT_SPACE = "<S-Space>"
const VIM_ESCAPE_MODES = ["normal", "insert", "visual"]
let activeEscapeKey = ""

const VIM_KEY_NAMES = {
  " ": "Space",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backspace: "BS",
  Enter: "CR",
  Delete: "Del",
  Escape: "Esc",
  Insert: "Ins",
  PageDown: "PageDown",
  PageUp: "PageUp"
}

const VIM_MODIFIER_NAMES = { A: "Alt", C: "Ctrl", M: "Meta", S: "Shift" }

const elefMetadata = {
  defineNodes: [{ name: "ElefMetadata", block: true, style: tags.processingInstruction }],
  parseBlock: [{
    name: "ElefMetadata",
    before: "FencedCode",
    parse: (context, line) => {
      if (!line.text.slice(line.pos).startsWith(":::")) return false

      context.addElement(context.elt("ElefMetadata", context.lineStart + line.pos, context.lineStart + line.text.length))
      context.nextLine()
      return true
    }
  }]
}

const theme = EditorView.theme({
  "&": {
    backgroundColor: "#11161a",
    color: "#e9eee9",
    fontSize: "0.9rem",
    minHeight: "24rem"
  },
  ".cm-scroller": {
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace",
    lineHeight: "1.55",
    minHeight: "24rem",
    overflow: "auto"
  },
  ".cm-content": {
    caretColor: "#9fc5a9",
    minHeight: "24rem",
    padding: "0.75rem"
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#9fc5a9" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#304047" },
  ".cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "#11161a", borderRight: "1px solid #304047" },
  ".cm-activeLine": { backgroundColor: "#182126" },
  ".cm-activeLineGutter": { backgroundColor: "#182126" }
}, { dark: true })

export default class extends Controller {
  static targets = ["surface", "input", "mode", "command", "vimToggle", "escapeKey", "lineNumbers", "modeAwareCursor", "metadataToggle"]

  connect() {
    this.editorController = this
    this.element.editorController = this
    this.destroyed = false
    this.vimEnabled = this.readBoolean(ENABLED_STORAGE_KEY)
    this.escapeKey = this.readEscapeKey()
    this.lineNumberMode = this.readLineNumberMode()
    this.modeAwareCursor = this.readBoolean(MODE_AWARE_CURSOR_STORAGE_KEY)
    this.vimCompartment = new Compartment()
    this.inputTarget.addEventListener("input", this.handleExternalInput = () => this.handleExternalInputEvent())
    this.inputTarget.addEventListener("change", this.handleExternalChange = () => this.handleExternalInputEvent())
    this.inputTarget.addEventListener("click", this.handleProxyClick = () => this.focus())
    this.surfaceTarget.addEventListener("click", this.handleSurfaceClick = (event) => this.focusFromSurface(event))

    this.view = new EditorView({
      state: EditorState.create({
        doc: this.inputTarget.value,
        extensions: [
          this.vimCompartment.of(this.vimEnabled ? vim() : []),
          basicSetup,
          markdown({ extensions: elefMetadata }),
          theme,
          EditorView.updateListener.of((update) => this.handleUpdate(update))
        ]
      }),
      parent: this.surfaceTarget
    })
    this.view.dom.setAttribute("aria-label", "Markdown source")
    this.view.dom.setAttribute("role", "textbox")
    this.view.dom.setAttribute("aria-multiline", "true")
    const labelledBy = this.surfaceTarget.getAttribute("aria-labelledby")
    if (labelledBy) this.view.dom.setAttribute("aria-labelledby", labelledBy)
    Object.defineProperties(this.surfaceTarget, {
      value: { configurable: true, get: () => this.value, set: (value) => this.setExternalValue(value) },
      selectionStart: { configurable: true, get: () => this.selectionStart },
      selectionEnd: { configurable: true, get: () => this.selectionEnd },
      setSelectionRange: { configurable: true, value: (anchor, head = anchor) => this.setSelectionRange(anchor, head) }
    })
    this.view.dom.addEventListener("focusout", this.handleFocusOut = () => this.dispatchFieldEvent("change"))
    this.view.dom.addEventListener("keydown", this.handleVimKeydown = () => queueMicrotask(() => this.updateMode()))
    this.inputTarget.addEventListener("keydown", this.handleProxyKeydown = (event) => this.forwardProxyKeydown(event))
    this.form = this.element.closest("form")
    this.form?.addEventListener("submit", this.handleSubmit = () => this.syncInput())

    this.vimToggleTarget.checked = this.vimEnabled
    this.escapeKeyTarget.value = this.escapeKeyDisplay(this.escapeKey)
    this.lineNumbersTarget.value = this.lineNumberMode
    this.modeAwareCursorTarget.checked = this.modeAwareCursor
    this.applyMapping()
    this.applyLineNumbers()
    this.applyCursorStyle()
    this.bindVimEvents()
    this.updateMode()
    this.collapseFrontmatter()
    this.element.dispatchEvent(new CustomEvent("elef:editor-ready", { detail: { editor: this }, bubbles: false }))
  }

  disconnect() {
    this.destroyed = true
    if (this.lineNumberFrame) cancelAnimationFrame(this.lineNumberFrame)
    this.form?.removeEventListener("submit", this.handleSubmit)
    this.inputTarget.removeEventListener("input", this.handleExternalInput)
    this.inputTarget.removeEventListener("change", this.handleExternalChange)
    this.inputTarget.removeEventListener("click", this.handleProxyClick)
    this.inputTarget.removeEventListener("keydown", this.handleProxyKeydown)
    this.surfaceTarget.removeEventListener("click", this.handleSurfaceClick)
    this.view?.dom.removeEventListener("focusout", this.handleFocusOut)
    this.view?.dom.removeEventListener("keydown", this.handleVimKeydown)
    this.unbindVimEvents()
    this.view?.destroy()
    if (this.element.editorController === this) delete this.element.editorController
  }

  toggleVim(event) {
    this.vimEnabled = event.target.checked
    this.writeBoolean(ENABLED_STORAGE_KEY, this.vimEnabled)
    this.view.dispatch({
      effects: this.vimCompartment.reconfigure(this.vimEnabled ? vim() : [])
    })
    this.applyMapping()
    setTimeout(() => {
      if (this.destroyed) return
      this.bindVimEvents()
      this.updateMode()
      this.view.focus()
    }, 0)
  }

  captureEscapeKey(event) {
    const key = this.vimKeyFromEvent(event)
    if (!key) return

    event.preventDefault()
    event.stopPropagation()
    this.escapeKey = key
    this.escapeKeyTarget.value = this.escapeKeyDisplay(key)
    this.writeValue(ESCAPE_KEY_STORAGE_KEY, key)
    this.applyMapping()
  }

  clearEscapeKey() {
    this.escapeKey = ""
    this.escapeKeyTarget.value = ""
    this.writeValue(ESCAPE_KEY_STORAGE_KEY, "")
    this.applyMapping()
  }

  lineNumbersChanged(event) {
    this.lineNumberMode = this.normalizeLineNumberMode(event.target.value)
    this.writeValue(LINE_NUMBERS_STORAGE_KEY, this.lineNumberMode)
    this.applyLineNumbers()
  }

  modeAwareCursorChanged(event) {
    this.modeAwareCursor = event.target.checked
    this.writeBoolean(MODE_AWARE_CURSOR_STORAGE_KEY, this.modeAwareCursor)
    this.applyCursorStyle()
  }

  toggleMetadataVisibility() {
    if (!this.view || !this.frontmatterRange) return

    if (this.frontmatterIsFolded()) {
      this.view.dispatch({
        effects: unfoldEffect.of(this.frontmatterRange),
        selection: { anchor: this.frontmatterRange.from },
        scrollIntoView: true
      })
    } else {
      this.view.dispatch({ effects: foldEffect.of(this.frontmatterRange) })
    }

    this.syncMetadataToggle()
    this.focus()
  }

  sync() {
    this.syncInput()
  }

  get value() {
    return this.view.state.doc.toString()
  }

  get selectionStart() {
    return this.view.state.selection.main.from
  }

  get selectionEnd() {
    return this.view.state.selection.main.to
  }

  get scrollElement() {
    return this.view.scrollDOM
  }

  get dom() {
    return this.view.dom
  }

  get vimMode() {
    return this.vim?.state?.vim?.mode || "normal"
  }

  get insertMode() {
    return !this.vimEnabled || Boolean(this.vim?.state?.vim?.insertMode)
  }

  focus() {
    this.view.focus()
  }

  setSelectionRange(anchor, head = anchor) {
    const length = this.view.state.doc.length
    const safeAnchor = Math.max(0, Math.min(anchor, length))
    const safeHead = Math.max(0, Math.min(head, length))
    this.view.dispatch({ selection: { anchor: safeAnchor, head: safeHead } })
    this.syncInput()
  }

  replaceRange(insert, from, to = from) {
    const end = from + insert.length
    this.view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: end },
      userEvent: "input"
    })
  }

  handleUpdate(update) {
    if (update.docChanged) {
      this.syncInput()
      this.refreshFrontmatterRange()
      this.dispatchFieldEvent("input")
    }
    if (update.selectionSet || update.docChanged) this.updateMode()
    if (update.selectionSet || update.docChanged || update.viewportChanged) this.scheduleLineNumberUpdate()
    this.syncMetadataToggle()
  }

  handleExternalInputEvent() {
    if (this.syncingInput || this.inputTarget.value === this.value) return

    const selection = {
      anchor: this.inputTarget.selectionStart ?? this.inputTarget.value.length,
      head: this.inputTarget.selectionEnd ?? this.inputTarget.value.length
    }
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: this.inputTarget.value },
      selection
    })
  }

  setExternalValue(value) {
    this.inputTarget.value = value
    this.handleExternalInputEvent()
  }

  syncInput() {
    const value = this.value
    this.syncingInput = true
    if (this.inputTarget.value !== value) this.inputTarget.value = value
    this.inputTarget.setSelectionRange(this.selectionStart, this.selectionEnd)
    this.syncingInput = false
  }

  dispatchFieldEvent(type) {
    this.syncInput()
    this.inputTarget.dispatchEvent(new Event(type, { bubbles: true }))
  }

  focusFromSurface(event) {
    if (event.target.closest("button, input, select, summary, .snippet-palette")) return
    this.focus()
  }

  forwardProxyKeydown(event) {
    // WebDriver and assistive tooling may still address the form field. Let
    // printable input take the native textarea path; its input event will
    // update CodeMirror without losing characters from a long fill.
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) return
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return

    if (this.inputTarget.value !== this.value) this.handleExternalInputEvent()
    this.setSelectionRange(this.inputTarget.selectionStart ?? this.selectionStart, this.inputTarget.selectionEnd ?? this.selectionEnd)
    this.focus()

    const forwarded = new KeyboardEvent(event.type, {
      key: event.key,
      code: event.code,
      location: event.location,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      bubbles: true,
      cancelable: true
    })
    this.view.contentDOM.dispatchEvent(forwarded)
    event.preventDefault()
  }

  bindVimEvents() {
    this.unbindVimEvents()
    this.vim = this.vimEnabled ? getCM(this.view) : null
    if (!this.vim) return
    this.handleVimModeChange = () => this.updateMode()
    this.handleVimCommandDone = () => this.updateMode()
    this.vim.on("vim-mode-change", this.handleVimModeChange)
    this.vim.on("vim-command-done", this.handleVimCommandDone)
  }

  unbindVimEvents() {
    if (!this.vim) return
    if (this.handleVimModeChange) this.vim.off("vim-mode-change", this.handleVimModeChange)
    if (this.handleVimCommandDone) this.vim.off("vim-command-done", this.handleVimCommandDone)
    this.vim = null
  }

  updateMode() {
    if (!this.hasModeTarget) return
    if (!this.vimEnabled) {
      this.modeTarget.textContent = "Standard"
      this.modeTarget.dataset.mode = "standard"
      if (this.hasCommandTarget) this.commandTarget.textContent = ""
      this.element.dataset.editorVimEnabled = "false"
      this.element.dataset.editorMode = "standard"
      this.applyCursorStyle()
      return
    }

    const mode = this.vimMode
    const label = mode.startsWith("visual") ? "Visual" : mode === "insert" ? "Insert" : "Normal"
    this.modeTarget.textContent = label
    this.modeTarget.dataset.mode = label.toLowerCase()
    this.element.dataset.editorVimEnabled = "true"
    this.element.dataset.editorMode = label.toLowerCase()
    this.applyCursorStyle()
    if (this.hasCommandTarget) this.commandTarget.textContent = this.vim?.state?.vim?.status || ""
  }

  applyMapping() {
    try {
      if (activeEscapeKey) {
        Vim.unmap(activeEscapeKey)
        VIM_ESCAPE_MODES.forEach((mode) => Vim.unmap(activeEscapeKey, mode))
      }
      activeEscapeKey = this.escapeKey
      if (activeEscapeKey && activeEscapeKey !== "<Esc>") {
        VIM_ESCAPE_MODES.forEach((mode) => Vim.map(activeEscapeKey, "<Esc>", mode))
      }
    } catch (_error) {
      // A browser without the optional Vim engine should still have a usable editor.
    }
  }

  readEscapeKey() {
    const saved = this.readValue(ESCAPE_KEY_STORAGE_KEY)
    if (saved !== null) return this.normalizeEscapeKey(saved)

    return this.readValue(LEGACY_ESCAPE_ALIAS_STORAGE_KEY) === "shift-space" ? SHIFT_SPACE : ""
  }

  readLineNumberMode() {
    return this.normalizeLineNumberMode(this.readValue(LINE_NUMBERS_STORAGE_KEY) || "absolute")
  }

  normalizeEscapeKey(value) {
    if (typeof value !== "string" || value.length === 0) return ""
    if (value.startsWith("<")) return /^(?:<(?:[CSMA]-)*[A-Za-z0-9]+>)+$/.test(value) ? value : ""
    return Array.from(value).length === 1 ? value : ""
  }

  vimKeyFromEvent(event) {
    if (["Shift", "Control", "Alt", "Meta", "Unidentified"].includes(event.key)) return ""

    const isLetter = /^[A-Za-z]$/.test(event.key)
    let key = VIM_KEY_NAMES[event.key] || event.key
    const modifiers = []
    if (event.ctrlKey) modifiers.push("C")
    if (event.shiftKey && (!Array.from(event.key).length || key.length > 1 || isLetter)) modifiers.push("S")
    if (event.altKey) modifiers.push("A")
    if (event.metaKey) modifiers.push("M")
    if (event.shiftKey && isLetter) key = key.toLowerCase()

    if (Array.from(key).length !== 1 || modifiers.length > 0) return `<${modifiers.join("-")}${modifiers.length ? "-" : ""}${key}>`
    return key
  }

  escapeKeyDisplay(key) {
    if (!key) return ""
    if (!key.startsWith("<")) return key

    return key.slice(1, -1).split("-").map((part) => VIM_MODIFIER_NAMES[part] || part).join("+")
  }

  normalizeLineNumberMode(value) {
    return ["absolute", "relative", "off"].includes(value) ? value : "absolute"
  }

  collapseFrontmatter() {
    this.refreshFrontmatterRange()
    if (!this.frontmatterRange) return

    setTimeout(() => {
      if (this.destroyed || !this.frontmatterRange || this.frontmatterIsFolded()) return
      this.view.dispatch({ effects: foldEffect.of(this.frontmatterRange) })
      this.syncMetadataToggle()
    }, 0)
  }

  refreshFrontmatterRange() {
    const match = this.value.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/)
    this.frontmatterRange = match && match[0].length > 4 ? { from: 0, to: match[0].length } : null
    this.syncMetadataToggle()
  }

  frontmatterIsFolded() {
    if (!this.frontmatterRange) return false

    let folded = false
    foldedRanges(this.view.state).between(this.frontmatterRange.from, this.frontmatterRange.to, (from, to) => {
      if (from === this.frontmatterRange.from && to === this.frontmatterRange.to) folded = true
    })
    return folded
  }

  syncMetadataToggle() {
    if (!this.hasMetadataToggleTarget) return

    const hasMetadata = Boolean(this.frontmatterRange)
    this.metadataToggleTarget.disabled = !hasMetadata
    this.metadataToggleTarget.textContent = hasMetadata && !this.frontmatterIsFolded() ? "Hide source metadata" : "Reveal source metadata"
  }

  applyLineNumbers() {
    this.surfaceTarget.dataset.lineNumbers = this.lineNumberMode
    const gutter = this.view.dom.querySelector(".cm-lineNumbers")
    if (gutter) gutter.style.display = this.lineNumberMode === "off" ? "none" : ""
    this.scheduleLineNumberUpdate()
  }

  scheduleLineNumberUpdate() {
    if (this.destroyed || this.lineNumberMode === "off" || this.lineNumberFrame) return

    this.lineNumberFrame = requestAnimationFrame(() => {
      this.lineNumberFrame = null
      if (this.destroyed || this.lineNumberMode === "off") return

      const gutter = this.view.dom.querySelector(".cm-lineNumbers")
      if (!gutter) return

      const contentLeft = this.view.contentDOM.getBoundingClientRect().left + 1
      const activeLine = this.view.state.doc.lineAt(this.view.state.selection.main.head).number
      gutter.querySelectorAll(".cm-gutterElement").forEach((element) => {
        if (element.style.visibility === "hidden") return

        const rect = element.getBoundingClientRect()
        const position = this.view.posAtCoords({ x: contentLeft, y: rect.top + rect.height / 2 })
        if (position === null) return

        const line = this.view.state.doc.lineAt(position).number
        const number = this.lineNumberMode === "relative" ? Math.abs(activeLine - line) : line
        element.textContent = String(number)
      })
    })
  }

  applyCursorStyle() {
    this.surfaceTarget.dataset.modeAwareCursor = String(this.modeAwareCursor)
  }

  readBoolean(key) {
    return this.readValue(key) === "true"
  }

  readValue(key) {
    try {
      return window.localStorage.getItem(key)
    } catch (_error) {
      return null
    }
  }

  writeValue(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch (_error) {
      // Private browsing and blocked storage should not disable editing.
    }
  }

  writeBoolean(key, value) {
    this.writeValue(key, String(value))
  }
}

export function editorFor(element) {
  return element.editorController || null
}

import { Controller } from "@hotwired/stimulus"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { foldEffect, unfoldAll } from "@codemirror/language"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { tags } from "@lezer/highlight"
import { Vim, getCM, vim } from "@replit/codemirror-vim"
import { livePreviewField, livePreviewMode } from "controllers/live_preview"

const ENABLED_STORAGE_KEY = "elef.editor.vim.enabled"
const MAPPING_STORAGE_KEY = "elef.editor.vim.normalMapping"
const ESCAPE_ALIAS_STORAGE_KEY = "elef.editor.vim.escapeAlias"
const LINE_NUMBERS_STORAGE_KEY = "elef.editor.lineNumbers"
const MODE_AWARE_CURSOR_STORAGE_KEY = "elef.editor.vim.modeAwareCursor"
const SHIFT_SPACE = "<S-Space>"

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
  static targets = ["surface", "input", "mode", "command", "vimToggle", "mapping", "editingMode", "visualButton", "sourceButton", "escapeAlias", "lineNumbers", "modeAwareCursor"]

  connect() {
    this.editorController = this
    this.element.editorController = this
    this.destroyed = false
    this.vimEnabled = this.readBoolean(ENABLED_STORAGE_KEY)
    this.mapping = this.readMapping()
    this.escapeAlias = this.readEscapeAlias()
    this.lineNumberMode = this.readLineNumberMode()
    this.modeAwareCursor = this.readBoolean(MODE_AWARE_CURSOR_STORAGE_KEY)
    this.vimCompartment = new Compartment()
    this.updateVisualSurfaceGeometry = () => this.syncVisualSurfaceGeometry()
    this.resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.updateVisualSurfaceGeometry)
    this.toolbar = this.element.querySelector(".editor-toolbar")
    this.resizeObserver?.observe(this.element)
    if (this.toolbar) this.resizeObserver?.observe(this.toolbar)
    this.syncVisualSurfaceGeometry()
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
          livePreviewField,
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
    this.reportLivePreviewState(this.view.state)

    this.vimToggleTarget.checked = this.vimEnabled
    this.mappingTarget.value = this.mapping
    this.escapeAliasTarget.value = this.escapeAlias
    this.lineNumbersTarget.value = this.lineNumberMode
    this.modeAwareCursorTarget.checked = this.modeAwareCursor
    this.applyMapping()
    this.applyLineNumbers()
    this.applyCursorStyle()
    this.bindVimEvents()
    this.setEditingMode("visual", { silent: true })
    this.updateMode()
    this.collapseFrontmatter()
    this.element.dispatchEvent(new CustomEvent("elef:editor-ready", { detail: { editor: this }, bubbles: true }))
  }

  disconnect() {
    this.destroyed = true
    this.form?.removeEventListener("submit", this.handleSubmit)
    this.resizeObserver?.disconnect()
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

  mappingChanged(event) {
    this.mapping = this.normalizeMapping(event.target.value)
    this.writeValue(MAPPING_STORAGE_KEY, this.mapping)
    this.applyMapping()
    this.updateMode()
  }

  escapeAliasChanged(event) {
    this.escapeAlias = this.normalizeEscapeAlias(event.target.value)
    this.writeValue(ESCAPE_ALIAS_STORAGE_KEY, this.escapeAlias)
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

  revealMetadata() {
    if (!this.view) return
    unfoldAll(this.view)
    const metadataLine = this.view.state.doc.line(1)
    this.view.dispatch({ selection: { anchor: metadataLine.from }, scrollIntoView: true })
    this.focus()
  }

  sync() {
    this.syncInput()
  }

  showVisual(event) {
    event?.preventDefault()
    this.setEditingMode("visual")
  }

  showSource(event) {
    event?.preventDefault()
    this.setEditingMode("source")
  }

  setEditingMode(mode, { silent = false } = {}) {
    this.editingMode = mode === "source" ? "source" : "visual"
    this.view?.dispatch({ effects: livePreviewMode.of(this.editingMode === "visual") })
    this.element.dataset.editorEditingMode = this.editingMode
    this.form?.setAttribute("data-editor-mode", this.editingMode)
    if (this.hasEditingModeTarget) this.editingModeTarget.textContent = this.editingMode === "visual" ? "Visual" : "Source"
    if (this.hasVisualButtonTarget) this.visualButtonTarget.setAttribute("aria-pressed", String(this.editingMode === "visual"))
    if (this.hasSourceButtonTarget) this.sourceButtonTarget.setAttribute("aria-pressed", String(this.editingMode === "source"))
    if (!silent) {
      this.form?.dispatchEvent(new CustomEvent("elef:editor-mode-change", {
        bubbles: true,
        detail: { mode: this.editingMode, editor: this }
      }))
    }
  }

  syncVisualSurfaceGeometry() {
    if (!this.toolbar) return

    const toolbarHeight = this.toolbar.getBoundingClientRect().height
    const surfaceHeight = Math.max(0, this.element.getBoundingClientRect().height - toolbarHeight)
    this.element.style.setProperty("--editor-toolbar-height", `${toolbarHeight}px`)
    this.element.style.setProperty("--editor-surface-height", `${surfaceHeight}px`)
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
    this.reportLivePreviewState(update.state)
    if (update.docChanged) {
      this.syncInput()
      this.dispatchFieldEvent("input")
    }
    if (update.selectionSet || update.docChanged) this.updateMode()
  }

  reportLivePreviewState(state) {
    const projection = state.field(livePreviewField, false)
    if (!projection) return

    if (projection.error && projection.error !== this.livePreviewError) {
      this.livePreviewError = projection.error
      this.element.dispatchEvent(new CustomEvent("elef:live-preview-error", {
        bubbles: true,
        detail: {
          message: "Live Markdown projection is unavailable. Your source remains editable; switch to Source mode or reload to restore it."
        }
      }))
    } else if (!projection.error && this.livePreviewError) {
      this.livePreviewError = null
      this.element.dispatchEvent(new CustomEvent("elef:live-preview-recovered", { bubbles: true }))
    }
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
      if (this.form) this.form.dataset.editorVimEnabled = "false"
      this.element.dataset.editorMode = "standard"
      this.applyCursorStyle()
      return
    }

    const mode = this.vimMode
    const label = mode.startsWith("visual") ? "Visual" : mode === "insert" ? "Insert" : "Normal"
    this.modeTarget.textContent = label
    this.modeTarget.dataset.mode = label.toLowerCase()
    this.element.dataset.editorVimEnabled = "true"
    if (this.form) this.form.dataset.editorVimEnabled = "true"
    this.element.dataset.editorMode = label.toLowerCase()
    this.applyCursorStyle()
    if (this.hasCommandTarget) this.commandTarget.textContent = this.vim?.state?.vim?.status || ""
  }

  applyMapping() {
    try {
      Vim.unmap(SHIFT_SPACE, "normal")
      Vim.unmap(SHIFT_SPACE, "insert")
      if (this.mapping === "insert") Vim.map(SHIFT_SPACE, "i", "normal")
      if (this.escapeAlias === "shift-space") Vim.map(SHIFT_SPACE, "<Esc>", "insert")
    } catch (_error) {
      // A browser without the optional Vim engine should still have a usable editor.
    }
  }

  readMapping() {
    return this.normalizeMapping(this.readValue(MAPPING_STORAGE_KEY) || "standard")
  }

  readEscapeAlias() {
    return this.normalizeEscapeAlias(this.readValue(ESCAPE_ALIAS_STORAGE_KEY) || "none")
  }

  readLineNumberMode() {
    return this.normalizeLineNumberMode(this.readValue(LINE_NUMBERS_STORAGE_KEY) || "absolute")
  }

  normalizeMapping(value) {
    return ["standard", "insert", "disabled"].includes(value) ? value : "standard"
  }

  normalizeEscapeAlias(value) {
    return ["none", "shift-space"].includes(value) ? value : "none"
  }

  normalizeLineNumberMode(value) {
    return ["absolute", "relative", "off"].includes(value) ? value : "absolute"
  }

  collapseFrontmatter() {
    const match = this.value.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/)
    if (!match || match[0].length <= 4) return

    setTimeout(() => {
      if (this.destroyed) return
      this.view.dispatch({ effects: foldEffect.of({ from: 0, to: match[0].length }) })
    }, 0)
  }

  applyLineNumbers() {
    this.surfaceTarget.dataset.lineNumbers = this.lineNumberMode
    requestAnimationFrame(() => {
      if (this.destroyed || this.lineNumberMode !== "relative") return
      const gutter = this.surfaceTarget.querySelector(".cm-lineNumbers")
      if (!gutter) return
      const activeLine = this.view.state.doc.lineAt(this.selectionStart).number
      gutter.querySelectorAll(".cm-gutterElement").forEach((element) => {
        const absolute = Number(element.textContent)
        if (Number.isFinite(absolute)) element.textContent = String(Math.abs(activeLine - absolute) || 0)
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

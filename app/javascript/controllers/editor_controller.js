import { Controller } from "@hotwired/stimulus"
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { Vim, getCM, vim } from "@replit/codemirror-vim"

const ENABLED_STORAGE_KEY = "elef.editor.vim.enabled"
const MAPPING_STORAGE_KEY = "elef.editor.vim.normalMapping"
const SHIFT_SPACE = "<S-Space>"
const METADATA_LINE = /^\s*:::/
const FENCE_LINE = /^\s*(`{3,}|~{3,})/

const metadataDecoration = Decoration.mark({ class: "cm-elef-metadata" })
const metadataDecorations = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.build(view)
  }

  update(update) {
    if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view)
  }

  build(view) {
    const decorations = new RangeSetBuilder()
    let fence = null

    for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber)
      const fenceMatch = line.text.match(FENCE_LINE)

      if (fence) {
        if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length) fence = null
        continue
      }

      if (fenceMatch) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
        continue
      }

      if (METADATA_LINE.test(line.text)) decorations.add(line.from, line.to, metadataDecoration)
    }

    return decorations.finish()
  }
}, { decorations: (value) => value.decorations })

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
  ".cm-activeLineGutter": { backgroundColor: "#182126" },
  ".cm-elef-metadata": {
    color: "#9eada3",
    opacity: "0.68",
    fontStyle: "italic"
  }
}, { dark: true })

export default class extends Controller {
  static targets = ["surface", "input", "mode", "command", "vimToggle", "mapping"]

  connect() {
    this.editorController = this
    this.element.editorController = this
    this.destroyed = false
    this.vimEnabled = this.readBoolean(ENABLED_STORAGE_KEY)
    this.mapping = this.readMapping()
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
          markdown(),
          metadataDecorations,
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
    this.mappingTarget.value = this.mapping
    this.applyMapping()
    this.bindVimEvents()
    this.updateMode()
    this.element.dispatchEvent(new CustomEvent("elef:editor-ready", { detail: { editor: this }, bubbles: false }))
  }

  disconnect() {
    this.destroyed = true
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

  mappingChanged(event) {
    this.mapping = this.normalizeMapping(event.target.value)
    this.writeValue(MAPPING_STORAGE_KEY, this.mapping)
    this.applyMapping()
    this.updateMode()
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
      this.dispatchFieldEvent("input")
    }
    if (update.selectionSet || update.docChanged) this.updateMode()
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
      return
    }

    const mode = this.vimMode
    const label = mode.startsWith("visual") ? "Visual" : mode === "insert" ? "Insert" : "Normal"
    this.modeTarget.textContent = label
    this.modeTarget.dataset.mode = label.toLowerCase()
    this.element.dataset.editorVimEnabled = "true"
    if (this.hasCommandTarget) this.commandTarget.textContent = this.vim?.state?.vim?.status || ""
  }

  applyMapping() {
    try {
      Vim.unmap(SHIFT_SPACE, "normal")
      if (this.mapping === "insert") Vim.map(SHIFT_SPACE, "i", "normal")
    } catch (_error) {
      // A browser without the optional Vim engine should still have a usable editor.
    }
  }

  readMapping() {
    return this.normalizeMapping(this.readValue(MAPPING_STORAGE_KEY) || "standard")
  }

  normalizeMapping(value) {
    return ["standard", "insert", "disabled"].includes(value) ? value : "standard"
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

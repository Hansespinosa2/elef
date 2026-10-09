import { Controller } from "@hotwired/stimulus"
import { createDocumentState } from "lib/editor_document_state"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView, lineNumbers } from "@codemirror/view"
import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { tags } from "@lezer/highlight"
import { Vim, getCM, vim } from "@replit/codemirror-vim"
import { livePreviewField, livePreviewMode } from "controllers/live_preview"
import {
  ENABLED_STORAGE_KEY,
  ESCAPE_KEY_STORAGE_KEY,
  LINE_NUMBERS_STORAGE_KEY,
  MODE_AWARE_CURSOR_STORAGE_KEY,
  escapeKeyDisplay,
  readBoolean,
  readEscapeKey,
  readLineNumberMode,
  normalizeLineNumberMode,
  vimKeyFromEvent,
  writeBoolean,
  writeValue
} from "controllers/vim_preferences"
import { snippetStopsField } from "controllers/snippet_stops"
import { formatLineNumber } from "lib/vim_line_numbers"
import {
  caretAfterInsert,
  clampSelection,
  detectLineSeparator,
  diffSource,
  frontmatterRangeFor,
  normalizeLineEndings,
  offsetSelection
} from "@elef/client"

const VIM_ESCAPE_MODES = ["normal", "insert", "visual", "operatorPending"]
let activeEscapeKey = ""

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
  ".cm-fat-cursor": { backgroundColor: "#9fc5a9", minWidth: "1ch" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#304047" },
  ".cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "#11161a", borderRight: "1px solid #304047" },
  ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.035)" },
  ".cm-activeLineGutter": { backgroundColor: "#182126" }
}, { dark: true })

export default class extends Controller {
  static targets = ["surface", "input", "mode", "command", "vimToggle", "escapeKey", "editingMode", "visualButton", "sourceButton", "lineNumbers", "modeAwareCursor", "metadataToggle"]

  connect() {
    this.editorController = this
    this.element.editorController = this
    this.editorReady = false
    this.destroyed = false
    this.pendingMediaRanges = new Map()
    this.nextMediaRangeId = 0
    this.vimEnabled = readBoolean(ENABLED_STORAGE_KEY)
    this.escapeKey = readEscapeKey()
    this.lineNumberMode = readLineNumberMode()
    this.modeAwareCursor = readBoolean(MODE_AWARE_CURSOR_STORAGE_KEY)
    this.initialSource = this.readInitialSource()
    this.lineSeparator = detectLineSeparator(this.initialSource)
    this.vimCompartment = new Compartment()
    this.lineNumbersCompartment = new Compartment()
    this.updateVisualSurfaceGeometry = () => this.syncVisualSurfaceGeometry()
    this.resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.updateVisualSurfaceGeometry)
    window.addEventListener("resize", this.updateVisualSurfaceGeometry)
    this.toolbar = this.element.querySelector(".editor-toolbar")
    this.resizeObserver?.observe(this.element)
    if (this.toolbar) this.resizeObserver?.observe(this.toolbar)
    this.syncVisualSurfaceGeometry()
    this.inputTarget.addEventListener("input", this.handleExternalInput = () => this.handleExternalInputEvent())
    this.inputTarget.addEventListener("change", this.handleExternalChange = () => this.handleExternalInputEvent())
    this.inputTarget.addEventListener("click", this.handleProxyClick = () => this.focus())
    this.surfaceTarget.addEventListener("click", this.handleSurfaceClick = (event) => this.focusFromSurface(event))

    this.documentExtensions = [
      this.vimCompartment.of(this.vimEnabled ? vim() : []),
      this.lineNumbersCompartment.of(this.createLineNumbersExtension()),
      ...basicSetup.slice(1),
      markdown({ extensions: elefMetadata }),
      livePreviewField,
      snippetStopsField,
      theme,
      EditorView.updateListener.of((update) => this.handleUpdate(update))
    ]
    this.view = new EditorView({
      state: createDocumentState(EditorState, this.initialSource, this.documentExtensions).state,
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
    this.view.dom.addEventListener("focusin", this.handleFocusIn = () => {
      this.changedSinceFocusOut = false
    })
    this.view.dom.addEventListener("focusout", this.handleFocusOut = () => {
      if (this.changedSinceFocusOut) {
        this.changedSinceFocusOut = false
        this.dispatchFieldEvent("change")
      } else {
        this.syncInput()
      }
    })
    this.view.dom.addEventListener("keydown", this.handleVimKeydown = () => queueMicrotask(() => this.updateMode()))
    this.inputTarget.addEventListener("keydown", this.handleProxyKeydown = (event) => this.forwardProxyKeydown(event))
    this.form = this.element.closest("form")
    this.form?.addEventListener("submit", this.handleSubmit = () => {
      this.projectionController()?.flushPendingProjectionEdits?.()
      this.syncInput()
    })
    this.reportLivePreviewState(this.view.state)
    this.form?.addEventListener("formdata", this.handleFormData = (event) => {
      this.projectionController()?.flushPendingProjectionEdits?.()
      if (this.inputTarget.name) event.formData.set(this.inputTarget.name, this.sourceValue)
    })

    if (this.hasVimToggleTarget) this.vimToggleTarget.checked = this.vimEnabled
    if (this.hasEscapeKeyTarget) this.escapeKeyTarget.value = escapeKeyDisplay(this.escapeKey)
    if (this.hasLineNumbersTarget) this.lineNumbersTarget.value = this.lineNumberMode
    if (this.hasModeAwareCursorTarget) this.modeAwareCursorTarget.checked = this.modeAwareCursor
    this.applyMapping()
    this.applyLineNumbers()
    this.applyCursorStyle()
    this.bindVimEvents()
    this.setEditingMode(this.form?.dataset.editorMode || "visual", { silent: true })
    this.updateMode()
    this.collapseFrontmatter()
    this.editorReady = true
    this.element.dispatchEvent(new CustomEvent("elef:editor-ready", { detail: { editor: this }, bubbles: true }))
  }

  disconnect() {
    this.editorReady = false
    this.destroyed = true
    this.session = null
    this.pendingMediaRanges?.clear()
    if (this.lineNumberFrame) cancelAnimationFrame(this.lineNumberFrame)
    this.form?.removeEventListener("submit", this.handleSubmit)
    this.resizeObserver?.disconnect()
    window.removeEventListener("resize", this.updateVisualSurfaceGeometry)
    this.form?.removeEventListener("formdata", this.handleFormData)
    this.inputTarget.removeEventListener("input", this.handleExternalInput)
    this.inputTarget.removeEventListener("change", this.handleExternalChange)
    this.inputTarget.removeEventListener("click", this.handleProxyClick)
    this.inputTarget.removeEventListener("keydown", this.handleProxyKeydown)
    this.surfaceTarget.removeEventListener("click", this.handleSurfaceClick)
    this.view?.dom.removeEventListener("focusin", this.handleFocusIn)
    this.view?.dom.removeEventListener("focusout", this.handleFocusOut)
    this.view?.dom.removeEventListener("keydown", this.handleVimKeydown)
    this.unbindVimEvents()
    this.view?.destroy()
    if (this.element.editorController === this) delete this.element.editorController
  }

  toggleVim(event) {
    const enabled = event && typeof event.target?.checked === "boolean"
      ? event.target.checked
      : typeof event === "boolean" ? event : !this.vimEnabled
    this.setVimEnabled(enabled, { focus: true })
  }

  setVimEnabled(enabled, { focus = false } = {}) {
    this.vimEnabled = Boolean(enabled)
    writeBoolean(ENABLED_STORAGE_KEY, this.vimEnabled)
    if (this.hasVimToggleTarget) this.vimToggleTarget.checked = this.vimEnabled
    this.view.dispatch({
      effects: this.vimCompartment.reconfigure(this.vimEnabled ? vim() : [])
    })
    this.applyMapping()
    setTimeout(() => {
      if (this.destroyed) return
      this.bindVimEvents()
      this.updateMode()
      if (focus) this.view.focus()
    }, 0)
  }

  captureEscapeKey(event) {
    const key = vimKeyFromEvent(event)
    if (!key) return

    event.preventDefault()
    event.stopPropagation()
    this.setEscapeKey(key)
  }

  setEscapeKey(key) {
    this.escapeKey = key
    if (this.hasEscapeKeyTarget) this.escapeKeyTarget.value = escapeKeyDisplay(key)
    writeValue(ESCAPE_KEY_STORAGE_KEY, key)
    this.applyMapping()
  }

  clearEscapeKey() {
    this.setEscapeKey("")
  }

  lineNumbersChanged(event) {
    this.setLineNumberMode(event.target.value)
  }

  setLineNumberMode(mode) {
    this.lineNumberMode = normalizeLineNumberMode(mode)
    writeValue(LINE_NUMBERS_STORAGE_KEY, this.lineNumberMode)
    this.applyLineNumbers()
  }

  modeAwareCursorChanged(event) {
    this.setModeAwareCursor(event.target.checked)
  }

  setModeAwareCursor(enabled) {
    this.modeAwareCursor = Boolean(enabled)
    writeBoolean(MODE_AWARE_CURSOR_STORAGE_KEY, this.modeAwareCursor)
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

  showVisual(event) {
    event?.preventDefault()
    this.setEditingMode("visual")
  }

  showSource(event) {
    event?.preventDefault()
    this.setEditingMode("source")
  }

  setEditingMode(mode, { silent = false, restoreCaret = true } = {}) {
    const nextMode = mode === "source" ? "source" : "visual"
    const previousMode = this.editingMode
    if (!silent && previousMode === nextMode) return

    const projectionController = this.projectionController()
    if (!silent && previousMode === "visual") projectionController?.flushPendingProjectionEdits?.()
    const visualCaret = previousMode === "visual" ? projectionController?.captureCaret?.() : null
    const sourceOffset = visualCaret?.sourceOffset ?? this.view.state.selection.main.head
    const preferredBlockId = visualCaret?.blockId ?? null

    this.editingMode = nextMode
    this.view?.dispatch({ effects: livePreviewMode.of(this.editingMode === "visual") })
    this.element.dataset.editorEditingMode = this.editingMode
    this.form?.setAttribute("data-editor-mode", this.editingMode)
    const modeInput = this.form?.querySelector('[name="editor_mode"]')
    if (modeInput) modeInput.value = this.editingMode
    if (this.hasEditingModeTarget) this.editingModeTarget.textContent = this.editingMode === "visual" ? "Visual" : "Source"
    if (this.hasVisualButtonTarget) this.visualButtonTarget.setAttribute("aria-pressed", String(this.editingMode === "visual"))
    if (this.hasSourceButtonTarget) this.sourceButtonTarget.setAttribute("aria-pressed", String(this.editingMode === "source"))
    this.syncFrontmatterVisibility()
    this.syncMetadataToggle()
    if (!silent) {
      const selectionAtModeChange = this.view.state.selection
      this.form?.dispatchEvent(new CustomEvent("elef:editor-mode-change", {
        bubbles: true,
        detail: { mode: this.editingMode, editor: this }
      }))

      requestAnimationFrame(() => {
        if (this.destroyed || this.editingMode !== nextMode) return
        if (nextMode === "source") {
          if (this.view.dom.contains(document.activeElement)) return
          // A toolbar action or file picker may set a new insertion range
          // before this frame runs. Preserve that deliberate selection.
          if (!this.view.state.selection.eq(selectionAtModeChange)) return
          if (this.vimEnabled && this.vimMode.startsWith("visual")) Vim.handleKey(this.vim, "<Esc>", "user")
          this.view.dispatch({ selection: { anchor: sourceOffset } })
          this.view.focus()
        } else if (restoreCaret) {
          this.projectionController()?.restoreCaret?.(sourceOffset, preferredBlockId)
        }
      })
    }
  }

  projectionController() {
    return this.form?.presentationEditorController || this.form?.visualEditorController || null
  }

  syncVisualSurfaceGeometry() {
    if (!this.toolbar) return

    const toolbarHeight = this.toolbar.getBoundingClientRect().height
    const surfaceHeight = Math.max(0, this.element.getBoundingClientRect().height - toolbarHeight)
    this.element.style.setProperty("--editor-toolbar-height", `${toolbarHeight}px`)
    this.element.style.setProperty("--editor-surface-height", `${surfaceHeight}px`)
  }

  get value() {
    return this.view.state.doc.sliceString(0, this.view.state.doc.length, "\n")
  }

  get sourceValue() {
    return this.view.state.sliceDoc()
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
    if (this.destroyed || !this.view) return
    const { anchor: safeAnchor, head: safeHead } = clampSelection(anchor, head, this.view.state.doc.length)
    this.view.dispatch({ selection: { anchor: safeAnchor, head: safeHead } })
    this.syncInput()
  }

  replaceServerSource(source) {
    if (typeof source !== "string") return

    const current = this.value
    const change = diffSource(current, source, this.lineSeparator)
    if (!change) return

    const frontmatterWasFolded = this.frontmatterIsFolded()
    this.view.dispatch({ changes: change })

    if (frontmatterWasFolded && this.frontmatterRange && !this.frontmatterIsFolded()) {
      this.view.dispatch({ effects: foldEffect.of(this.frontmatterRange) })
    }
  }

  replaceRange(insert, from, to = from) {
    if (this.destroyed || !this.view) return
    const editorInsert = typeof insert === "string" ? this.toEditorLineEndings(insert) : insert
    const end = caretAfterInsert(from, editorInsert)
    this.view.dispatch({
      changes: { from, to, insert: editorInsert },
      selection: { anchor: end },
      userEvent: "input"
    })
  }

  replaceRangeWithSelection(insert, from, to, selection) {
    if (this.destroyed || !this.view) return
    const editorInsert = typeof insert === "string" ? this.toEditorLineEndings(insert) : insert
    const { anchor, head } = offsetSelection(from, selection)
    this.view.dispatch({
      changes: { from, to, insert: editorInsert },
      selection: { anchor, head },
      userEvent: "input",
      scrollIntoView: true
    })
  }

  replaceRanges(changes) {
    if (this.destroyed || !this.view || !changes?.length) return
    const editorChanges = changes.map((change) => typeof change.insert === "string"
      ? { ...change, insert: this.toEditorLineEndings(change.insert) }
      : change)
    this.view.dispatch({ changes: editorChanges, userEvent: "input" })
  }

  attachSession(session) {
    this.session = session || null
  }

  detachSession(session) {
    if (!session || this.session === session) this.session = null
  }

  // Programmatic full-source commit through the bound session (P08-03).
  // Keystroke-equivalent ranged inserts stay on the adapter primitives
  // (replaceRange/replaceRanges) to preserve caret and undo granularity;
  // only whole-buffer replacements funnel here. Without a live session this
  // is the legacy direct replace; with one, stale races resolve to false
  // instead of writing. Caret defaults to the legacy end-of-document.
  commitSource(source, { caret } = {}) {
    const live = this.session && !this.session.disposed ? this.session : null
    if (!live) {
      this.replaceRange(source, 0, this.value.length)
      return Promise.resolve(true)
    }
    const caretOffset = caret === undefined ? caretAfterInsert(0, source) : caret
    return live.replaceText(source).then(
      () => {
        if (caretOffset !== null && !this.destroyed) this.setSelectionRange(caretOffset, caretOffset)
        return true
      },
      () => false
    )
  }

  trackMediaRange(range) {
    const id = ++this.nextMediaRangeId
    const from = Math.max(0, Math.min(range.from, this.view.state.doc.length))
    const to = Math.max(from, Math.min(range.to, this.view.state.doc.length))
    this.pendingMediaRanges.set(id, { from, to, collapsed: from === to })
    return id
  }

  consumeMediaRange(id) {
    const range = this.pendingMediaRanges.get(id)
    this.pendingMediaRanges.delete(id)
    return range ? { from: range.from, to: range.to } : null
  }

  releaseMediaRange(id) {
    this.pendingMediaRanges.delete(id)
  }

  handleUpdate(update) {
    this.reportLivePreviewState(update.state)
    if (update.selectionSet) {
      this.element.dispatchEvent(new Event("elef:editor-selection-change"))
    }
    if (update.docChanged) {
      this.mapPendingMediaRanges(update.changes)
      this.changedSinceFocusOut = true
      this.syncInput()
      this.refreshFrontmatterRange()
      this.syncFrontmatterVisibility()
      this.dispatchFieldEvent("input")
    }
    if (update.selectionSet || update.docChanged) this.updateMode()
    if (update.selectionSet || update.docChanged || update.viewportChanged) this.scheduleLineNumberUpdate()
    this.syncMetadataToggle()
  }

  mapPendingMediaRanges(changes) {
    // Replacing a value for an existing Map key is safe during iteration and keeps its insertion order.
    for (const [id, range] of this.pendingMediaRanges) {
      if (range.collapsed) {
        // Left bias keeps concurrent insertions at one offset anchored before inserted text.
        // Thus uploads started at the same cursor appear in reverse completion order.
        const position = changes.mapPos(range.from, -1)
        this.pendingMediaRanges.set(id, { from: position, to: position, collapsed: true })
        continue
      }

      const from = changes.mapPos(range.from, 1)
      const to = Math.max(from, changes.mapPos(range.to, -1))
      this.pendingMediaRanges.set(id, { from, to, collapsed: from === to })
    }
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
    const source = this.normalizeLineEndings(this.inputTarget.value)
    if (this.syncingInput || source === this.value) return

    const selection = {
      anchor: this.inputTarget.selectionStart ?? source.length,
      head: this.inputTarget.selectionEnd ?? source.length
    }
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: this.toEditorLineEndings(source) },
      selection
    })
  }

  loadDocument(source) {
    const document = createDocumentState(EditorState, source, this.documentExtensions)
    this.lineSeparator = document.lineSeparator
    this.view.setState(document.state)
    this.pendingMediaRanges.clear()
    this.inputTarget.value = source
    this.syncInput()
    this.view.dispatch({ effects: this.vimCompartment.reconfigure(this.vimEnabled ? vim() : []) })
    this.applyMapping()
    this.applyLineNumbers()
    this.applyCursorStyle()
    this.bindVimEvents()
    this.refreshFrontmatterRange()
    this.setEditingMode(this.editingMode || this.form?.dataset.editorMode || "visual", { silent: true })
    this.updateMode()
    this.syncMetadataToggle()
  }

  setExternalValue(value) {
    this.inputTarget.value = value
    this.handleExternalInputEvent()
  }

  syncInput() {
    const value = this.value
    this.syncingInput = true
    if (this.normalizeLineEndings(this.inputTarget.value) !== this.normalizeLineEndings(value)) this.inputTarget.value = value
    this.inputTarget.setSelectionRange(this.selectionStart, this.selectionEnd)
    this.syncingInput = false
  }

  readInitialSource() {
    try {
      const source = this.element.dataset.editorInitialSourceValue
      return source ? JSON.parse(source) : this.inputTarget.value
    } catch (_error) {
      return this.inputTarget.value
    }
  }

  normalizeLineEndings(value) {
    return normalizeLineEndings(value)
  }

  toEditorLineEndings(value) {
    const normalized = this.normalizeLineEndings(value)
    return this.lineSeparator === "\n" ? normalized : normalized.replace(/\n/g, this.lineSeparator)
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

    if (this.normalizeLineEndings(this.inputTarget.value) !== this.normalizeLineEndings(this.value)) this.handleExternalInputEvent()
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
    if (!this.vimEnabled) {
      if (this.hasModeTarget) {
        this.modeTarget.textContent = "Standard"
        this.modeTarget.dataset.mode = "standard"
      }
      if (this.hasCommandTarget) this.commandTarget.textContent = ""
      this.element.dataset.editorVimEnabled = "false"
      if (this.form) this.form.dataset.editorVimEnabled = "false"
      this.element.dataset.editorMode = "standard"
      this.applyCursorStyle()
      return
    }

    const mode = this.vimMode
    const label = mode.startsWith("visual") ? "Visual" : mode === "insert" ? "Insert" : "Normal"
    if (this.hasModeTarget) {
      this.modeTarget.textContent = label
      this.modeTarget.dataset.mode = label.toLowerCase()
    }
    this.element.dataset.editorVimEnabled = "true"
    if (this.form) this.form.dataset.editorVimEnabled = "true"
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
      activeEscapeKey = this.escapeKey === "<Esc>" ? "" : this.escapeKey
      if (activeEscapeKey && activeEscapeKey !== "<Esc>") {
        VIM_ESCAPE_MODES.forEach((mode) => Vim.map(activeEscapeKey, "<Esc>", mode))
      }
    } catch (_error) {
      // A browser without the optional Vim engine should still have a usable editor.
    }
  }

  collapseFrontmatter() {
    this.refreshFrontmatterRange()
    if (!this.frontmatterRange) return

    setTimeout(() => {
      if (this.destroyed || !this.frontmatterRange) return
      this.syncFrontmatterVisibility()
      this.syncMetadataToggle()
    }, 0)
  }

  syncFrontmatterVisibility() {
    if (!this.view || !this.frontmatterRange) return

    if (this.editingMode === "source" && this.frontmatterIsFolded()) {
      this.view.dispatch({
        effects: unfoldEffect.of(this.frontmatterRange),
        selection: { anchor: this.frontmatterRange.from },
        scrollIntoView: true
      })
    } else if (this.editingMode === "visual" && !this.frontmatterIsFolded()) {
      this.view.dispatch({ effects: foldEffect.of(this.frontmatterRange) })
    }
  }

  refreshFrontmatterRange() {
    this.frontmatterRange = frontmatterRangeFor(this.value)
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
    this.metadataToggleTarget.hidden = this.editingMode !== "source"
    this.metadataToggleTarget.disabled = !hasMetadata
    this.metadataToggleTarget.textContent = hasMetadata && !this.frontmatterIsFolded() ? "Hide source metadata" : "Reveal source metadata"
  }

  applyLineNumbers() {
    this.surfaceTarget.dataset.lineNumbers = this.lineNumberMode
    const gutter = this.view.dom.querySelector(".cm-lineNumbers")
    if (gutter) gutter.style.display = this.lineNumberMode === "off" ? "none" : ""
    this.scheduleLineNumberUpdate()
  }

  createLineNumbersExtension() {
    return lineNumbers({
      formatNumber: (number, state) => formatLineNumber(number, state, this.lineNumberMode)
    })
  }

  scheduleLineNumberUpdate() {
    if (this.destroyed || this.lineNumberMode === "off" || this.lineNumberFrame) return

    this.lineNumberFrame = requestAnimationFrame(() => {
      this.lineNumberFrame = null
      if (this.destroyed || this.lineNumberMode === "off") return

      const gutter = this.view.dom.querySelector(".cm-lineNumbers")
      if (!gutter) return

      this.view.dispatch({
        effects: this.lineNumbersCompartment.reconfigure(this.createLineNumbersExtension())
      })
    })
  }

  applyCursorStyle() {
    this.surfaceTarget.dataset.editorVimEnabled = String(this.vimEnabled)
    this.surfaceTarget.dataset.modeAwareCursor = String(this.modeAwareCursor)
    this.surfaceTarget.dataset.editorMode = this.element.dataset.editorMode || "standard"
  }
}

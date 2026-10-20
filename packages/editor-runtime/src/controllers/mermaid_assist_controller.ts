import { Controller } from "@hotwired/stimulus"
import { editorFor } from "../lib/editor_controller_lookup.js"
import { forwardEscapeToVim } from "../lib/vim_escape.js"
import { assistsInMode, mirrorPopupAccessibility, placePaletteBelow, placeVisualCaret, projectionHostFor, visualCaretRect } from "../lib/visual_assist.js"
import { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } from "./mermaid_syntax.js"
import type { DiagramTemplate, MermaidEdit } from "./mermaid_syntax.js"

export default class extends Controller<HTMLElement> {
  static targets = ["palette"]

  connect() {
    this.connected = true
    this.composing = false
    this.refreshScheduled = false
    this.editorController = editorFor(this.element)
    this.editorReady = () => {
      this.editorController = editorFor(this.element)
      this.setupEditor()
    }
    this.editorSelectionChange = () => this.scheduleRefresh()
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.element.addEventListener("elef:editor-selection-change", this.editorSelectionChange)
    // The shared Edit-actions menu inserts triggers programmatically, then
    // dispatches this so palettes re-refresh against the restored caret.
    this.assistTriggerInserted = () => this.refresh()
    this.element.addEventListener("elef:assist-trigger-inserted", this.assistTriggerInserted)
    this.positionPalette = this.positionPalette.bind(this)
    this.visualKeydown = (event: Event) => {
      if (this.editorController?.editingMode !== "visual") return
      // Structural Enter/Tab edits apply with the palette hidden; all other
      // keys route only while the palette is open.
      const key = (event as KeyboardEvent).key
      if (this.paletteTarget.hidden && key !== "Enter" && key !== "Tab") return
      this.keydown(event as KeyboardEvent)
    }
    this.visualScroll = () => {
      if (this.editorController?.editingMode === "visual") this.positionPalette()
    }
    window.addEventListener("resize", this.positionPalette)
    // Document capture precedes the form-level projection router
    // deterministically; idle visual keys never reach the palette.
    document.addEventListener("keydown", this.visualKeydown, true)
    window.addEventListener("scroll", this.visualScroll, { capture: true, passive: true })
    this.setupEditor()
  }

  disconnect() {
    this.connected = false
    this.composing = false
    window.removeEventListener("resize", this.positionPalette)
    document.removeEventListener("keydown", this.visualKeydown, true)
    window.removeEventListener("scroll", this.visualScroll, { capture: true })
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("elef:editor-selection-change", this.editorSelectionChange)
    this.element.removeEventListener("elef:assist-trigger-inserted", this.assistTriggerInserted)
    this.detachEditorListeners()
    this.close()
    this.editorController = null
  }

  setupEditor() {
    if (!this.connected) return

    const currentEditor = editorFor(this.element)
    if (currentEditor !== this.editorController) {
      this.detachEditorListeners()
      this.close()
      this.editorController = currentEditor
    }
    if (!this.editorAvailable()) return

    const editor = this.editorController
    const controls = new Set((editor.dom.getAttribute("aria-controls") || "").split(/\s+/).filter(Boolean))
    controls.add(this.paletteTarget.id)
    editor.dom.setAttribute("aria-controls", [...controls].join(" "))
    editor.dom.setAttribute("aria-autocomplete", "list")
    if (!this.scrollBound) {
      editor.scrollElement.addEventListener("scroll", this.positionPalette)
      this.scrollBound = true
    }
    if (!this.keydownBound) {
      this.handleEditorKeydown = (event: Event) => this.keydown(event as KeyboardEvent)
      editor.dom.addEventListener("keydown", this.handleEditorKeydown, true)
      this.keydownBound = true
    }
    if (!this.focusBound) {
      this.handleEditorFocusIn = () => this.scheduleRefresh()
      this.handleEditorFocusOut = () => this.close()
      this.handleCompositionStart = () => {
        this.composing = true
        this.close()
      }
      this.handleCompositionEnd = () => {
        this.composing = false
        this.scheduleRefresh()
      }
      editor.dom.addEventListener("focusin", this.handleEditorFocusIn)
      editor.dom.addEventListener("focusout", this.handleEditorFocusOut)
      editor.dom.addEventListener("compositionstart", this.handleCompositionStart)
      editor.dom.addEventListener("compositionend", this.handleCompositionEnd)
      this.focusBound = true
    }
    this.updateAccessibility()
  }

  detachEditorListeners() {
    const editor = this.editorController
    if (editor && this.scrollBound && editor.view) editor.view.scrollDOM.removeEventListener("scroll", this.positionPalette)
    if (editor && this.keydownBound && editor.view) editor.view.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
    if (editor && this.focusBound && editor.view) {
      editor.view.dom.removeEventListener("focusin", this.handleEditorFocusIn)
      editor.view.dom.removeEventListener("focusout", this.handleEditorFocusOut)
      editor.view.dom.removeEventListener("compositionstart", this.handleCompositionStart)
      editor.view.dom.removeEventListener("compositionend", this.handleCompositionEnd)
    }
    this.scrollBound = false
    this.keydownBound = false
    this.focusBound = false
  }

  editorAvailable() {
    return Boolean(this.editorController && !this.editorController.destroyed && this.editorController.view && !this.editorController.view.destroyed)
  }

  input(event: any) {
    if (this.composing || event?.isComposing) return
    this.scheduleRefresh()
  }

  scheduleRefresh() {
    if (this.refreshScheduled) return
    this.refreshScheduled = true
    queueMicrotask(() => {
      this.refreshScheduled = false
      this.refresh()
    })
  }

  keydown(event: KeyboardEvent) {
    if (event.defaultPrevented || this.composing || event.isComposing || event.keyCode === 229) return
    const editor = this.editorController
    if (!this.editorAvailable()) return this.close()
    if (this.otherPaletteOpen()) {
      if (!this.paletteTarget.hidden) this.close()
      return
    }
    if (!assistsInMode(editor) || editor.selectionStart !== editor.selectionEnd) return

    if (!this.paletteTarget.hidden) {
      if (!this.modelStillMatches()) {
        this.close()
        return
      }

      if (event.key === "ArrowDown") {
        event.preventDefault()
        event.stopPropagation()
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.matches.length - 1)
        this.renderPalette()
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        event.stopPropagation()
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        this.renderPalette()
      } else if (["Enter", "Tab"].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        this.acceptSelected()
      } else if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        this.close()
        forwardEscapeToVim(editor, event)
      } else {
        this.scheduleRefresh()
      }
      return
    }

    if (!editor.insertMode) return

    if (event.key === "Enter") {
      const edit = mermaidEnterEdit(editor.value, editor.selectionStart)
      if (edit) {
        event.preventDefault()
        event.stopPropagation()
        this.applyEdit(edit)
      }
    } else if (event.key === "Tab") {
      const edit = mermaidTabEdit(editor.value, editor.selectionStart, { shift: event.shiftKey })
      if (edit) {
        event.preventDefault()
        event.stopPropagation()
        this.applyEdit(edit)
      }
    }
  }

  refresh() {
    const editor = this.editorController
    // In visual mode the caret lives in the projection, so focus inside the
    // rendered surface authorizes the palette the way engine focus does.
    const focused = editor?.editingMode === "visual"
      ? this.element.closest("form")?.querySelector(".editor-projection")?.contains(document.activeElement)
      : editor?.dom.contains(document.activeElement)
    if (!this.connected || this.composing || !this.editorAvailable() || !focused || !assistsInMode(editor) || editor.selectionStart !== editor.selectionEnd || !editor.insertMode) return this.close()
    if (this.otherPaletteOpen()) return this.close()

    const source = editor.value
    const caret = editor.selectionStart
    const slashQuery = slashDiagramQuery(source, caret)
    let model = null
    if (slashQuery?.kind === "diagram-command") {
      model = {
        kind: slashQuery.kind,
        from: slashQuery.start,
        to: slashQuery.end,
        query: slashQuery.text,
        matches: [{ id: "diagram", label: "/diagram", detail: "Insert a Mermaid diagram" }]
      }
    } else if (slashQuery?.kind === "diagram-types") {
      model = {
        kind: slashQuery.kind,
        from: slashQuery.start,
        to: slashQuery.end,
        query: slashQuery.text,
        matches: MERMAID_DIAGRAMS
      }
    } else {
      model = mermaidCompletion(source, caret)
    }

    if (!model) return this.close()
    const key = `${model.kind}:${model.from}:${model.to}:${model.query}`
    if (key !== this.modelKey) this.selectedIndex = 0
    this.model = model
    this.modelKey = key
    this.matches = model.matches
    this.selectedIndex = Math.min(this.selectedIndex, this.matches.length - 1)
    this.renderPalette()
  }

  modelStillMatches() {
    const model = this.model
    if (!model) return false
    const editor = this.editorController
    if (!this.editorAvailable() || !assistsInMode(editor) || editor.selectionStart !== editor.selectionEnd) return false

    if (model.kind.startsWith("diagram-")) {
      const current = slashDiagramQuery(editor.value, editor.selectionStart)
      return Boolean(current && current.kind === model.kind && current.start === model.from && current.end === model.to && current.text === model.query)
    }

    const current = mermaidCompletion(editor.value, editor.selectionStart)
    return Boolean(current && current.kind === model.kind && current.from === model.from && current.to === model.to && current.query === model.query)
  }

  renderPalette() {
    this.paletteTarget.replaceChildren()
    this.matches.forEach((match: any, index: number) => {
      const option = document.createElement("button")
      option.type = "button"
      option.className = `snippet-option mermaid-assist-option${index === this.selectedIndex ? " is-selected" : ""}`
      option.id = `${this.paletteTarget.id}_option_${index}`
      option.setAttribute("role", "option")
      option.setAttribute("aria-selected", String(index === this.selectedIndex))
      option.addEventListener("mousedown", (event) => event.preventDefault())
      option.addEventListener("click", () => {
        this.selectedIndex = index
        this.acceptSelected()
      })

      const label = document.createElement("strong")
      label.textContent = match.label || match.name
      option.append(label)
      if (match.detail) {
        const detail = document.createElement("span")
        detail.textContent = match.detail
        option.append(detail)
      }
      this.paletteTarget.append(option)
    })

    this.paletteTarget.hidden = this.matches.length === 0
    this.updateAccessibility()
    if (!this.paletteTarget.hidden) this.positionPalette()
  }

  acceptSelected() {
    const editor = this.editorController
    const model = this.model
    const match = this.matches[this.selectedIndex]
    if (!this.editorAvailable() || !model || !match) return this.close()
    const visual = editor.editingMode === "visual"

    if (model.kind === "diagram-command") {
      editor.replaceRange("/diagram", model.from, model.to)
      if (visual) this.afterVisualCommit(model.from, model.to, "/diagram", model.from + "/diagram".length)
      this.close()
      this.scheduleRefresh()
      return
    }

    if (model.kind === "diagram-types") {
      const template = diagramTemplate(match.id)
      if (!template) return this.close()
      const insertion = diagramInsertion(editor.value, model.from, model.to, template)
      editor.replaceRangeWithSelection(insertion.text, insertion.from, insertion.to, insertion.selection)
      if (visual) this.afterVisualCommit(insertion.from, insertion.to, insertion.text, insertion.from + insertion.selection.to)
      this.close()
      return
    }

    editor.replaceRange(match.text, model.from, model.to)
    if (visual) this.afterVisualCommit(model.from, model.to, match.text, model.from + match.text.length)
    this.close()
  }

  // Visual insertion follow-up shared by palette accepts and structural
  // edits: shift the map, patch the caret text, and walk the native caret.
  afterVisualCommit(from: number, to: number, insert: string, caret: number) {
    projectionHostFor(this.element)?.applyVisualAssistInsert?.({ from, to, insert, caret })
    placeVisualCaret(this.element, caret)
  }

  applyEdit(edit: MermaidEdit) {
    if (!this.editorAvailable()) return this.close()
    const visual = this.editorController.editingMode === "visual"
    if (edit.moveTo !== undefined) {
      this.editorController.setSelectionRange(edit.moveTo)
      if (visual) placeVisualCaret(this.element, edit.moveTo)
    } else if (edit.insert !== undefined && edit.from !== undefined && edit.to !== undefined && edit.selection) {
      this.editorController.replaceRangeWithSelection(edit.insert, edit.from, edit.to, edit.selection)
      if (visual) this.afterVisualCommit(edit.from, edit.to, edit.insert, edit.from + edit.selection.to)
    }
    this.close()
  }

  close() {
    if (this.hasPaletteTarget) {
      this.paletteTarget.hidden = true
      this.paletteTarget.replaceChildren()
    }
    this.model = null
    this.modelKey = null
    this.matches = []
    this.selectedIndex = 0
    this.updateAccessibility()
  }

  otherPaletteOpen() {
    return this.hasPaletteTarget && [...this.element.querySelectorAll<HTMLElement>('[role="listbox"]')]
      .some((palette) => palette !== this.paletteTarget && !palette.hidden)
  }

  updateAccessibility() {
    const editor = this.editorController?.dom
    if (!editor) return

    const openPalette = [...this.element.querySelectorAll<HTMLElement>('[role="listbox"]')].find((palette) => !palette.hidden)
    editor.setAttribute("aria-expanded", String(Boolean(openPalette)))
    const selected = openPalette?.querySelector('[aria-selected="true"]')
    if (selected) editor.setAttribute("aria-activedescendant", selected.id)
    else editor.removeAttribute("aria-activedescendant")
    if (this.editorController?.editingMode !== "visual") return
    mirrorPopupAccessibility(this.element, { open: Boolean(openPalette), selectedId: selected?.id ?? null })
  }

  positionPalette() {
    if (!this.editorAvailable() || this.paletteTarget.hidden) return

    // The engine surface hides in visual mode: anchor to the native
    // projection caret instead of engine coordinates.
    if (this.editorController.editingMode === "visual") {
      const rect = visualCaretRect()
      if (!rect) return
      placePaletteBelow(this.paletteTarget, rect)
      return
    }

    const editorRect = this.editorController.dom.getBoundingClientRect()
    const markerRect = this.editorController.view.coordsAtPos(this.editorController.selectionStart) || editorRect
    const paletteRect = this.paletteTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(markerRect.left, window.innerWidth - paletteRect.width - 8))
    const maxTop = Math.min(editorRect.bottom - paletteRect.height - 4, window.innerHeight - paletteRect.height - 8)
    this.paletteTarget.style.left = `${left}px`
    this.paletteTarget.style.top = `${Math.max(8, Math.min(markerRect.bottom + 4, maxTop))}px`
  }
}

function diagramInsertion(source: string, queryFrom: number, queryTo: number, template: DiagramTemplate) {
  const lineFrom = source.lastIndexOf("\n", Math.max(0, queryFrom) - 1) + 1
  const lineTo = source.indexOf("\n", queryTo) === -1 ? source.length : source.indexOf("\n", queryTo)
  const before = source.slice(lineFrom, queryFrom)
  const after = source.slice(queryTo, lineTo)
  const replaceBefore = before.trim() === ""
  const replaceAfter = after.trim() === ""
  const prefix = replaceBefore ? "" : "\n"
  const suffix = replaceAfter ? "" : "\n"
  const from = replaceBefore ? lineFrom : queryFrom
  const to = replaceAfter ? lineTo : queryTo
  const text = `${prefix}${template.text}${suffix}`
  const selection = { from: prefix.length + template.selection.from, to: prefix.length + template.selection.to }
  return { text, from, to, selection }
}

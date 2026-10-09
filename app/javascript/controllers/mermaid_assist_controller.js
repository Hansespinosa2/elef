import { Controller } from "@hotwired/stimulus"
import { editorFor } from "lib/editor_controller_lookup"
import { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } from "controllers/mermaid_syntax"

export default class extends Controller {
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
    this.positionPalette = this.positionPalette.bind(this)
    window.addEventListener("resize", this.positionPalette)
    this.setupEditor()
  }

  disconnect() {
    this.connected = false
    this.composing = false
    window.removeEventListener("resize", this.positionPalette)
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("elef:editor-selection-change", this.editorSelectionChange)
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
      this.handleEditorKeydown = (event) => this.keydown(event)
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

  input(event) {
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

  keydown(event) {
    if (event.defaultPrevented || this.composing || event.isComposing || event.keyCode === 229) return
    const editor = this.editorController
    if (!this.editorAvailable()) return this.close()
    if (this.otherPaletteOpen()) {
      if (!this.paletteTarget.hidden) this.close()
      return
    }
    if (editor.editingMode !== "source" || editor.selectionStart !== editor.selectionEnd) return

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
    if (!this.connected || this.composing || !this.editorAvailable() || !editor.dom.contains(document.activeElement) || editor.editingMode !== "source" || editor.selectionStart !== editor.selectionEnd || !editor.insertMode) return this.close()
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
    if (!this.editorAvailable() || editor.editingMode !== "source" || editor.selectionStart !== editor.selectionEnd) return false

    if (model.kind.startsWith("diagram-")) {
      const current = slashDiagramQuery(editor.value, editor.selectionStart)
      return Boolean(current && current.kind === model.kind && current.start === model.from && current.end === model.to && current.text === model.query)
    }

    const current = mermaidCompletion(editor.value, editor.selectionStart)
    return Boolean(current && current.kind === model.kind && current.from === model.from && current.to === model.to && current.query === model.query)
  }

  renderPalette() {
    this.paletteTarget.replaceChildren()
    this.matches.forEach((match, index) => {
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

    if (model.kind === "diagram-command") {
      editor.replaceRange("/diagram", model.from, model.to)
      this.close()
      this.scheduleRefresh()
      return
    }

    if (model.kind === "diagram-types") {
      const template = diagramTemplate(match.id)
      if (!template) return this.close()
      const insertion = diagramInsertion(editor.value, model.from, model.to, template)
      editor.replaceRangeWithSelection(insertion.text, insertion.from, insertion.to, insertion.selection)
      this.close()
      return
    }

    editor.replaceRange(match.text, model.from, model.to)
    this.close()
  }

  applyEdit(edit) {
    if (!this.editorAvailable()) return this.close()
    if (edit.moveTo !== undefined) {
      this.editorController.setSelectionRange(edit.moveTo)
    } else {
      this.editorController.replaceRangeWithSelection(edit.insert, edit.from, edit.to, edit.selection)
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
    return this.hasPaletteTarget && [...this.element.querySelectorAll('[role="listbox"]')]
      .some((palette) => palette !== this.paletteTarget && !palette.hidden)
  }

  updateAccessibility() {
    const editor = this.editorController?.dom
    if (!editor) return

    const openPalette = [...this.element.querySelectorAll('[role="listbox"]')].find((palette) => !palette.hidden)
    editor.setAttribute("aria-expanded", String(Boolean(openPalette)))
    const selected = openPalette?.querySelector('[aria-selected="true"]')
    if (selected) editor.setAttribute("aria-activedescendant", selected.id)
    else editor.removeAttribute("aria-activedescendant")
  }

  positionPalette() {
    if (!this.editorAvailable() || this.paletteTarget.hidden) return

    const editorRect = this.editorController.dom.getBoundingClientRect()
    const markerRect = this.editorController.view.coordsAtPos(this.editorController.selectionStart) || editorRect
    const paletteRect = this.paletteTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(markerRect.left, window.innerWidth - paletteRect.width - 8))
    const maxTop = Math.min(editorRect.bottom - paletteRect.height - 4, window.innerHeight - paletteRect.height - 8)
    this.paletteTarget.style.left = `${left}px`
    this.paletteTarget.style.top = `${Math.max(8, Math.min(markerRect.bottom + 4, maxTop))}px`
  }
}

function diagramInsertion(source, queryFrom, queryTo, template) {
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

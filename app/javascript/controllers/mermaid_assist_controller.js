import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"
import { diagramTemplate, mermaidCompletion, mermaidEnterEdit, mermaidTabEdit, MERMAID_DIAGRAMS, slashDiagramQuery } from "controllers/mermaid_syntax"

export default class extends Controller {
  static targets = ["palette"]

  connect() {
    this.editorController = editorFor(this.element)
    this.editorReady = () => {
      this.editorController ||= editorFor(this.element)
      this.setupEditor()
    }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.positionPalette = this.positionPalette.bind(this)
    window.addEventListener("resize", this.positionPalette)
    this.setupEditor()
  }

  disconnect() {
    window.removeEventListener("resize", this.positionPalette)
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette)
    if (this.editorController && this.keydownBound) this.editorController.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
    this.close()
  }

  setupEditor() {
    if (!this.editorController) return

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
    this.updateAccessibility()
  }

  input() {
    queueMicrotask(() => this.refresh())
  }

  keydown(event) {
    if (event.defaultPrevented) return
    const editor = this.editorController
    if (editor?.editingMode !== "source" || !editor.insertMode || editor.selectionStart !== editor.selectionEnd) return

    if (!this.paletteTarget.hidden) {
      if (!this.modelStillMatches()) {
        this.close()
        return
      }

      if (event.key === "ArrowDown") {
        event.preventDefault()
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.matches.length - 1)
        this.renderPalette()
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        this.renderPalette()
      } else if (["Enter", "Tab"].includes(event.key)) {
        event.preventDefault()
        this.acceptSelected()
      } else if (event.key === "Escape") {
        event.preventDefault()
        this.close()
      } else {
        queueMicrotask(() => this.refresh())
      }
      return
    }

    if (event.key === "Enter") {
      const edit = mermaidEnterEdit(editor.value, editor.selectionStart)
      if (edit) {
        event.preventDefault()
        this.applyEdit(edit)
      }
    } else if (event.key === "Tab") {
      const edit = mermaidTabEdit(editor.value, editor.selectionStart, { shift: event.shiftKey })
      if (edit) {
        event.preventDefault()
        this.applyEdit(edit)
      }
    }
  }

  refresh() {
    const editor = this.editorController
    if (!editor || editor.editingMode !== "source" || editor.selectionStart !== editor.selectionEnd || !editor.insertMode) return this.close()

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
    if (!editor || editor.editingMode !== "source" || editor.selectionStart !== editor.selectionEnd) return false

    const current = model.kind.startsWith("diagram-") ? slashDiagramQuery(editor.value, editor.selectionStart) : mermaidCompletion(editor.value, editor.selectionStart)
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
    if (!editor || !model || !match) return this.close()

    if (model.kind === "diagram-command") {
      editor.replaceRange("/diagram", model.from, model.to)
      this.close()
      queueMicrotask(() => this.refresh())
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
    if (this.paletteTarget.hidden || !this.editorController) return

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

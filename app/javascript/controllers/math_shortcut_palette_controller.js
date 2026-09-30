import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"
import { application } from "controllers/application"
import { editorInsideMath, expandMathShorthand, mathShorthandAtEditor, parseMathShorthand } from "controllers/math_shorthand_controller"
import { authoringRegistryFor } from "controllers/authoring_registry"

export default class extends Controller {
  static targets = ["editor", "palette"]

  connect() {
    this.registry = authoringRegistryFor(this.element)
    this.matches = []
    this.selectedIndex = 0
    this.stops = []
    this.activeStop = null
    this.editorController = editorFor(this.element)
    this.editorReady = () => {
      this.editorController ||= editorFor(this.element)
      this.setupEditor()
    }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.positionPalette = this.positionPalette.bind(this)
    this.setupEditor()
    window.addEventListener("resize", this.positionPalette)
  }

  disconnect() {
    window.removeEventListener("resize", this.positionPalette)
    if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette)
    if (this.editorController && this.keydownBound) {
      this.editorController.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
    }
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
  }

  setupEditor() {
    if (this.editorController) this.setupAccessibility()
    if (this.editorController && !this.scrollBound) {
      this.editorController.scrollElement.addEventListener("scroll", this.positionPalette)
      this.scrollBound = true
    }
    if (this.editorController && !this.keydownBound) {
      this.handleEditorKeydown = (event) => this.keydown(event)
      this.editorController.dom.addEventListener("keydown", this.handleEditorKeydown, true)
      this.keydownBound = true
      this.schedule()
    }
  }

  setupAccessibility() {
    const editor = this.editorController?.dom
    if (!editor) return

    const controls = new Set((editor.getAttribute("aria-controls") || "").split(/\s+/).filter(Boolean))
    controls.add(this.paletteTarget.id)
    editor.setAttribute("aria-controls", [...controls].join(" "))
    editor.setAttribute("aria-autocomplete", "list")
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

  input() {
    this.adjustStops()
    this.schedule()
  }

  keydown(event) {
    if (event.defaultPrevented || event.elefMathShorthandHandled) return
    if (event.key === "Escape" && !this.paletteTarget.hidden) {
      event.preventDefault()
      this.close()
      return
    }
    const editor = this.editorController
    if (!editor || editor.editingMode !== "source" || !editor.insertMode) {
      this.close()
      return
    }

    if (!this.paletteTarget.hidden) {
      const currentQuery = this.queryAtCaret()
      if (!currentQuery || currentQuery.prefix !== this.query.prefix || currentQuery.text !== this.query.text || currentQuery.start !== this.query.start) {
        this.close()
        return
      }
    }

    if (event.key === "Tab" && this.paletteTarget.hidden && this.stops.length > 0) {
      event.preventDefault()
      this.nextStop()
      return
    }

    if (["ArrowDown", "ArrowUp"].includes(event.key) && !this.paletteTarget.hidden) {
      event.preventDefault()
      this.move(event.key === "ArrowDown" ? 1 : -1)
      return
    }
    if (["Enter", "Tab"].includes(event.key) && !this.paletteTarget.hidden) {
      if (this.validExactShorthandAtCaret() || this.validAppendedShorthandAtCaret()) return
      event.preventDefault()
      this.insertSelected()
      return
    }
    this.schedule()
  }

  schedule() {
    if (this.refreshScheduled) return
    this.refreshScheduled = true
    queueMicrotask(() => {
      this.refreshScheduled = false
      this.refresh()
    })
  }

  refresh() {
    const query = this.queryAtCaret()
    if (!query) return this.close()

    const singleCharacterAlias = query.prefix === "@" && query.text.length === 1
    const matches = this.registry
      .filter((shortcut) => shortcut.namespace === query.prefix)
      .filter((shortcut) => query.prefix !== "." || (shortcut.built_in && shortcut.behavior?.operator_class))
      .filter((shortcut) => !singleCharacterAlias || (shortcut.aliases || []).includes(query.text))
      .map((shortcut) => ({ shortcut, score: this.matchScore(shortcut, query.text) }))
      .filter(({ score }) => score !== null)
      .sort((left, right) => right.score - left.score || left.shortcut.name.localeCompare(right.shortcut.name))
      .slice(0, 6)
      .map(({ shortcut }) => shortcut)

    if (matches.length === 0) return this.close()
    this.query = query
    this.matches = matches
    this.selectedIndex = 0
    this.selectionMoved = false
    this.render()
  }

  queryAtCaret() {
    const editor = this.editorController
    if (!editor || editor.editingMode !== "source" || editor.selectionStart !== editor.selectionEnd) return null
    const caret = editor.selectionStart
    const line = editor.view.state.doc.lineAt(caret)
    const before = line.text.slice(0, caret - line.from)
    const match = before.match(/([.@])([A-Za-z0-9_-]*|=)$/)
    if (!match) return null
    if (!editorInsideMath(editor, caret)) return null

    const prefix = match[1]
    const separatorStart = match.index
    let baseStart = separatorStart
    const tokenCharacter = /[A-Za-z0-9.@\\{}()^-]/
    while (baseStart > 0 && tokenCharacter.test(before[baseStart - 1])) baseStart -= 1
    const candidateBase = before.slice(baseStart, separatorStart)
    if (prefix === "." && !this.validModifierBase(candidateBase)) return null

    return {
      prefix,
      text: match[2],
      start: line.from + (prefix === "." ? baseStart : separatorStart + 1),
      base: prefix === "." ? candidateBase : "",
      baseStart: line.from + baseStart
    }
  }

  validModifierBase(candidate) {
    if (!candidate) return false
    const parsed = parseMathShorthand(candidate)
    if (parsed) return parsed.status === "valid"
    return parseMathShorthand(`${candidate}.t`)?.status === "valid"
  }

  validExactShorthandAtCaret() {
    const editor = this.editorController
    if (!editor) return false

    const line = editor.view.state.doc.lineAt(editor.selectionStart)
    const before = line.text.slice(0, editor.selectionStart - line.from)
    const match = before.match(/([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)$/)
    return !this.selectionMoved && Boolean(match && parseMathShorthand(match[1]))
  }

  validAppendedShorthandAtCaret() {
    const editor = this.editorController
    if (!editor) return false

    const shorthand = application.getControllerForElementAndIdentifier(this.element, "math-shorthand")
    return Boolean(shorthand?.hasRecognizedAppendedModifiers(editor, editor.selectionStart) || mathShorthandAtEditor(editor, editor.selectionStart)?.status === "valid")
  }

  matchScore(shortcut, query) {
    if (!query) return 0

    const candidates = (shortcut.aliases || []).map((alias) => ({ value: String(alias), weight: 10000 }))
    candidates.push({ value: shortcut.name || "", weight: 7000 })
    if (query.length > 1) candidates.push({ value: shortcut.description || "", weight: 4000 })

    return candidates.reduce((best, candidate) => {
      const score = this.fieldScore(candidate.value, query, candidate.weight)
      return score === null ? best : Math.max(best, score)
    }, null)
  }

  fieldScore(value, query, weight) {
    if (!value) return null
    const foldedValue = value.toLowerCase()
    const foldedQuery = query.toLowerCase()
    if (value === query) return weight + 1000
    if (foldedValue === foldedQuery) return weight + 900
    if (value.startsWith(query)) return weight + 800 - value.length
    if (foldedValue.startsWith(foldedQuery)) return weight + 700 - value.length
    if (query.length < 2) return null

    const exactCaseIndex = value.indexOf(query)
    if (exactCaseIndex !== -1) return weight + 600 - exactCaseIndex
    const foldedIndex = foldedValue.indexOf(foldedQuery)
    if (foldedIndex !== -1) return weight + 500 - foldedIndex

    let previous = -1
    let gap = 0
    for (const character of foldedQuery) {
      const index = foldedValue.indexOf(character, previous + 1)
      if (index === -1) return null
      if (previous !== -1) gap += index - previous - 1
      previous = index
    }
    return weight + 300 - gap - previous / 100
  }

  render() {
    this.paletteTarget.replaceChildren()
    this.matches.forEach((shortcut, index) => {
      const option = document.createElement("button")
      option.type = "button"
      option.role = "option"
      option.className = `snippet-option math-shortcut-option${index === this.selectedIndex ? " is-selected" : ""}`
      option.id = `${this.paletteTarget.id}-option-${index}`
      option.dataset.shortcutId = shortcut.id
      option.setAttribute("aria-selected", String(index === this.selectedIndex))

      const trigger = document.createElement("code")
      trigger.className = "math-shortcut-trigger"
      trigger.textContent = this.triggerFor(shortcut, this.query)
      const name = document.createElement("strong")
      name.className = "math-shortcut-name"
      name.textContent = shortcut.name
      const latex = this.previewExpansion(shortcut, this.query)
      const expansion = document.createElement("code")
      expansion.className = "math-shortcut-expansion"
      expansion.textContent = latex

      option.setAttribute("aria-label", `${trigger.textContent} inserts ${latex}, ${shortcut.name}`)
      option.title = shortcut.description || shortcut.name
      option.append(trigger, name, expansion)
      option.addEventListener("mousedown", (event) => {
        event.preventDefault()
        this.selectedIndex = index
        this.insertSelected()
      })
      this.paletteTarget.append(option)
    })
    this.paletteTarget.hidden = false
    this.updateAccessibility()
    this.positionPalette()
  }

  triggerFor(shortcut, query) {
    const alias = this.aliasFor(shortcut, query)

    if (shortcut.prefix === "." && query.base) return `${query.base}.${alias}`
    return `${shortcut.prefix}${alias}`
  }

  aliasFor(shortcut, query) {
    return (shortcut.aliases || [])
      .map((candidate) => ({ candidate, score: this.fieldScore(candidate, query.text, 10000) ?? -1 }))
      .sort((left, right) => right.score - left.score)[0]?.candidate || ""
  }

  previewExpansion(shortcut, query) {
    if (shortcut.prefix === "." && query.base) {
      const alias = this.aliasFor(shortcut, query)
      const expansion = alias && expandMathShorthand(`${query.base}.${alias}`)
      if (expansion) return expansion
    }

    const source = shortcut.expansion || ""
    const examples = ["x", "y", "z"]
    return source.replace(/\$\{(\d+)(?::([^}]*))?\}/g, (_placeholder, number, defaultValue) => {
      const slot = Number(number)
      if (shortcut.prefix === "." && slot === 1 && query.base) return query.base
      return defaultValue || examples[slot - 1] || "x"
    })
  }

  positionPalette() {
    const editor = this.editorController
    if (!editor) return
    const editorRect = editor.dom.getBoundingClientRect()
    const marker = editor.view.coordsAtPos(editor.selectionStart) || editorRect
    const paletteRect = this.paletteTarget.getBoundingClientRect()
    this.paletteTarget.style.left = `${Math.max(8, Math.min(marker.left, window.innerWidth - paletteRect.width - 8))}px`
    const maxTop = window.innerHeight - paletteRect.height - 8
    const belowTop = marker.bottom + 4
    const aboveTop = marker.top - paletteRect.height - 4
    this.paletteTarget.style.top = `${belowTop <= maxTop ? belowTop : Math.max(8, Math.min(aboveTop, maxTop))}px`
  }

  move(amount) {
    this.selectionMoved = true
    this.selectedIndex = (this.selectedIndex + amount + this.matches.length) % this.matches.length
    this.paletteTarget.querySelectorAll("[role='option']").forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === this.selectedIndex))
      option.classList.toggle("is-selected", index === this.selectedIndex)
    })
    this.paletteTarget.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
    this.updateAccessibility()
  }

  insertSelected() {
    const shortcut = this.matches?.[this.selectedIndex]
    const query = this.query
    if (!shortcut || !query || !this.editorController) return this.close()

    if (shortcut.prefix === ".") {
      const canonical = { "default-bold": "b", "default-blackboard": "bb", "default-vector": "vec", "default-transpose": "t", "default-inverse": "inv" }
      const operation = canonical[shortcut.id] || shortcut.aliases?.[0]
      const source = query.base ? `${query.base}.${operation}` : `.${operation}`
      this.close()
      this.editorController.replaceRange(source, query.start, this.editorController.selectionStart)
      this.editorController.focus()
      return
    }

    const expansion = this.expandShortcut(shortcut, query)
    const base = query.start
    this.stops = expansion.stops.map((stop) => ({
      ...stop,
      start: base + stop.start,
      end: base + stop.start + stop.length
    }))
    this.activeStop = null
    this.close()
    this.editorController.replaceRange(expansion.text, query.start, this.editorController.selectionStart)
    this.editorController.focus()
    this.selectStop(this.stops[0])
  }

  expandShortcut(shortcut, query) {
    const stops = []
    const source = shortcut.expansion || ""
    const base = query.base || "x"
    let text = ""
    let cursor = 0
    const placeholder = /\$\{(\d+)(?::([^}]*))?\}/g
    let match

    while ((match = placeholder.exec(source))) {
      text += source.slice(cursor, match.index)
      const number = Number(match[1])
      const replacement = shortcut.prefix === "." && number === 1 ? base : (match[2] || "")
      if (!(shortcut.prefix === "." && number === 1)) {
        stops.push({ number, start: text.length, length: replacement.length })
      }
      text += replacement
      cursor = match.index + match[0].length
    }

    text += source.slice(cursor)
    return { text, stops: stops.sort((left, right) => left.number === 0 ? 1 : right.number === 0 ? -1 : left.number - right.number) }
  }

  nextStop() {
    const current = this.stops.shift()
    if (!current) return
    this.activeStop = null
    const next = this.stops[0]
    if (next) return this.selectStop(next)

    const editor = this.editorController
    if (!editor) return
    const exit = editor.value[current.end] === "}" ? current.end + 1 : current.end
    editor.setSelectionRange(exit, exit)
  }

  selectStop(stop) {
    const editor = this.editorController
    if (!editor || !stop) return
    this.activeStop = stop
    editor.setSelectionRange(stop.start, stop.end)
  }

  adjustStops() {
    const active = this.activeStop
    if (!active) return

    const editor = this.editorController
    if (!editor) return
    const delta = editor.selectionStart - active.end
    if (delta === 0) return
    active.end = editor.selectionStart
    const activeIndex = this.stops.indexOf(active)
    this.stops.slice(activeIndex + 1).forEach((stop) => {
      stop.start += delta
      stop.end += delta
    })
  }

  close() {
    this.paletteTarget.hidden = true
    this.matches = []
    this.query = null
    this.updateAccessibility()
  }
}

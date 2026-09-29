import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"
import { insideCode, insideMath } from "controllers/math_shorthand_controller"

export default class extends Controller {
  static targets = ["editor", "palette"]
  static values = { snippets: Array }

  connect() {
    this.matches = []
    this.selectedIndex = 0
    this.stops = []
    this.editorController = editorFor(this.element)
    this.editorReady = () => this.setupEditor()
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.positionPalette = this.positionPalette.bind(this)
    this.paletteTarget.setAttribute("aria-live", "polite")
    this.setupEditor()
    window.addEventListener("resize", this.positionPalette)
  }

  disconnect() {
    window.removeEventListener("resize", this.positionPalette)
    if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette)
    if (this.keydownBound) this.editorController?.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
  }

  setupEditor() {
    this.editorController ||= editorFor(this.element)
    if (this.editorController) this.setupAccessibility()
    if (this.editorController && !this.scrollBound) {
      this.editorController.scrollElement.addEventListener("scroll", this.positionPalette)
      this.scrollBound = true
    }
    if (this.editorController && !this.keydownBound) {
      this.handleEditorKeydown = (event) => this.keydown(event)
      this.editorController.dom.addEventListener("keydown", this.handleEditorKeydown, true)
      this.keydownBound = true
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
    if (this.ignoreNextInput) {
      this.ignoreNextInput = false
      return
    }
    this.adjustStops()
    this.refresh()
  }

  keydown(event) {
    if (event.defaultPrevented) return
    const editor = this.editorController
    if (!editor) return

    if (this.paletteTarget.hidden) {
      if (event.key === "Tab" && this.stops.length > 0) {
        event.preventDefault()
        this.nextStop()
      }
      return
    }

    const query = this.directiveQueryAtCaret() || this.queryAtCaret()
    if (!query || query.start !== this.queryStart || query.text !== this.query) {
      this.close()
      return
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()
      this.selectedIndex = Math.min(this.selectedIndex + 1, Math.min(this.matches.length, 5) - 1)
      this.renderPalette()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
      this.renderPalette()
    } else if (["Enter", "Tab"].includes(event.key)) {
      event.preventDefault()
      this.insertSelected()
    } else if (event.key === "Escape") {
      event.preventDefault()
      this.close()
    } else {
      queueMicrotask(() => this.refresh())
    }
  }

  refresh() {
    const editor = this.editorController
    if (!editor) return this.close()
    if (insideMath(editor.value, editor.selectionStart) || insideCode(editor.value, editor.selectionStart)) return this.close()
    const directiveQuery = this.directiveQueryAtCaret()
    if (directiveQuery) {
      this.query = directiveQuery.text
      this.queryPrefix = ":"
      this.queryStart = directiveQuery.start
      this.argumentQuery = directiveQuery
      this.matches = directiveQuery.choices
        .filter((value) => this.fieldScore(value, directiveQuery.text, 10000) !== null)
        .map((value) => ({ id: `directive-${value}`, trigger: value, name: value, category: "Elef argument", body: value }))
      this.selectedIndex = 0
      this.renderPalette()
      return
    }
    const query = this.queryAtCaret()
    if (!query) return this.close()

    this.argumentQuery = null
    this.query = query.text
    this.queryPrefix = query.prefix
    this.queryStart = query.start
    this.matches = this.snippetsValue
      .filter((snippet) => query.prefix === ":" ? snippet.category === "Elef DSL" : snippet.category !== "Elef DSL")
      .map((snippet) => ({ snippet, score: this.score(snippet) }))
      .filter((result) => result.score !== null)
      .sort((a, b) => b.score - a.score || a.snippet.trigger.localeCompare(b.snippet.trigger) || a.snippet.name.localeCompare(b.snippet.name))
      .map((result) => result.snippet)
    this.selectedIndex = 0
    this.renderPalette()
  }

  queryAtCaret() {
    const editor = this.editorController
    if (!editor || editor.selectionStart !== editor.selectionEnd) return null

    const beforeCaret = editor.value.slice(0, editor.selectionStart)
    const match = beforeCaret.match(/([/:])([a-z0-9-]*)$/i)
    if (!match) return null

    const triggerStart = match.index
    const previousCharacter = beforeCaret[triggerStart - 1]
    if (previousCharacter === ":" || previousCharacter === "/" || previousCharacter === "\\") return null

    return {
      prefix: match[1],
      text: match[2].toLowerCase(),
      start: editor.selectionStart - match[2].length - 1
    }
  }

  directiveQueryAtCaret() {
    const editor = this.editorController
    if (!editor || editor.selectionStart !== editor.selectionEnd) return null
    const caret = editor.selectionStart
    const before = editor.value.slice(0, caret)
    const match = before.match(/:::align\{([^}]*)$/)
    if (!match) return null
    const argumentText = match[1]
    const trailingSpace = /\s$/.test(argumentText)
    const completed = argumentText.trim().split(/\s+/).filter(Boolean)
    const position = trailingSpace ? completed.length : Math.max(completed.length - 1, 0)
    const text = trailingSpace ? "" : (completed.at(-1) || "")
    const choices = position === 0
      ? ["left", "center", "right", "top", "middle", "bottom"]
      : position === 1 && completed.length === 1
        ? ["top", "middle", "bottom"]
        : []
    if (!choices.length) return null
    return { prefix: ":", text, start: caret - text.length, choices }
  }

  supportsMathContext(snippet) {
    return snippet.category === "LaTeX" && !/^\s*\$/.test(snippet.body || "")
  }

  score(snippet) {
    const query = this.query
    const trigger = snippet.trigger.toLowerCase()
    const name = (snippet.name || "").toLowerCase()
    const description = (snippet.description || "").toLowerCase()
    const category = (snippet.category || "").toLowerCase()
    if (!this.query) return 0
    if (trigger === query) return 10000

    const triggerScore = this.fieldScore(trigger, query, 9000)
    if (triggerScore !== null) return triggerScore

    const nameScore = this.fieldScore(name, query, 8000)
    if (nameScore !== null) return nameScore

    const descriptionScore = this.fieldScore(description, query, 5000)
    const categoryScore = this.fieldScore(category, query, 4000)
    return [descriptionScore, categoryScore].filter((score) => score !== null).sort((a, b) => b - a)[0] ?? null
  }

  fieldScore(value, query, weight) {
    if (!query) return weight
    if (value === query) return weight + 1000
    if (value.startsWith(query)) return weight + 800 - value.length
    if (query.length < 2) return null
    const index = value.indexOf(query)
    if (index !== -1) return weight + 600 - index

    let previous = -1
    let gap = 0
    for (const character of query) {
      const index = value.indexOf(character, previous + 1)
      if (index === -1) return null
      if (previous !== -1) gap += index - previous - 1
      previous = index
    }
    return weight + 400 - gap - previous / 100
  }

  renderPalette() {
    this.paletteTarget.replaceChildren()
    this.matches.slice(0, 5).forEach((snippet, index) => {
      const option = document.createElement("button")
      option.type = "button"
      option.role = "option"
      option.id = `${this.paletteTarget.id}-option-${index}`
      option.setAttribute("aria-selected", String(index === this.selectedIndex))
      option.className = `snippet-option${index === this.selectedIndex ? " is-selected" : ""}`
      const trigger = document.createElement("strong")
      trigger.textContent = `${this.queryPrefix || "/"}${snippet.trigger}`
      const details = document.createElement("span")
      details.textContent = `${snippet.name} · ${snippet.category}`
      option.append(trigger, details)
      option.addEventListener("mousedown", (event) => {
        event.preventDefault()
        this.selectedIndex = index
        this.insertSelected()
      })
      this.paletteTarget.append(option)
    })
    this.paletteTarget.hidden = this.matches.length === 0
    this.updateAccessibility()
    if (!this.paletteTarget.hidden) this.positionPalette()
  }

  positionPalette() {
    if (this.paletteTarget.hidden) return

    const editor = this.editorController
    if (!editor) return
    const editorRect = editor.dom.getBoundingClientRect()
    const markerRect = editor.view.coordsAtPos(editor.selectionStart) || editorRect

    const paletteRect = this.paletteTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(markerRect.left, window.innerWidth - paletteRect.width - 8))
    const maxTop = window.innerHeight - paletteRect.height - 8
    const belowTop = markerRect.bottom + 4
    const aboveTop = markerRect.top - paletteRect.height - 4
    const top = belowTop <= maxTop ? belowTop : Math.max(8, Math.min(aboveTop, maxTop))
    this.paletteTarget.style.left = `${left}px`
    this.paletteTarget.style.top = `${top}px`
  }

  insertSelected() {
    const snippet = this.matches[this.selectedIndex]
    if (!snippet) return this.close()

    const editor = this.editorController
    if (!editor) return this.close()
    if (this.argumentQuery) {
      editor.replaceRange(snippet.trigger, this.queryStart, editor.selectionStart)
      this.close()
      editor.focus()
      return
    }
    const before = editor.value.slice(0, this.queryStart)
    const after = editor.value.slice(editor.selectionStart)
    const expansion = this.expand(snippet.body)
    const base = before.length
    this.stops = expansion.stops.map((stop) => ({
      ...stop,
      start: base + stop.start,
      end: base + stop.start + stop.length
    }))
    this.close()
    this.ignoreNextInput = true
    editor.replaceRange(expansion.text, this.queryStart, editor.selectionStart)
    editor.focus()
    this.selectStop(this.stops[0])
    queueMicrotask(() => this.refresh())
  }

  expand(body) {
    const stops = []
    const text = body.replace(/\$\{(\d+)(?::([^}]*))?\}/g, (_, number, value = "") => {
      const start = textLengthBefore(body, stops)
      stops.push({ number: Number(number), start, length: value.length })
      return value
    })
    return { text, stops: stops.sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number)) }
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
    if (!editor) return
    if (!stop) {
      this.activeStop = null
      editor.setSelectionRange(editor.selectionStart, editor.selectionStart)
      return
    }
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
    this.argumentQuery = null
    this.updateAccessibility()
  }
}

function textLengthBefore(body, stops) {
  const markers = [...body.matchAll(/\$\{\d+(?::[^}]*)?\}/g)]
  const marker = markers[stops.length]
  if (!marker) return body.length

  return marker.index - stops.reduce((position, stop, index) =>
    position + markers[index][0].length - stop.length, 0)
}

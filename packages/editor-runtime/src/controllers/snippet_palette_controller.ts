import { Controller } from "@hotwired/stimulus"
import { editorFor } from "../lib/editor_controller_lookup.js"
import { mirrorPopupAccessibility, placeVisualCaret, projectionHostFor, visualCaretRect } from "../lib/visual_assist.js"
import { editorInsideCode, editorInsideMath } from "./math_shorthand_controller.js"
import { authoringRegistryFor } from "./authoring_registry.js"
import { snippetStopsEffect } from "./snippet_stops.js"
import { expandSnippet } from "@elef/work-model/document-transforms"
import type { RegistryEntry } from "../lib/authoring_registry_merge.js"

export default class extends Controller<HTMLElement> {
  static targets = ["editor", "palette"]

  connect() {
    this.registry = authoringRegistryFor(this.element)
    this.matches = []
    this.selectedIndex = 0
    this.stops = []
    this.editorController = editorFor(this.element)
    this.editorReady = () => this.setupEditor()
    this.editorSelectionChange = () => this.scheduleStopPrune()
    this.editorModeChange = () => this.endStops()
    this.visualKeydown = (event: Event) => {
      if (this.editorController?.editingMode !== "visual") return
      if (this.paletteTarget.hidden && !this.stops.length) return
      this.keydown(event as KeyboardEvent)
    }
    this.visualScroll = () => {
      if (this.editorController?.editingMode === "visual") this.positionPalette()
    }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.element.addEventListener("elef:editor-selection-change", this.editorSelectionChange)
    this.editorForm = this.element.closest("form")
    this.editorForm?.addEventListener("elef:editor-mode-change", this.editorModeChange)
    this.positionPalette = this.positionPalette.bind(this)
    this.paletteTarget.setAttribute("aria-live", "polite")
    this.setupEditor()
    window.addEventListener("resize", this.positionPalette)
    // Document capture precedes the form-level projection router
    // deterministically, so open-palette keys never reach block handling;
    // with no palette or stops the handler returns before touching the event.
    document.addEventListener("keydown", this.visualKeydown, true)
    window.addEventListener("scroll", this.visualScroll, { capture: true, passive: true })
  }

  disconnect() {
    window.removeEventListener("resize", this.positionPalette)
    document.removeEventListener("keydown", this.visualKeydown, true)
    window.removeEventListener("scroll", this.visualScroll, { capture: true })
    if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette)
    if (this.keydownBound) this.editorController?.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("elef:editor-selection-change", this.editorSelectionChange)
    this.editorForm?.removeEventListener("elef:editor-mode-change", this.editorModeChange)
    this.endStops()
  }

  setupEditor() {
    const editor = editorFor(this.element)
    if (editor !== this.editorController) {
      if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette)
      if (this.keydownBound) this.editorController?.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
      this.editorController = editor
      this.scrollBound = false
      this.keydownBound = false
      this.endStops()
      this.close()
    }
    if (this.editorController) this.setupAccessibility()
    if (this.editorController && !this.scrollBound) {
      this.editorController.scrollElement.addEventListener("scroll", this.positionPalette)
      this.scrollBound = true
    }
    if (this.editorController && !this.keydownBound) {
      this.handleEditorKeydown = (event: Event) => this.keydown(event as KeyboardEvent)
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

    const openPalette = [...this.element.querySelectorAll<HTMLElement>('[role="listbox"]')].find((palette) => !palette.hidden)
    editor.setAttribute("aria-expanded", String(Boolean(openPalette)))
    const selected = openPalette?.querySelector('[aria-selected="true"]')
    if (selected) editor.setAttribute("aria-activedescendant", selected.id)
    else editor.removeAttribute("aria-activedescendant")
    // In visual mode the native caret lives in the projection block, so
    // mirror the popup state there for assistive technology.
    if (this.editorController?.editingMode !== "visual") return
    mirrorPopupAccessibility(this.element, { open: Boolean(openPalette), selectedId: selected?.id ?? null })
  }

  assistsInMode(editor: { editingMode?: string } | null | undefined): boolean {
    return !!editor && (editor.editingMode === "source" || editor.editingMode === "visual")
  }

  projectionHost() {
    return projectionHostFor(this.element)
  }

  input() {
    if (this.ignoreNextInput) {
      this.ignoreNextInput = false
      return
    }
    this.adjustStops()
    this.scheduleStopPrune()
    this.refresh()
  }

  scheduleStopPrune() {
    if (this.stopPruneScheduled) return
    this.stopPruneScheduled = true
    queueMicrotask(() => {
      this.stopPruneScheduled = false
      this.pruneStops()
    })
  }

  pruneStops() {
    if (!this.stops.length) return
    const editor = this.editorController
    if (!this.assistsInMode(editor) || editor?.destroyed) return this.endStops()
    const active = this.activeStop
    if (!active) return this.endStops()
    const from = editor.selectionStart
    const to = editor.selectionEnd
    if (from <= active.end && to >= active.start) return
    this.endStops()
  }

  keydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return
    const editor = this.editorController
    if (!this.assistsInMode(editor)) {
      this.close()
      if (this.stops.length) this.endStops()
      return
    }

    if (this.paletteTarget.hidden) {
      if (event.key === "Tab" && this.stops.length > 0) {
        event.preventDefault()
        this.nextStop()
      } else {
        if (event.key === "Escape" && this.stops.length > 0) this.endStops()
        this.scheduleStopPrune()
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
      if (this.stops.length) this.endStops()
    } else {
      queueMicrotask(() => this.refresh())
    }
  }

  refresh() {
    const editor = this.editorController
    if (!this.assistsInMode(editor)) return this.close()
    const directiveQuery = this.directiveQueryAtCaret()
    const query = directiveQuery || this.queryAtCaret()
    if (!query) return this.close()
    if (editorInsideMath(editor, editor.selectionStart) || editorInsideCode(editor, editor.selectionStart)) return this.close()

    if (directiveQuery) {
      this.query = directiveQuery.text
      this.queryPrefix = ":"
      this.queryStart = directiveQuery.start
      this.argumentQuery = directiveQuery
      this.matches = directiveQuery.choices
        .filter((value: string) => this.fieldScore(value, directiveQuery.text, 10000) !== null)
        .map((value) => ({ id: `directive-${value}`, trigger: value, name: value, category: "Elef argument", body: value }))
      this.selectedIndex = 0
      this.renderPalette()
      return
    }

    const mermaidCommand: RegistryEntry | undefined = this.registry.find((entry: RegistryEntry) =>
      entry.namespace === "/" && entry.trigger === "diagram" && entry.behavior?.type === "mermaid_assist"
    )
    if (query.prefix === "/" && query.text && mermaidCommand?.trigger.startsWith(query.text)) return this.close()

    if (query.prefix === ":") {
      const directive: RegistryEntry | undefined = this.registry.find((entry: RegistryEntry) => entry.namespace === ":" && (entry.trigger === query.text || (entry.aliases || []).includes(query.text)))
      if (directive) {
        this.query = query.text
        this.queryPrefix = ":"
        this.queryStart = query.start
        this.argumentQuery = null
        this.matches = [directive]
        this.selectedIndex = 0
        this.insertSelected()
        return
      }
    }

    this.argumentQuery = null
    this.query = query.text
    this.queryPrefix = query.prefix
    this.queryStart = query.start
    this.matches = this.registry
      .filter((entry: RegistryEntry) => entry.namespace === query.prefix)
      .filter((entry: RegistryEntry) => (entry.contexts || []).includes("source"))
      .filter((entry: RegistryEntry) => entry.behavior?.type === "insert")
      .map((snippet: RegistryEntry) => ({ snippet, score: this.score(snippet) }))
      .filter((result: { snippet: RegistryEntry; score: number | null }): result is { snippet: RegistryEntry; score: number } => result.score !== null)
      .sort((a: { snippet: RegistryEntry; score: number }, b: { snippet: RegistryEntry; score: number }) => b.score - a.score || a.snippet.trigger.localeCompare(b.snippet.trigger) || a.snippet.name.localeCompare(b.snippet.name))
      .map((result: { snippet: RegistryEntry; score: number }) => result.snippet)
    this.selectedIndex = 0
    this.renderPalette()
  }

  queryAtCaret(): { prefix: string; text: string; start: number } | null {
    const editor = this.editorController
    if (!editor || editor.selectionStart !== editor.selectionEnd) return null

    const line = editor.view.state.doc.lineAt(editor.selectionStart)
    const beforeCaret = line.text.slice(0, editor.selectionStart - line.from)
    const match = beforeCaret.match(/([/:])([a-z0-9-]*)$/i)
    if (!match) return null

    const triggerStart = match.index ?? 0
    const previousCharacter = beforeCaret[triggerStart - 1]
    if (previousCharacter === ":" || previousCharacter === "/" || previousCharacter === "\\") return null

    if ((match[1] ?? "") === ":") {
      // Colon directives are block-level own-line constructs, so a bare `:`
      // in prose is punctuation: only trigger on a blank line (whitespace
      // around the query is allowed for indented empty lines).
      const beforeTrigger = beforeCaret.slice(0, triggerStart)
      const afterCaret = line.text.slice(editor.selectionStart - line.from)
      if (!/^\s*$/.test(beforeTrigger) || !/^\s*$/.test(afterCaret)) return null
    }

    return {
      prefix: match[1] ?? "",
      text: (match[2] ?? "").toLowerCase(),
      start: line.from + triggerStart
    }
  }

  directiveQueryAtCaret(): { prefix: string; text: string; start: number; choices: string[] } | null {
    const editor = this.editorController
    if (!editor || editor.selectionStart !== editor.selectionEnd) return null
    const caret = editor.selectionStart
    const line = editor.view.state.doc.lineAt(caret)
    const before = line.text.slice(0, caret - line.from)
    const match = before.match(/:::align\{([^}]*)$/)
    if (!match) return null
    const argumentText = match[1] ?? ""
    const trailingSpace = /\s$/.test(argumentText)
    const completed = argumentText.trim().split(/\s+/).filter(Boolean)
    const position = trailingSpace ? completed.length : Math.max(completed.length - 1, 0)
    const text = trailingSpace ? "" : (completed.at(-1) || "")
    const directive = (this.registry as RegistryEntry[]).find((entry: RegistryEntry) => entry.namespace === ":" && entry.trigger === "align")
    const values = directive?.argument_schema?.values || []
    const previousValuesAreValid = completed.slice(0, position).every((value: string, index: number) => (values[index] as string[] | undefined)?.includes(value))
    const choices = previousValuesAreValid ? (values[position] || []) : []
    if (!choices.length) return null
    return { prefix: ":", text, start: caret - text.length, choices }
  }

  score(snippet: RegistryEntry): number | null {
    const query = this.query
    const trigger = snippet.trigger.toLowerCase()
    const name = (snippet.name || "").toLowerCase()
    const description = (snippet.description || "").toLowerCase()
    const category = (snippet.category || "").toLowerCase()
    if (!this.query) return 0
    if (trigger === query) return 10000

    const triggerScore = this.fieldScore(trigger, query, 9000)
    if (triggerScore !== null) return triggerScore

    const aliasScores = (snippet.aliases || [])
      .map((alias: any) => this.fieldScore(String(alias).toLowerCase(), query, 8500))
      .filter((score: number | null): score is number => score !== null)
    if (aliasScores.length) return Math.max(...aliasScores)

    const nameScore = this.fieldScore(name, query, 8000)
    if (nameScore !== null) return nameScore

    const descriptionScore = this.fieldScore(description, query, 5000)
    const categoryScore = this.fieldScore(category, query, 4000)
    return [descriptionScore, categoryScore].filter((score: number | null): score is number => score !== null).sort((a, b) => b - a)[0] ?? null
  }

  fieldScore(value: string, query: string, weight: number): number | null {
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
    this.matches.slice(0, 5).forEach((snippet: any, index: number) => {
      const option = document.createElement("button")
      option.type = "button"
      option.setAttribute("role", "option")
      option.id = `${this.paletteTarget.id}-option-${index}`
      option.setAttribute("aria-selected", String(index === this.selectedIndex))
      option.className = `snippet-option${index === this.selectedIndex ? " is-selected" : ""}`
      const trigger = document.createElement("strong")
      trigger.textContent = this.argumentQuery ? snippet.trigger : `${this.queryPrefix || "/"}${snippet.trigger}`
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
    // The engine surface hides in visual mode, so its coordinates are
    // meaningless there: anchor to the native projection caret instead.
    if (editor.editingMode === "visual") {
      const rect = visualCaretRect()
      if (!rect) return
      this.placePalette(rect)
      return
    }
    const editorRect = editor.dom.getBoundingClientRect()
    const markerRect = editor.view.coordsAtPos(editor.selectionStart) || editorRect
    this.placePalette(markerRect)
  }

  placePalette(markerRect: { left: number; bottom: number; top: number }) {
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
    const visual = editor.editingMode === "visual"
    const host = visual ? this.projectionHost() : null
    if (this.argumentQuery) {
      this.endStops()
      const queryEnd = editor.selectionStart
      editor.replaceRange(snippet.trigger, this.queryStart, queryEnd)
      if (visual) host?.applyVisualAssistInsert?.({ from: this.queryStart, to: queryEnd, insert: snippet.trigger, caret: this.queryStart + snippet.trigger.length })
      this.close()
      if (!visual) editor.focus()
      return
    }
    const before = editor.value.slice(0, this.queryStart)
    const expansion = expandSnippet(snippet.body)
    const base = before.length
    this.stops = expansion.stops.map((stop: any) => ({
      ...stop,
      start: base + stop.start,
      end: base + stop.start + stop.length
    }))
    this.close()
    this.ignoreNextInput = true
    const queryEnd = editor.selectionStart
    editor.replaceRange(expansion.text, this.queryStart, queryEnd)
    // Visual focus already sits in the patched block; the engine surface
    // stays hidden and the projection pipeline shifts the map, patches the
    // caret text, and stages caret restoration for the deferred reinstall.
    if (!visual) editor.focus()
    else host?.applyVisualAssistInsert?.({ from: this.queryStart, to: queryEnd, insert: expansion.text, caret: this.queryStart + expansion.text.length })
    this.selectStop(this.stops[0])
    queueMicrotask(() => this.refresh())
  }

  nextStop() {
    const current = this.stops.shift()
    if (!current) return
    this.activeStop = null
    const next = this.stops[0]
    if (next) return this.selectStop(next)

    const editor = this.editorController
    if (!editor) return this.endStops()
    const exit = editor.value[current.end] === "}" ? current.end + 1 : current.end
    editor.setSelectionRange(exit, exit)
    if (editor.editingMode === "visual") placeVisualCaret(this.element, exit)
    this.endStops()
  }

  endStops() {
    this.stops = []
    this.activeStop = null
    this.updateStopDecorations()
  }

  updateStopDecorations() {
    const editor = this.editorController
    if (!editor || !editor.view || editor.destroyed || editor.view.destroyed) return
    const length = editor.view.state.doc.length
    const stops = this.stops.map((stop: any, index: number) => ({
      from: Math.max(0, Math.min(stop.start, length)),
      to: Math.max(0, Math.min(stop.end, length)),
      active: index === 0
    }))
    editor.view.dispatch({ effects: snippetStopsEffect.of(stops) })
  }

  selectStop(stop: any) {
    const editor = this.editorController
    if (!editor) return
    const visual = editor.editingMode === "visual"
    if (!stop) {
      this.activeStop = null
      this.updateStopDecorations()
      editor.setSelectionRange(editor.selectionStart, editor.selectionStart)
      if (visual) placeVisualCaret(this.element, editor.selectionStart)
      return
    }
    this.activeStop = stop
    editor.setSelectionRange(stop.start, stop.end)
    // The projection shows a single caret: walk it to the stop start while
    // the engine holds the ranged stop selection.
    if (visual) placeVisualCaret(this.element, stop.start)
    this.updateStopDecorations()
  }

  adjustStops() {
    const active = this.activeStop
    if (!active) return

    const editor = this.editorController
    if (!editor) return
    const caret = editor.selectionStart
    if (caret < active.start) return this.endStops()
    const delta = caret - active.end
    if (delta === 0) return
    active.end = caret
    const activeIndex = this.stops.indexOf(active)
    this.stops.slice(activeIndex + 1).forEach((stop: any) => {
      stop.start += delta
      stop.end += delta
    })
    this.updateStopDecorations()
  }

  close() {
    this.paletteTarget.hidden = true
    this.matches = []
    this.argumentQuery = null
    this.updateAccessibility()
  }
}


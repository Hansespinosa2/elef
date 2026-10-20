import { Controller } from "@hotwired/stimulus"
import { editorFor } from "../lib/editor_controller_lookup.js"
import { forwardEscapeToVim } from "../lib/vim_escape.js"
import { assistsInMode, mirrorPopupAccessibility, placePaletteBelow, placeVisualCaret, projectionHostFor, visualCaretRect } from "../lib/visual_assist.js"
import { application } from "./application.js"
import { editorInsideMath, expandMathShorthand, innermostMathChainWindow, mathShorthandAtEditor, parseMathShorthand } from "./math_shorthand_controller.js"
import { authoringRegistryFor } from "./authoring_registry.js"
import type { RegistryEntry } from "../lib/authoring_registry_merge.js"
import type { MathShorthandKeyEvent } from "./math_shorthand_controller.js"
import { snippetStopsEffect } from "./snippet_stops.js"

export const MAX_PREVIEW_LENGTH = 48

export interface MathShortcutQuery {
  prefix: string;
  text: string;
  start: number;
  base: string;
  baseStart: number;
}

export default class extends Controller<HTMLElement> {
  static targets = ["editor", "palette"]

  connect() {
    this.registry = authoringRegistryFor(this.element)
    this.matches = []
    this.selectedIndex = 0
    this.stops = []
    this.activeStop = null
    this.editorController = editorFor(this.element)
    this.editorReady = () => this.setupEditor()
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.editorSelectionChange = () => this.scheduleStopPrune()
    this.editorModeChange = () => this.endStops()
    this.element.addEventListener("elef:editor-selection-change", this.editorSelectionChange)
    // The shared Edit-actions menu inserts triggers programmatically, then
    // dispatches this so palettes re-refresh against the restored caret.
    this.assistTriggerInserted = () => this.refresh()
    this.element.addEventListener("elef:assist-trigger-inserted", this.assistTriggerInserted)
    this.editorForm = this.element.closest("form")
    this.editorForm?.addEventListener("elef:editor-mode-change", this.editorModeChange)
    this.positionPalette = this.positionPalette.bind(this)
    this.visualKeydown = (event: Event) => {
      if (this.editorController?.editingMode !== "visual") return
      if (this.paletteTarget.hidden && !this.stops.length) return
      this.keydown(event as KeyboardEvent)
    }
    this.visualScroll = () => {
      if (this.editorController?.editingMode === "visual") this.positionPalette()
    }
    this.setupEditor()
    window.addEventListener("resize", this.positionPalette)
    // Document capture precedes the form-level projection router
    // deterministically; idle visual keys never reach the palette.
    document.addEventListener("keydown", this.visualKeydown, true)
    window.addEventListener("scroll", this.visualScroll, { capture: true, passive: true })
  }

  disconnect() {
    window.removeEventListener("resize", this.positionPalette)
    document.removeEventListener("keydown", this.visualKeydown, true)
    window.removeEventListener("scroll", this.visualScroll, { capture: true })
    if (this.scrollBound) this.editorController?.scrollElement.removeEventListener("scroll", this.positionPalette)
    if (this.editorController && this.keydownBound) {
      this.editorController.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
    }
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("elef:editor-selection-change", this.editorSelectionChange)
    this.element.removeEventListener("elef:assist-trigger-inserted", this.assistTriggerInserted)
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

    const openPalette = [...this.element.querySelectorAll<HTMLElement>('[role="listbox"]')].find((palette) => !palette.hidden)
    editor.setAttribute("aria-expanded", String(Boolean(openPalette)))
    const selected = openPalette?.querySelector('[aria-selected="true"]')
    if (selected) editor.setAttribute("aria-activedescendant", selected.id)
    else editor.removeAttribute("aria-activedescendant")
    if (this.editorController?.editingMode !== "visual") return
    mirrorPopupAccessibility(this.element, { open: Boolean(openPalette), selectedId: selected?.id ?? null })
  }

  input() {
    this.adjustStops()
    this.scheduleStopPrune()
    this.schedule()
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
    if (!assistsInMode(editor) || editor?.destroyed) return this.endStops()
    const active = this.activeStop
    if (!active) return this.endStops()
    const from = editor.selectionStart
    const to = editor.selectionEnd
    if (from <= active.end && to >= active.start) return
    this.endStops()
  }

  keydown(event: MathShorthandKeyEvent) {
    if (event.defaultPrevented || event.elefMathShorthandHandled) return
    if (event.key === "Escape" && !this.paletteTarget.hidden) {
      event.preventDefault()
      this.close()
      if (this.stops.length) this.endStops()
      forwardEscapeToVim(this.editorController, event)
      return
    }
    const editor = this.editorController
    if (!assistsInMode(editor) || !editor?.insertMode) {
      this.close()
      if (this.stops.length) this.endStops()
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

    if (this.paletteTarget.hidden) {
      if (event.key === "Escape" && this.stops.length > 0) this.endStops()
      this.scheduleStopPrune()
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

    const matches = this.registry
      .filter((shortcut: RegistryEntry) => shortcut.namespace === query.prefix)
      .filter((shortcut: RegistryEntry) => query.prefix !== "." || (shortcut.built_in && shortcut.behavior?.operator_class))
      .map((shortcut: RegistryEntry) => ({ shortcut, score: this.matchScore(shortcut, query.text) }))
      .filter((result: { shortcut: RegistryEntry; score: number | null }): result is { shortcut: RegistryEntry; score: number } => result.score !== null)
      .sort((left: { shortcut: RegistryEntry; score: number }, right: { shortcut: RegistryEntry; score: number }) => right.score - left.score || left.shortcut.name.localeCompare(right.shortcut.name))
      .slice(0, 6)
      .map(({ shortcut }: { shortcut: RegistryEntry; score: number }) => shortcut)

    if (matches.length === 0) return this.close()
    this.query = query
    this.matches = matches
    this.selectedIndex = 0
    this.selectionMoved = false
    this.render()
  }

  queryAtCaret(): MathShortcutQuery | null {
    const editor = this.editorController
    if (!assistsInMode(editor) || editor.selectionStart !== editor.selectionEnd) return null
    const caret = editor.selectionStart
    const line = editor.view.state.doc.lineAt(caret)
    const before = line.text.slice(0, caret - line.from)
    const match = before.match(/([.@])([A-Za-z0-9_-]*|=)$/)
    if (!match) return null
    if (!editorInsideMath(editor, caret)) return null

    const prefix = match[1] ?? ""
    const separatorStart = match.index ?? 0
    let baseStart = separatorStart
    const tokenCharacter = /[A-Za-z0-9.@\\{}()^-]/
    while (baseStart > 0 && tokenCharacter.test(before[baseStart - 1] ?? "")) baseStart -= 1
    if (prefix === ".") {
      const window = innermostMathChainWindow(before, separatorStart, 0, separatorStart)
      if (window && window.start > baseStart) baseStart = window.start
    }
    const candidateBase = before.slice(baseStart, separatorStart)
    if (prefix === "." && !this.validModifierBase(candidateBase)) return null

    return {
      prefix,
      text: match[2] ?? "",
      start: line.from + (prefix === "." ? baseStart : separatorStart),
      base: prefix === "." ? candidateBase : "",
      baseStart: line.from + baseStart
    }
  }

  validModifierBase(candidate: string): boolean {
    if (!candidate) return false
    const parsed = parseMathShorthand(candidate)
    if (parsed) return parsed.status === "valid"
    return parseMathShorthand(`${candidate}.t`)?.status === "valid"
  }

  validExactShorthandAtCaret(): boolean {
    const editor = this.editorController
    if (!editor) return false

    const line = editor.view.state.doc.lineAt(editor.selectionStart)
    const before = line.text.slice(0, editor.selectionStart - line.from)
    const match = before.match(/([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)$/)
    return !this.selectionMoved && Boolean(match && parseMathShorthand(match[1] ?? ""))
  }

  validAppendedShorthandAtCaret(): boolean {
    const editor = this.editorController
    if (!editor) return false

    const shorthand = application.getControllerForElementAndIdentifier(this.element, "math-shorthand")
    return Boolean(shorthand?.hasRecognizedAppendedModifiers(editor, editor.selectionStart) || mathShorthandAtEditor(editor, editor.selectionStart)?.status === "valid")
  }

  matchScore(shortcut: RegistryEntry, query: string): number | null {
    if (!query) return 0

    const candidates = (shortcut.aliases || []).map((alias: any) => ({ value: String(alias), weight: 10000 }))
    candidates.push({ value: shortcut.name || "", weight: 7000 })
    candidates.push({ value: shortcut.description || "", weight: 4000 })

    return candidates.reduce((best: number | null, candidate: { value: string; weight: number }) => {
      const score = this.fieldScore(candidate.value, query, candidate.weight)
      return score === null ? best : Math.max(best ?? 0, score)
    }, null)
  }

  fieldScore(value: string, query: string, weight: number): number | null {
    if (!value) return null
    const foldedValue = value.toLowerCase()
    const foldedQuery = query.toLowerCase()
    if (value === query) return weight + 1000
    if (foldedValue === foldedQuery) return weight + 900
    if (value.startsWith(query)) return weight + 800 - value.length
    if (foldedValue.startsWith(foldedQuery)) return weight + 700 - value.length

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
    this.matches.forEach((shortcut: any, index: number) => {
      const option = document.createElement("button")
      option.type = "button"
      option.setAttribute("role", "option")
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
      const latex = this.expansionPreview(shortcut, this.query)
      const expansion = document.createElement("code")
      expansion.className = "math-shortcut-expansion"
      expansion.textContent = latex.text

      option.setAttribute("aria-label", `${trigger.textContent} inserts ${latex.full}, ${shortcut.name}`)
      option.title = `${shortcut.description || shortcut.name}: ${latex.full}`
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

  triggerFor(shortcut: any, query: MathShortcutQuery): string {
    const alias = this.aliasFor(shortcut, query)

    if (shortcut.prefix === "." && query.base) return `${query.base}.${alias}`
    return `${shortcut.prefix}${alias}`
  }

  aliasFor(shortcut: any, query: MathShortcutQuery): string {
    return (shortcut.aliases || [])
      .map((candidate: any) => ({ candidate, score: this.fieldScore(candidate, query.text, 10000) ?? -1 }))
      .sort((left: { candidate: string; score: number }, right: { candidate: string; score: number }) => right.score - left.score)[0]?.candidate || ""
  }

  expansionPreview(shortcut: any, query: MathShortcutQuery): { text: string; full: string } {
    const full = this.previewExpansion(shortcut, query)
    return { text: shortenExpansion(full), full }
  }

  previewExpansion(shortcut: any, query: MathShortcutQuery): string {
    if (shortcut.prefix === "." && query.base) {
      const alias = this.aliasFor(shortcut, query)
      const expansion = alias && expandMathShorthand(`${query.base}.${alias}`)
      if (expansion) return expansion
    }

    const source = shortcut.expansion || ""
    const examples = ["x", "y", "z"]
    return source.replace(/\$\{(\d+)(?::([^}]*))?\}/g, (_placeholder: string, number: string, defaultValue: string) => {
      const slot = Number(number)
      if (shortcut.prefix === "." && slot === 1 && query.base) return query.base
      return defaultValue || examples[slot - 1] || "x"
    })
  }

  positionPalette() {
    const editor = this.editorController
    if (!editor) return
    // The engine surface hides in visual mode: anchor to the native
    // projection caret instead of engine coordinates.
    if (editor.editingMode === "visual") {
      const rect = visualCaretRect()
      if (!rect) return
      placePaletteBelow(this.paletteTarget, rect)
      return
    }
    const editorRect = editor.dom.getBoundingClientRect()
    const marker = editor.view.coordsAtPos(editor.selectionStart) || editorRect
    placePaletteBelow(this.paletteTarget, marker)
  }

  move(amount: number): void {
    this.selectionMoved = true
    this.selectedIndex = (this.selectedIndex + amount + this.matches.length) % this.matches.length
    this.paletteTarget.querySelectorAll("[role='option']").forEach((option: any, index: number) => {
      option.setAttribute("aria-selected", String(index === this.selectedIndex))
      option.classList.toggle("is-selected", index === this.selectedIndex)
    })
    this.paletteTarget.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
    this.updateAccessibility()
  }

  insertSelected() {
    this.endStops()
    const shortcut = this.matches?.[this.selectedIndex]
    const query = this.query
    if (!shortcut || !query || !this.editorController) return this.close()
    const visual = this.editorController.editingMode === "visual"

    if (shortcut.prefix === ".") {
      const canonical = { "default-bold": "b", "default-blackboard": "bb", "default-vector": "vec", "default-transpose": "t", "default-inverse": "inv" }
      const operation = (canonical as Record<string, string>)[shortcut.id] || shortcut.aliases?.[0]
      const source = query.base ? `${query.base}.${operation}` : `.${operation}`
      const queryEnd = this.editorController.selectionStart
      this.close()
      this.editorController.replaceRange(source, query.start, queryEnd)
      if (visual) {
        projectionHostFor(this.element)?.applyVisualAssistInsert?.({ from: query.start, to: queryEnd, insert: source, caret: query.start + source.length })
        placeVisualCaret(this.element, query.start + source.length)
      } else {
        this.editorController.focus()
      }
      return
    }

    const expansion = this.expandShortcut(shortcut, query)
    const base = query.start
    this.stops = expansion.stops.map((stop: { number: number; start: number; length: number }) => ({
      ...stop,
      start: base + stop.start,
      end: base + stop.start + stop.length
    }))
    this.activeStop = null
    const queryEnd = this.editorController.selectionStart
    this.close()
    this.editorController.replaceRange(expansion.text, query.start, queryEnd)
    if (visual) {
      projectionHostFor(this.element)?.applyVisualAssistInsert?.({ from: query.start, to: queryEnd, insert: expansion.text, caret: query.start + expansion.text.length })
    } else {
      this.editorController.focus()
    }
    this.selectStop(this.stops[0])
  }

  expandShortcut(shortcut: any, query: MathShortcutQuery): { text: string; stops: Array<{ number: number; start: number; length: number }> } {
    const stops: Array<{ number: number; start: number; length: number }> = []
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
      cursor = (match.index ?? 0) + (match[0] ?? "").length
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
    if (editor && !editor.destroyed) {
      const exit = editor.value[current.end] === "}" ? current.end + 1 : current.end
      editor.setSelectionRange(exit, exit)
      if (editor.editingMode === "visual") placeVisualCaret(this.element, exit)
    }
    this.endStops()
  }

  selectStop(stop: any) {
    const editor = this.editorController
    if (!editor) return
    if (!stop) {
      if (editor.editingMode === "visual") placeVisualCaret(this.element, editor.selectionStart)
      return
    }
    this.activeStop = stop
    editor.setSelectionRange(stop.start, stop.end)
    // The projection shows a single caret: walk it to the stop start while
    // the engine holds the ranged stop selection.
    if (editor.editingMode === "visual") placeVisualCaret(this.element, stop.start)
    this.updateStopDecorations()
  }

  adjustStops() {
    const active = this.activeStop
    if (!active) return

    const editor = this.editorController
    if (!editor || editor.destroyed) return this.endStops()
    if (editor.selectionStart < active.start) return this.endStops()
    const delta = editor.selectionStart - active.end
    if (delta === 0) return
    active.end = editor.selectionStart
    const activeIndex = this.stops.indexOf(active)
    this.stops.slice(activeIndex + 1).forEach((stop: any) => {
      stop.start += delta
      stop.end += delta
    })
    this.updateStopDecorations()
  }

  endStops() {
    this.stops = []
    this.activeStop = null
    this.updateStopDecorations()
  }

  updateStopDecorations() {
    const editor = this.editorController
    const view = editor?.view
    if (!editor || editor.destroyed || !view || view.destroyed) return

    const length = view.state.doc.length
    const decorations = this.stops.map((stop: any, index: number) => ({
      from: Math.max(0, Math.min(stop.start, length)),
      to: Math.max(0, Math.min(stop.end, length)),
      active: index === 0
    }))
    view.dispatch({ effects: snippetStopsEffect.of(decorations) })
  }

  close() {
    this.paletteTarget.hidden = true
    this.matches = []
    this.query = null
    this.updateAccessibility()
  }
}

function shortenExpansion(expansion: string): string {
  if (expansion.length <= MAX_PREVIEW_LENGTH) return expansion

  const kept = MAX_PREVIEW_LENGTH - 1
  const head = Math.ceil(kept / 2)
  const tail = kept - head
  return `${expansion.slice(0, head)}…${expansion.slice(expansion.length - tail)}`
}

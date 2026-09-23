import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"
import { expandMathShorthand, insideMath } from "controllers/math_shorthand_controller"

export default class extends Controller {
  static targets = ["editor", "palette"]
  static values = { shortcuts: Array }

  connect() {
    this.editorController = editorFor(this.element)
    this.editorReady = () => {
      this.editorController ||= editorFor(this.element)
      this.setupEditor()
    }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.setupEditor()
  }

  disconnect() {
    if (this.editorController && this.keydownBound) {
      this.editorController.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
    }
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
  }

  setupEditor() {
    if (this.editorController && !this.keydownBound) {
      this.handleEditorKeydown = (event) => this.keydown(event)
      this.editorController.dom.addEventListener("keydown", this.handleEditorKeydown, true)
      this.keydownBound = true
      this.schedule()
    }
  }

  input() {
    this.schedule()
  }

  keydown(event) {
    if (event.key === "Escape" && !this.paletteTarget.hidden) {
      event.preventDefault()
      this.close()
      return
    }
    if (!this.editorController?.insertMode) return

    if (["ArrowDown", "ArrowUp"].includes(event.key) && !this.paletteTarget.hidden) {
      event.preventDefault()
      this.move(event.key === "ArrowDown" ? 1 : -1)
      return
    }
    if (["Enter", "Tab"].includes(event.key) && !this.paletteTarget.hidden) {
      if (this.validExactShorthandAtCaret()) return
      event.preventDefault()
      this.insertSelected()
      return
    }
    queueMicrotask(() => this.refresh())
  }

  schedule() {
    queueMicrotask(() => this.refresh())
  }

  refresh() {
    const query = this.queryAtCaret()
    if (!query) return this.close()

    const matches = this.shortcutsValue
      .filter((shortcut) => shortcut.prefix === query.prefix)
      .map((shortcut) => ({ shortcut, score: this.fuzzyScore(shortcut, query.text) }))
      .filter(({ score }) => score >= 0)
      .sort((left, right) => right.score - left.score || left.shortcut.name.localeCompare(right.shortcut.name))
      .slice(0, 8)
      .map(({ shortcut }) => shortcut)

    if (matches.length === 0) return this.close()
    this.query = query
    this.matches = matches
    this.selectedIndex = Math.min(this.selectedIndex || 0, matches.length - 1)
    this.selectionMoved = false
    this.render()
  }

  queryAtCaret() {
    const editor = this.editorController
    if (!editor || editor.selectionStart !== editor.selectionEnd) return null
    const caret = editor.selectionStart
    if (!insideMath(editor.value, caret)) return null
    const before = editor.value.slice(0, caret)
    const match = before.match(/([A-Za-z][A-Za-z0-9]*)?([.@])([A-Za-z0-9_-]*)$/)
    if (!match) return null

    return {
      prefix: match[2],
      text: match[3],
      start: match.index + (match[1]?.length || 0),
      base: match[1] || "",
      baseStart: match.index
    }
  }

  validExactShorthandAtCaret() {
    const editor = this.editorController
    if (!editor) return false

    const before = editor.value.slice(0, editor.selectionStart)
    const match = before.match(/([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)$/)
    return !this.selectionMoved && Boolean(match && expandMathShorthand(match[1]))
  }

  fuzzyScore(shortcut, query) {
    const candidates = [shortcut.name, ...(shortcut.aliases || [])].map((value) => value.toLowerCase())
    const needle = query.toLowerCase()
    if (!needle) return 1
    let best = -1
    candidates.forEach((candidate) => {
      if (candidate === needle) best = Math.max(best, 100)
      else if (candidate.startsWith(needle)) best = Math.max(best, 80 - candidate.length)
      else if (candidate.includes(needle)) best = Math.max(best, 50 - candidate.indexOf(needle))
      else {
        let index = 0
        for (const character of needle) {
          index = candidate.indexOf(character, index)
          if (index < 0) break
          index += 1
        }
        if (index > 0) best = Math.max(best, 20 - index)
      }
    })
    return best
  }

  render() {
    this.paletteTarget.replaceChildren()
    this.matches.forEach((shortcut, index) => {
      const option = document.createElement("button")
      option.type = "button"
      option.role = "option"
      option.className = "snippet-option"
      option.setAttribute("aria-selected", String(index === this.selectedIndex))
      const title = document.createElement("strong")
      title.textContent = `${shortcut.prefix}${shortcut.aliases[0]}`
      const details = document.createElement("span")
      details.textContent = `${shortcut.name} · ${shortcut.description || "Math shortcut"}`
      option.append(title, details)
      option.addEventListener("mousedown", (event) => {
        event.preventDefault()
        this.selectedIndex = index
        this.insertSelected()
      })
      this.paletteTarget.append(option)
    })
    this.paletteTarget.hidden = false
    this.positionPalette()
  }

  positionPalette() {
    const editor = this.editorController
    if (!editor) return
    const editorRect = editor.dom.getBoundingClientRect()
    const marker = editor.view.coordsAtPos(editor.selectionStart) || editorRect
    const paletteRect = this.paletteTarget.getBoundingClientRect()
    this.paletteTarget.style.left = `${Math.max(8, Math.min(marker.left, window.innerWidth - paletteRect.width - 8))}px`
    this.paletteTarget.style.top = `${Math.max(8, Math.min(marker.bottom + 4, window.innerHeight - paletteRect.height - 8))}px`
  }

  move(amount) {
    this.selectionMoved = true
    this.selectedIndex = (this.selectedIndex + amount + this.matches.length) % this.matches.length
    this.paletteTarget.querySelectorAll("[role='option']").forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === this.selectedIndex))
    })
  }

  insertSelected() {
    const shortcut = this.matches?.[this.selectedIndex]
    const query = this.query
    if (!shortcut || !query || !this.editorController) return this.close()

    let expansion = shortcut.expansion
    if (shortcut.prefix === ".") {
      expansion = expansion.replace(/\$\{1(?::[^}]*)?\}/g, query.base || "x")
    }
    this.editorController.replaceRange(expansion, query.start, this.editorController.selectionStart)
    this.close()
    this.editorController.focus()
  }

  close() {
    this.paletteTarget.hidden = true
    this.matches = []
    this.query = null
  }
}

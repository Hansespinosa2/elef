import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["editor", "palette"]
  static values = { titles: Array }

  connect() {
    this.matches = []
    this.selectedIndex = 0
    this.positionPalette = this.positionPalette.bind(this)
    window.addEventListener("resize", this.positionPalette)
    this.editorTarget.addEventListener("scroll", this.positionPalette)
  }

  disconnect() {
    window.removeEventListener("resize", this.positionPalette)
    this.editorTarget.removeEventListener("scroll", this.positionPalette)
  }

  input() {
    this.refresh()
  }

  keydown(event) {
    if (this.paletteTarget.hidden) return

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
    }
  }

  refresh() {
    const editor = this.editorTarget
    const beforeCaret = editor.value.slice(0, editor.selectionStart)
    if (this.insideCode(beforeCaret)) return this.close()

    const match = beforeCaret.match(/\[\[([^\]\r\n]*)$/)
    if (!match) return this.close()

    this.query = match[1].toLowerCase()
    this.queryStart = editor.selectionStart - this.query.length - 2
    this.matches = this.titlesValue
      .map((title) => ({ title, score: this.score(title) }))
      .filter((result) => result.score !== null)
      .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
      .map((result) => result.title)
    this.selectedIndex = 0
    this.renderPalette()
  }

  score(title) {
    const value = title.toLowerCase()
    if (!this.query) return 0
    if (value.startsWith(this.query)) return 0
    const index = value.indexOf(this.query)
    return index === -1 ? null : index + 1
  }

  renderPalette() {
    this.paletteTarget.replaceChildren()
    this.matches.slice(0, 5).forEach((title, index) => {
      const option = document.createElement("button")
      option.type = "button"
      option.role = "option"
      option.className = `document-link-option${index === this.selectedIndex ? " is-selected" : ""}`
      option.textContent = title
      option.addEventListener("mousedown", (event) => {
        event.preventDefault()
        this.selectedIndex = index
        this.insertSelected()
      })
      this.paletteTarget.append(option)
    })
    this.paletteTarget.hidden = this.matches.length === 0
    if (!this.paletteTarget.hidden) this.positionPalette()
  }

  positionPalette() {
    if (this.paletteTarget.hidden) return

    const editor = this.editorTarget
    const editorRect = editor.getBoundingClientRect()
    const styles = getComputedStyle(editor)
    const mirror = document.createElement("div")
    const marker = document.createElement("span")
    mirror.setAttribute("aria-hidden", "true")
    Object.assign(mirror.style, {
      position: "fixed",
      visibility: "hidden",
      top: `${editorRect.top - editor.scrollTop}px`,
      left: `${editorRect.left - editor.scrollLeft}px`,
      width: `${editor.clientWidth}px`,
      boxSizing: "border-box",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      wordBreak: "break-word",
      font: styles.font,
      lineHeight: styles.lineHeight,
      letterSpacing: styles.letterSpacing,
      padding: styles.padding,
      border: styles.border
    })
    mirror.append(document.createTextNode(editor.value.slice(0, editor.selectionStart)), marker)
    document.body.append(mirror)
    const markerRect = marker.getBoundingClientRect()
    mirror.remove()

    const paletteRect = this.paletteTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(markerRect.left, window.innerWidth - paletteRect.width - 8))
    const top = Math.max(8, Math.min(markerRect.bottom + 4, window.innerHeight - paletteRect.height - 8))
    this.paletteTarget.style.left = `${left}px`
    this.paletteTarget.style.top = `${top}px`
  }

  insertSelected() {
    const title = this.matches[this.selectedIndex]
    if (!title) return this.close()

    const editor = this.editorTarget
    const before = editor.value.slice(0, this.queryStart)
    const after = editor.value.slice(editor.selectionStart)
    const insertion = `[[${title}]]`
    editor.value = before + insertion + after
    const caret = before.length + insertion.length
    editor.focus()
    editor.setSelectionRange(caret, caret)
    this.close()
    editor.dispatchEvent(new Event("input", { bubbles: true }))
  }

  insideCode(source) {
    const lines = source.split("\n")
    let fenced = false
    let fenceCharacter = null
    let fenceLength = 0

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (fenced) {
        if (fence && fence[1][0] === fenceCharacter && fence[1].length >= fenceLength) {
          fenced = false
        } else if (index === lines.length - 1) {
          // Only the line containing the caret determines whether an
          // indented/code-fenced context is active for autocomplete.
          return true
        }
      } else if (fence) {
        fenced = true
        fenceCharacter = fence[1][0]
        fenceLength = fence[1].length
        if (index === lines.length - 1) return true
      } else if (index === lines.length - 1 && /^( {4}|\t)/.test(line)) {
        return true
      }
    }

    if (fenced) return true
    return this.insideInlineCode(lines.at(-1))
  }

  insideInlineCode(line) {
    let markerLength = 0

    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== "`") continue

      let length = 1
      while (line[index + length] === "`") length += 1
      if (markerLength === 0) markerLength = length
      else if (length === markerLength) markerLength = 0
      index += length - 1
    }

    return markerLength > 0
  }

  close() {
    this.paletteTarget.hidden = true
    this.matches = []
  }

  focusResult(event) {
    if (event.key !== "ArrowDown") return
    this.paletteTarget.querySelector("button")?.focus()
  }
}

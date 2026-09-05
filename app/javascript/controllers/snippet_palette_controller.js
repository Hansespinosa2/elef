import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["editor", "palette"]
  static values = { snippets: Array }

  connect() {
    this.matches = []
    this.selectedIndex = 0
    this.stops = []
    this.positionPalette = this.positionPalette.bind(this)
    window.addEventListener("resize", this.positionPalette)
    this.editorTarget.addEventListener("scroll", this.positionPalette)
  }

  disconnect() {
    window.removeEventListener("resize", this.positionPalette)
    this.editorTarget.removeEventListener("scroll", this.positionPalette)
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
    if (this.paletteTarget.hidden) {
      if (event.key === "Tab" && this.stops.length > 0) {
        event.preventDefault()
        this.nextStop()
      }
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
    }
  }

  refresh() {
    const editor = this.editorTarget
    const beforeCaret = editor.value.slice(0, editor.selectionStart)
    const match = beforeCaret.match(/:([a-z0-9-]*)$/i)
    if (!match) return this.close()

    this.query = match[1].toLowerCase()
    this.queryStart = editor.selectionStart - this.query.length - 1
    this.matches = this.snippetsValue
      .map((snippet) => ({ snippet, score: this.score(snippet) }))
      .filter((result) => result.score !== null)
      .sort((a, b) => a.score - b.score || a.snippet.name.localeCompare(b.snippet.name))
      .map((result) => result.snippet)
    this.selectedIndex = 0
    this.renderPalette()
  }

  score(snippet) {
    const text = `${snippet.trigger} ${snippet.name} ${snippet.description}`.toLowerCase()
    if (!this.query) return 0
    if (snippet.trigger.startsWith(this.query)) return 0
    let index = -1
    for (const character of this.query) {
      index = text.indexOf(character, index + 1)
      if (index === -1) return null
    }
    return index + (snippet.trigger.includes(this.query) ? 1 : 10)
  }

  renderPalette() {
    this.paletteTarget.replaceChildren()
    this.matches.slice(0, 5).forEach((snippet, index) => {
      const option = document.createElement("button")
      option.type = "button"
      option.role = "option"
      option.className = `snippet-option${index === this.selectedIndex ? " is-selected" : ""}`
      const trigger = document.createElement("strong")
      trigger.textContent = `:${snippet.trigger}`
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
    if (!this.paletteTarget.hidden) this.positionPalette()
  }

  positionPalette() {
    if (this.paletteTarget.hidden || !this.query) return

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
    const snippet = this.matches[this.selectedIndex]
    if (!snippet) return this.close()

    const editor = this.editorTarget
    const before = editor.value.slice(0, this.queryStart)
    const after = editor.value.slice(editor.selectionStart)
    const expansion = this.expand(snippet.body)
    editor.value = before + expansion.text + after
    const base = before.length
    this.stops = expansion.stops.map((stop) => ({
      ...stop,
      start: base + stop.start,
      end: base + stop.start + stop.length
    }))
    this.close()
    editor.focus()
    this.selectStop(this.stops[0])
    this.ignoreNextInput = true
    editor.dispatchEvent(new Event("input", { bubbles: true }))
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

    const editor = this.editorTarget
    const exit = editor.value[current.end] === "}" ? current.end + 1 : current.end
    editor.setSelectionRange(exit, exit)
  }

  selectStop(stop) {
    const editor = this.editorTarget
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

    const editor = this.editorTarget
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
  }
}

function textLengthBefore(body, stops) {
  let position = body.length
  const markers = [...body.matchAll(/\$\{\d+(?::[^}]*)?\}/g)]
  const marker = markers[stops.length]
  if (marker) position = marker.index - markers.slice(0, stops.length).reduce((total, item) => total + item[0].length, 0)
  return position
}

// Slide overview feature: selection state, slide-array operations, slide-range
// source math, overview-card rendering, and overflow measurement. Framework-free:
// the host constructs it with DOM roots plus an editor seam and delegates its
// lifecycle and actions. The web Stimulus controller is the thin adapter.
import { caretAfterInsert } from "../../session/source_ops.js"

export class SlideOverview {
  constructor({ element, targets = {}, preview = null, editorProvider = null } = {}) {
    this.element = element ?? null
    this.gridTarget = targets.grid ?? null
    this.hasGridTarget = Boolean(targets.grid)
    this.countTarget = targets.count ?? null
    this.warningsTarget = targets.warnings ?? null
    this.preview = preview
    this.editorProvider = editorProvider
    this.selectedIndex = 0
    this.projectionPending = false
  }

  connect() {
    this.selectedIndex = 0
    this.projectionPending = false
    this.installedSource = this.source
    this.preview = this.preview ?? this.element?.querySelector('[data-preview-target="container"]') ?? null
    this.mediaLoaded = () => this.scheduleMeasurement()
    this.preview?.addEventListener("load", this.mediaLoaded, true)
    this.preview?.addEventListener("loadeddata", this.mediaLoaded, true)
    if (typeof ResizeObserver === "function") {
      this.previewObserver = new ResizeObserver(() => this.scheduleMeasurement())
      if (this.preview) this.previewObserver.observe(this.preview)
    } else {
      this.previewObserver = null
    }
    this.renderOverview()
    this.scheduleMeasurement()
    if (typeof globalThis.document !== "undefined") {
      globalThis.document.fonts?.ready?.then(() => this.scheduleMeasurement())
    }
  }

  disconnect() {
    this.previewObserver?.disconnect()
    this.thumbnailObserver?.disconnect()
    this.thumbnailFrames?.clear()
    this.preview?.removeEventListener("load", this.mediaLoaded, true)
    this.preview?.removeEventListener("loadeddata", this.mediaLoaded, true)
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.measurementFrame)
  }

  sourceChanged() {
    this.projectionPending = this.source !== this.installedSource
    if (this.countTarget) this.countTarget.textContent = `${this.sourceRanges().length} slides`
    this.renderOverview()
  }

  previewUpdated() {
    this.installedSource = this.source
    this.projectionPending = false
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.sourceRanges().length - 1))
    this.scheduleMeasurement()
  }

  select(event) {
    if (this.projectionPending) return

    // Stimulus dispatches with the card as currentTarget; neutral host
    // bindings delegate natively, so resolve the card from the event target.
    const card = event.currentTarget?.dataset?.slideIndex !== undefined
      ? event.currentTarget
      : event.target?.closest?.("[data-editor-action='overview-select']")
    if (!card) return
    this.selectCard(card)
  }

  selectCard(card) {
    this.selectedIndex = Number(card?.dataset.slideIndex || 0)
    if (this.element) this.element.dataset.selectedSlideIndex = String(this.selectedIndex)
    this.renderOverview()
    const frame = this.preview?.querySelectorAll(".slide-frame")[this.selectedIndex]
    frame?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  add() {
    const slides = this.slideBodies()
    slides.splice(this.selectedIndex + 1, 0, "")
    this.applySlides(slides, this.selectedIndex + 1)
  }

  duplicate() {
    const slides = this.slideBodies()
    slides.splice(this.selectedIndex + 1, 0, slides[this.selectedIndex])
    this.applySlides(slides, this.selectedIndex + 1)
  }

  delete() {
    const slides = this.slideBodies()
    if (slides.length === 1) {
      slides[0] = ""
      this.applySlides(slides, 0)
      return
    }
    slides.splice(this.selectedIndex, 1)
    this.applySlides(slides, Math.min(this.selectedIndex, slides.length - 1))
  }

  moveUp() {
    this.move(-1)
  }

  moveDown() {
    this.move(1)
  }

  move(distance) {
    const slides = this.slideBodies()
    const target = this.selectedIndex + distance
    if (target < 0 || target >= slides.length) return
    ;[slides[this.selectedIndex], slides[target]] = [slides[target], slides[this.selectedIndex]]
    this.applySlides(slides, target)
  }

  slideBodies(source = this.source) {
    const ranges = this.sourceRanges(source)
    return ranges.map(({ start, end }) => source.slice(start, end))
  }

  applySlides(slides, selectedIndex) {
    if (this.projectionPending) return

    const source = this.source
    const ranges = this.sourceRanges(source)
    const bodyStart = ranges[0]?.start ?? 0
    const lineEnding = this.lineEnding(source)
    const body = slides.map((slide, index) => (
      index < slides.length - 1 && !/[\r\n]$/.test(slide) ? `${slide}${lineEnding}` : slide
    )).join(`---${lineEnding}`)
    const editor = this.editor
    if (!editor) return

    // Full-source commit through the session; caret matches the legacy
    // ranged replace (end of the rewritten body).
    const fullSource = source.slice(0, bodyStart) + body
    if (typeof editor.commitSource === "function") {
      void editor.commitSource(fullSource, { caret: caretAfterInsert(bodyStart, body) })
    } else {
      editor.replaceRange(body, bodyStart, source.length)
    }
    this.selectedIndex = selectedIndex
    if (this.element) this.element.dataset.selectedSlideIndex = String(selectedIndex)
    this.renderOverview()
    editor.focus()
  }

  renderOverview() {
    if (!this.hasGridTarget || !this.gridTarget) return
    recordPreviewTrace("slide-overview-render-start")
    const count = this.sourceRanges().length
    const frames = [...(this.preview?.querySelectorAll(".slide-frame") || [])]
    const focusedIndex = this.gridTarget.contains(globalThis.document?.activeElement)
      ? Number(globalThis.document.activeElement.dataset.slideIndex)
      : null
    this.thumbnailObserver?.disconnect()
    this.thumbnailFrames = new Map()
    this.gridTarget.replaceChildren()

    const thumbnailCards = []
    for (let index = 0; index < count; index += 1) {
      const frame = frames[index]
      const title = frame?.querySelector("h1, h2, h3, h4, .empty-slide")?.textContent?.trim() || `Slide ${index + 1}`
      const card = globalThis.document.createElement("button")
      card.type = "button"
      card.className = "slide-overview-card"
      card.dataset.slideIndex = String(index)
      card.dataset.editorAction = "overview-select"
      card.setAttribute("aria-label", `Select slide ${index + 1}: ${title}`)
      card.setAttribute("aria-current", index === this.selectedIndex ? "true" : "false")
      card.disabled = this.projectionPending

      const thumbnail = globalThis.document.createElement("span")
      thumbnail.className = "slide-overview-thumbnail"
      thumbnail.setAttribute("aria-hidden", "true")
      if (frame) {
        thumbnail.classList.add("is-loading")
        this.thumbnailFrames.set(card, frame)
        thumbnailCards.push(card)
      } else {
        thumbnail.classList.add("is-loading")
      }

      const label = globalThis.document.createElement("span")
      label.className = "slide-overview-label"
      label.textContent = `${index + 1}. ${title}`
      card.append(thumbnail, label)
      this.gridTarget.append(card)
    }
    if (this.countTarget) this.countTarget.textContent = `${count} ${count === 1 ? "slide" : "slides"}`
    this.updateActionAvailability(count)
    recordPreviewTrace("slide-overview-render-ready")
    if (Number.isInteger(focusedIndex)) this.gridTarget.querySelector(`[data-slide-index="${focusedIndex}"]`)?.focus()

    if (typeof IntersectionObserver === "function") {
      this.thumbnailObserver = new IntersectionObserver(entries => {
        const visibleCards = entries
          .filter(entry => entry.isIntersecting)
          .map(entry => ({ card: entry.target, frame: this.thumbnailFrames.get(entry.target) }))
          .filter(entry => entry.frame)
        visibleCards.forEach(({ card }) => this.thumbnailObserver?.unobserve(card))
        this.renderVisibleThumbnails(visibleCards)
      }, { root: this.gridTarget, rootMargin: "80px" })
      thumbnailCards.forEach(card => this.thumbnailObserver.observe(card))
    } else {
      this.renderVisibleThumbnails(thumbnailCards.map(card => ({ card, frame: this.thumbnailFrames.get(card) })))
    }
  }

  renderVisibleThumbnails(entries) {
    if (!entries.length) return
    recordPreviewTrace("slide-overview-scale-start")
    for (const { card, frame } of entries) {
      const clone = globalThis.document.createElement("div")
      clone.className = "slide-frame"
      const slide = frame.querySelector(":scope > .slide")
      if (slide) clone.append(slide.cloneNode(true))
      clone.querySelectorAll(".presentation-editor-slide-toolbar, .presentation-editor-block-controls").forEach(element => element.remove())
      clone.querySelectorAll("[data-controller]").forEach(element => element.removeAttribute("data-controller"))
      clone.querySelectorAll("[contenteditable], [data-action], [data-editor-block-id], [data-editor-region-id]").forEach(element => {
        element.removeAttribute("contenteditable")
        element.removeAttribute("data-action")
        element.removeAttribute("data-editor-block-id")
        element.removeAttribute("data-editor-region-id")
      })
      clone.querySelectorAll("a, button, input, video").forEach(element => {
        element.tabIndex = -1
        if (element instanceof globalThis.HTMLVideoElement) element.controls = false
      })
      const thumbnail = card.querySelector(".slide-overview-thumbnail")
      thumbnail.classList.remove("is-loading")
      thumbnail.append(clone)
    }
    const clones = entries.map(({ card }) => card.querySelector(".slide-overview-thumbnail > .slide-frame"))
    const scales = clones.map(frame => frame.clientWidth / 1280)
    clones.forEach((frame, index) => frame.style.setProperty("--slide-scale", scales[index]))
    recordPreviewTrace("slide-overview-scale-ready")
  }

  scheduleMeasurement() {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.measurementFrame)
    if (typeof requestAnimationFrame === "function") {
      this.measurementFrame = requestAnimationFrame(() => this.measureOverflow())
    } else {
      this.measureOverflow()
    }
  }

  measureOverflow() {
    recordPreviewTrace("slide-overflow-start")
    const frames = [...(this.preview?.querySelectorAll(".slide-frame") || [])]
    const measurements = frames.map((frame, index) => {
      const slide = frame.querySelector(":scope > .slide")
      if (!slide) return null
      return {
        frame,
        slide,
        index,
        overflowing: slide.scrollHeight > slide.clientHeight + 4 || slide.scrollWidth > slide.clientWidth + 4
      }
    })
    const messages = []
    measurements.forEach(measurement => {
      if (!measurement) return
      const { frame, slide, index, overflowing } = measurement
      frame.classList.toggle("is-overflowing", overflowing)
      slide.classList.toggle("is-overflowing", overflowing)
      if (overflowing) messages.push(`Slide ${index + 1} extends beyond its 16:9 frame. Shorten, reflow, or split its content.`)
    })

    this.warningListTarget.replaceChildren()
    messages.forEach((message) => {
      const item = globalThis.document.createElement("li")
      item.textContent = message
      this.warningListTarget.append(item)
    })
    if (this.warningsTarget) this.warningsTarget.hidden = messages.length === 0
    this.renderOverview()
    recordPreviewTrace("slide-overflow-ready")
  }

  get warningListTarget() {
    return this.warningsTarget.querySelector("ul")
  }

  updateActionAvailability(count) {
    const buttons = this.element?.querySelectorAll(".slide-overview-actions button") ?? []
    const [add, duplicate, remove, up, down] = buttons
    add.disabled = this.projectionPending
    duplicate.disabled = this.projectionPending || count === 0
    remove.disabled = this.projectionPending || count === 0
    up.disabled = this.projectionPending || this.selectedIndex <= 0
    down.disabled = this.projectionPending || this.selectedIndex >= count - 1
  }

  sourceRanges(source = this.source) {
    const lines = this.sourceLines(source)
    const firstLine = lines[0]
    const opensFrontMatter = firstLine && firstLine.text.replace(/^\uFEFF/, "").replace(/[ \t]+$/, "") === "---"
    let bodyStart = 0
    if (opensFrontMatter) {
      const closingIndex = lines.findIndex((line, index) => index > 0 && line.text.replace(/[ \t]+$/, "") === "---")
      const hasMetadata = lines.slice(1, closingIndex).some((line) => /^[A-Za-z_][\w-]*\s*:/.test(line.text))
      if (closingIndex > 0 && hasMetadata) bodyStart = lines[closingIndex].end
    }

    const ranges = []
    let slideStart = bodyStart
    let fence = null
    lines.forEach((line) => {
      if (line.end <= bodyStart) return
      const incoming = line.text.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/)
      if (incoming) {
        const nextFence = {
          marker: incoming[1][0],
          length: incoming[1].length,
          closing: /^[ \t]*$/.test(incoming[2])
        }
        if (!fence) fence = nextFence
        else if (fence.marker === nextFence.marker && nextFence.length >= fence.length && nextFence.closing) fence = null
      }
      if (!fence && /^---[ \t]*$/.test(line.text)) {
        ranges.push({ start: slideStart, end: line.start })
        slideStart = line.end
      }
    })
    ranges.push({ start: slideStart, end: source.length })
    return ranges
  }

  sourceLines(source) {
    const lines = []
    let cursor = 0
    while (cursor < source.length) {
      const start = cursor
      let newline = cursor
      while (newline < source.length && source[newline] !== "\n" && source[newline] !== "\r") newline += 1
      const text = source.slice(start, newline)
      let end = newline
      if (source[end] === "\r" && source[end + 1] === "\n") end += 2
      else if (source[end] === "\r" || source[end] === "\n") end += 1
      lines.push({ start, end, text })
      cursor = end
    }
    return lines
  }

  lineEnding(source) {
    return source.match(/\r\n|\r|\n/)?.[0] || "\n"
  }

  get editor() {
    if (typeof this.editorProvider === "function") return this.editorProvider()
    return this.element?.querySelector("[data-controller~='editor']")?.editorController ?? null
  }

  get source() {
    return this.editor?.value ?? this.element?.querySelector('[name$="[source]"]')?.value ?? ""
  }
}

function recordPreviewTrace(stage) {
  const trace = globalThis.__elefPreviewTrace
  if (!Array.isArray(trace)) return
  trace.push({ time: performance.now(), stage })
  if (trace.length > 512) trace.shift()
}

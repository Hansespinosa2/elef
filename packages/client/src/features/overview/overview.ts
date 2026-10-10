// Slide overview feature: selection state, slide-array operations, slide-range
// source math, overview-card rendering, and overflow measurement. Framework-free:
// the host constructs it with DOM roots plus an editor seam and delegates its
// lifecycle and actions. The web Stimulus controller is the thin adapter.
import { caretAfterInsert } from "../../session/source_ops.js"

export interface OverviewEditor {
  value: string
  commitSource?(source: string, options?: { caret?: number }): unknown
  replaceRange(replacement: string, from: number, to: number): void
  focus(): void
}

export interface SlideOverviewTargets {
  grid?: Element | null
  count?: Element | null
  warnings?: Element | null
}

export interface SlideOverviewOptions {
  element?: Element | null
  targets?: SlideOverviewTargets
  preview?: Element | null
  editorProvider?: (() => OverviewEditor | null) | null
}

export interface OverviewSelectEvent {
  currentTarget?: EventTarget | null | undefined
  target?: EventTarget | null | undefined
}

interface ThumbnailEntry {
  card: Element
  frame: Element
}

export class SlideOverview {
  element: Element | null
  gridTarget: Element | null
  hasGridTarget: boolean
  countTarget: Element | null
  warningsTarget: Element | null
  preview: Element | null
  editorProvider: (() => OverviewEditor | null) | null
  selectedIndex: number
  projectionPending: boolean
  installedSource: string | undefined
  mediaLoaded: (() => void) | undefined
  previewObserver: ResizeObserver | null | undefined
  thumbnailObserver: IntersectionObserver | null | undefined
  thumbnailFrames: Map<Element, Element> | undefined
  measurementFrame: number | undefined

  constructor({ element, targets = {}, preview = null, editorProvider = null }: SlideOverviewOptions = {}) {
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

  connect(): void {
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

  disconnect(): void {
    this.previewObserver?.disconnect()
    this.thumbnailObserver?.disconnect()
    this.thumbnailFrames?.clear()
    if (this.mediaLoaded) {
      this.preview?.removeEventListener("load", this.mediaLoaded, true)
      this.preview?.removeEventListener("loadeddata", this.mediaLoaded, true)
    }
    if (typeof cancelAnimationFrame === "function" && this.measurementFrame !== undefined) cancelAnimationFrame(this.measurementFrame)
  }

  sourceChanged(): void {
    this.projectionPending = this.source !== this.installedSource
    if (this.countTarget) this.countTarget.textContent = `${this.sourceRanges().length} slides`
    this.renderOverview()
  }

  previewUpdated(): void {
    this.installedSource = this.source
    this.projectionPending = false
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.sourceRanges().length - 1))
    this.scheduleMeasurement()
  }

  select(event: OverviewSelectEvent): void {
    if (this.projectionPending) return

    // Stimulus dispatches with the card as currentTarget; neutral host
    // bindings delegate natively, so resolve the card from the event target.
    const currentTarget = event.currentTarget as HTMLElement | null | undefined
    const card = currentTarget?.dataset?.slideIndex !== undefined
      ? currentTarget
      : (event.target as Element | null | undefined)?.closest?.("[data-editor-action='overview-select']") as HTMLElement | null | undefined
    if (!card) return
    this.selectCard(card)
  }

  selectCard(card: HTMLElement): void {
    this.selectedIndex = Number(card?.dataset.slideIndex || 0)
    if (this.element) (this.element as HTMLElement).dataset.selectedSlideIndex = String(this.selectedIndex)
    this.renderOverview()
    const frame = this.preview?.querySelectorAll(".slide-frame")[this.selectedIndex]
    frame?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  add(): void {
    const slides = this.slideBodies()
    slides.splice(this.selectedIndex + 1, 0, "")
    this.applySlides(slides, this.selectedIndex + 1)
  }

  duplicate(): void {
    const slides = this.slideBodies()
    slides.splice(this.selectedIndex + 1, 0, slides[this.selectedIndex] as string)
    this.applySlides(slides, this.selectedIndex + 1)
  }

  delete(): void {
    const slides = this.slideBodies()
    if (slides.length === 1) {
      slides[0] = ""
      this.applySlides(slides, 0)
      return
    }
    slides.splice(this.selectedIndex, 1)
    this.applySlides(slides, Math.min(this.selectedIndex, slides.length - 1))
  }

  moveUp(): void {
    this.move(-1)
  }

  moveDown(): void {
    this.move(1)
  }

  move(distance: number): void {
    const slides = this.slideBodies()
    const target = this.selectedIndex + distance
    if (target < 0 || target >= slides.length) return
    ;[slides[this.selectedIndex], slides[target]] = [slides[target] as string, slides[this.selectedIndex] as string]
    this.applySlides(slides, target)
  }

  slideBodies(source: string = this.source): Array<string> {
    const ranges = this.sourceRanges(source)
    return ranges.map(({ start, end }) => source.slice(start, end))
  }

  applySlides(slides: Array<string>, selectedIndex: number): void {
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
    if (this.element) (this.element as HTMLElement).dataset.selectedSlideIndex = String(selectedIndex)
    this.renderOverview()
    editor.focus()
  }

  renderOverview(): void {
    if (!this.hasGridTarget || !this.gridTarget) return
    recordPreviewTrace("slide-overview-render-start")
    const count = this.sourceRanges().length
    const frames = [...(this.preview?.querySelectorAll(".slide-frame") || [])]
    const activeElement = globalThis.document?.activeElement
    const focusedIndex = activeElement && this.gridTarget.contains(activeElement)
      ? Number((activeElement as HTMLElement).dataset.slideIndex)
      : null
    this.thumbnailObserver?.disconnect()
    this.thumbnailFrames = new Map()
    this.gridTarget.replaceChildren()

    const thumbnailCards: Array<Element> = []
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
    if (Number.isInteger(focusedIndex)) (this.gridTarget.querySelector(`[data-slide-index="${focusedIndex}"]`) as HTMLElement | null)?.focus()

    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(entries => {
        const visibleCards = entries
          .filter(entry => entry.isIntersecting)
          .map(entry => ({ card: entry.target, frame: this.thumbnailFrames?.get(entry.target) }))
          .filter((entry): entry is ThumbnailEntry => Boolean(entry.frame))
        visibleCards.forEach(({ card }) => observer.unobserve(card))
        this.renderVisibleThumbnails(visibleCards)
      }, { root: this.gridTarget, rootMargin: "80px" })
      this.thumbnailObserver = observer
      thumbnailCards.forEach(card => observer.observe(card))
    } else {
      this.renderVisibleThumbnails(thumbnailCards.map(card => ({ card, frame: this.thumbnailFrames?.get(card) as Element })))
    }
  }

  renderVisibleThumbnails(entries: Array<ThumbnailEntry>): void {
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
        ;(element as HTMLElement).tabIndex = -1
        if (element instanceof globalThis.HTMLVideoElement) element.controls = false
      })
      const thumbnail = card.querySelector(".slide-overview-thumbnail") as Element
      thumbnail.classList.remove("is-loading")
      thumbnail.append(clone)
    }
    const clones = entries.map(({ card }) => card.querySelector(".slide-overview-thumbnail > .slide-frame") as HTMLElement)
    clones.forEach((frame) => frame.style.setProperty("--slide-scale", String(frame.clientWidth / 1280)))
    recordPreviewTrace("slide-overview-scale-ready")
  }

  scheduleMeasurement(): void {
    if (typeof cancelAnimationFrame === "function" && this.measurementFrame !== undefined) cancelAnimationFrame(this.measurementFrame)
    if (typeof requestAnimationFrame === "function") {
      this.measurementFrame = requestAnimationFrame(() => this.measureOverflow())
    } else {
      this.measureOverflow()
    }
  }

  measureOverflow(): void {
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
    const messages: Array<string> = []
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
    if (this.warningsTarget) (this.warningsTarget as HTMLElement).hidden = messages.length === 0
    this.renderOverview()
    recordPreviewTrace("slide-overflow-ready")
  }

  get warningListTarget(): Element {
    return this.warningsTarget?.querySelector("ul") as Element
  }

  updateActionAvailability(count: number): void {
    const buttons = [...(this.element?.querySelectorAll(".slide-overview-actions button") ?? [])] as Array<HTMLButtonElement>
    const [add, duplicate, remove, up, down] = buttons
    if (!add || !duplicate || !remove || !up || !down) return
    add.disabled = this.projectionPending
    duplicate.disabled = this.projectionPending || count === 0
    remove.disabled = this.projectionPending || count === 0
    up.disabled = this.projectionPending || this.selectedIndex <= 0
    down.disabled = this.projectionPending || this.selectedIndex >= count - 1
  }

  sourceRanges(source: string = this.source): Array<{ start: number; end: number }> {
    const lines = this.sourceLines(source)
    const firstLine = lines[0]
    const opensFrontMatter = firstLine && firstLine.text.replace(/^\uFEFF/, "").replace(/[ \t]+$/, "") === "---"
    let bodyStart = 0
    if (opensFrontMatter) {
      const closingIndex = lines.findIndex((line, index) => index > 0 && line.text.replace(/[ \t]+$/, "") === "---")
      const hasMetadata = lines.slice(1, closingIndex).some((line) => /^[A-Za-z_][\w-]*\s*:/.test(line.text))
      if (closingIndex > 0 && hasMetadata) bodyStart = lines[closingIndex]?.end ?? bodyStart
    }

    const ranges: Array<{ start: number; end: number }> = []
    let slideStart = bodyStart
    let fence: { marker: string; length: number; closing: boolean } | null = null
    lines.forEach((line) => {
      if (line.end <= bodyStart) return
      const incoming = line.text.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/)
      if (incoming) {
        const [, markerText = "", restText = ""] = incoming
        const nextFence = {
          marker: markerText[0] ?? "",
          length: markerText.length,
          closing: /^[ \t]*$/.test(restText)
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

  sourceLines(source: string): Array<{ start: number; end: number; text: string }> {
    const lines: Array<{ start: number; end: number; text: string }> = []
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

  lineEnding(source: string): string {
    return source.match(/\r\n|\r|\n/)?.[0] || "\n"
  }

  get editor(): OverviewEditor | null {
    if (typeof this.editorProvider === "function") return this.editorProvider()
    const host = this.element?.querySelector("[data-controller~='editor']") as (Element & { editorController?: OverviewEditor | null }) | null | undefined
    return host?.editorController ?? null
  }

  get source(): string {
    const field = this.element?.querySelector('[name$="[source]"]') as HTMLTextAreaElement | null | undefined
    return this.editor?.value ?? field?.value ?? ""
  }
}

function recordPreviewTrace(stage: string): void {
  const trace = (globalThis as unknown as { __elefPreviewTrace?: unknown }).__elefPreviewTrace
  if (!Array.isArray(trace)) return
  trace.push({ time: performance.now(), stage })
  if (trace.length > 512) trace.shift()
}

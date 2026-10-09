// Shared presentation-mode controller: slide navigation, keyboard travel,
// fullscreen, and stage focus. Ported from the Stimulus-era
// presentation_controller.js without behavior change. Framework-free: hosts
// construct it with their stage element and tear it down with destroy().
// Slide visibility, counter text, and video play/pause match the retired
// controller exactly so both hosts keep passing the shared scenario.

import { createPresentationNavigation, presentationActionForKey } from "./navigation.js"

function videosOf(slide) {
  return [...slide.querySelectorAll("video")]
}

export class PresentationController {
  constructor(scope, options = {}) {
    this.scope = scope
    this.document = options.document ?? scope?.ownerDocument ?? globalThis.document
    this.stage = options.stage ?? null
    this.counter = options.counter ?? scope?.querySelector("[data-presentation-counter]") ?? null
    this.explicitSlides = options.slides ?? null
    this.slides = []
    this.navigation = null
    this.active = false
    this.index = 0
    this.disposers = []
    this.onKeyDown = (event) => this.handleKey(event)
    this.onPreviewUpdated = () => this.refreshSlides()
    if (scope && typeof scope.addEventListener === "function") {
      scope.addEventListener("elef:preview-updated", this.onPreviewUpdated)
      this.disposers.push(() => scope.removeEventListener("elef:preview-updated", this.onPreviewUpdated))
    }
    if (options.active) this.start()
  }

  destroy() {
    this.stop()
    this.disposers.splice(0).forEach((dispose) => dispose())
  }

  start() {
    this.slides = this.stage
      ? [...this.stage.querySelectorAll(".slide-frame")]
      : [...(this.explicitSlides ?? this.scope.querySelectorAll('[data-presentation-slide]'))]
    this.navigation = createPresentationNavigation(this.slides.length)
    if (!this.navigation) return false

    this.index = this.navigation.currentIndex
    this.active = true
    this.keyTarget().addEventListener("keydown", this.onKeyDown)
    this.disposers.push(() => this.keyTarget().removeEventListener("keydown", this.onKeyDown))
    this.showCurrentSlide()
    this.stage?.focus?.()
    return true
  }

  stop() {
    this.keyTarget().removeEventListener("keydown", this.onKeyDown)
    this.active = false
    this.slides?.forEach((slide) => {
      slide.hidden = false
      slide.classList.remove("is-active-presentation-slide")
      slide.removeAttribute("aria-hidden")
      videosOf(slide).forEach((video) => video.pause())
    })
    this.navigation = null
    this.slides = []
  }

  next() {
    if (!this.navigation) return
    this.index = this.navigation.next()
    this.showCurrentSlide()
  }

  previous() {
    if (!this.navigation) return
    this.index = this.navigation.previous()
    this.showCurrentSlide()
  }

  first() {
    if (!this.navigation) return
    this.index = this.navigation.first()
    this.showCurrentSlide()
  }

  last() {
    if (!this.navigation) return
    this.index = this.navigation.last()
    this.showCurrentSlide()
  }

  refreshSlides() {
    if (!this.active || !this.stage) return
    const slides = [...this.stage.querySelectorAll(".slide-frame")]
    if (!slides.length) return

    this.slides = slides
    this.navigation = createPresentationNavigation(slides.length, this.index)
    this.index = this.navigation.currentIndex
    this.showCurrentSlide()
  }

  fullscreen() {
    const request = this.stage?.requestFullscreen?.()
    request?.catch(() => {})
  }

  handleKey(event) {
    if (!this.active) return
    if (event.target?.closest?.("a, button, input, select, textarea, summary, [contenteditable='true']")) return
    const action = presentationActionForKey(event.key)
    if (!action) return
    event.preventDefault()
    if (action === "next") this.next()
    else if (action === "previous") this.previous()
    else if (action === "first") this.first()
    else if (action === "last") this.last()
  }

  showCurrentSlide() {
    this.slides.forEach((slide, slideIndex) => {
      const active = slideIndex === this.index
      slide.hidden = !active
      slide.classList.toggle("is-active-presentation-slide", active)
      slide.setAttribute("aria-hidden", active ? "false" : "true")
      videosOf(slide).forEach((video) => {
        if (active) video.play().catch(() => {})
        else video.pause()
      })
    })
    if (this.counter) {
      this.counter.textContent = `${this.index + 1} / ${this.slides.length}`
    }
  }

  keyTarget() {
    return this.document ?? globalThis.document
  }
}

// Mounts presentation behavior on a host scope: the navigation controller
// plus per-frame canvas scaling. Returns a destroy that tears both down.
// Hosts pass their own stage element; without one, slides are discovered
// as .slide-frame descendants of the scope.
export function mountPresentation(scope, options = {}) {
  const controller = new PresentationController(scope, {
    document: options.document,
    stage: options.stage ?? null,
    counter: options.counter,
    slides: options.stage ? undefined : [...scope.querySelectorAll(".slide-frame")],
    active: options.active ?? false,
  })
  const scalings = [...scope.querySelectorAll(".slide-frame")].map((frame) => attachCanvasScaling(frame))
  return {
    controller,
    destroy() {
      controller.destroy()
      scalings.forEach((detach) => detach())
    },
  }
}

// Canvas scaling for slide frames: keeps the --slide-scale custom property
// in sync with the element width (port of presentation_canvas_controller.js).
export function attachCanvasScaling(element, options = {}) {
  const designWidth = options.designWidth || 1280
  const designHeight = options.designHeight ?? null
  const resize = () => {
    const scale = designHeight == null
      ? element.clientWidth / designWidth
      : Math.min(element.clientWidth / designWidth, element.clientHeight / designHeight)
    element.style.setProperty("--slide-scale", String(scale))
  }
  const Observer = options.ResizeObserver ?? globalThis.ResizeObserver
  const observer = typeof Observer === "function" ? new Observer(resize) : null
  observer?.observe(element)
  resize()
  return () => observer?.disconnect()
}

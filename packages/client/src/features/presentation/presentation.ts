// Shared presentation-mode controller: slide navigation, keyboard travel,
// fullscreen, and stage focus. Ported from the Stimulus-era
// presentation_controller.js without behavior change. Framework-free: hosts
// construct it with their stage element and tear it down with destroy().
// Slide visibility, counter text, and video play/pause match the retired
// controller exactly so both hosts keep passing the shared scenario.

import { createPresentationNavigation, presentationActionForKey, type PresentationNavigationState } from "./navigation.js"

function videosOf(slide: Element): Array<HTMLVideoElement> {
  return [...slide.querySelectorAll("video")]
}

export interface PresentationControllerOptions {
  document?: Document | undefined
  stage?: Element | null | undefined
  getStage?: (() => Element | null) | undefined
  counter?: Element | null | undefined
  slides?: Iterable<Element> | undefined
  active?: boolean
}

export class PresentationController {
  scope: Element
  document: Document
  getStage: () => Element | null
  stage: Element | null
  counter: Element | null
  explicitSlides: Iterable<Element> | null
  slides: Array<Element>
  navigation: PresentationNavigationState | null
  active: boolean
  index: number
  disposers: Array<() => void>
  onKeyDown: (event: Event) => void
  onPreviewUpdated: () => void

  constructor(scope: Element, options: PresentationControllerOptions = {}) {
    this.scope = scope
    this.document = options.document ?? scope?.ownerDocument ?? globalThis.document
    // Hosts replace the projection element on every preview install, so the
    // stage is resolved live (like the retired Stimulus stage target did);
    // a bound element would go stale after the first re-render.
    this.getStage = options.getStage ?? (() => options.stage ?? null)
    this.stage = null
    this.counter = options.counter ?? scope?.querySelector("[data-presentation-counter]") ?? null
    this.explicitSlides = options.slides ?? null
    this.slides = []
    this.navigation = null
    this.active = false
    this.index = 0
    this.disposers = []
    this.onKeyDown = (event) => this.handleKey(event as KeyboardEvent)
    this.onPreviewUpdated = () => this.refreshSlides()
    if (scope && typeof scope.addEventListener === "function") {
      scope.addEventListener("elef:preview-updated", this.onPreviewUpdated)
      this.disposers.push(() => scope.removeEventListener("elef:preview-updated", this.onPreviewUpdated))
    }
    if (options.active) this.start()
  }

  destroy(): void {
    this.stop()
    this.disposers.splice(0).forEach((dispose) => dispose())
  }

  start(): boolean {
    this.stage = this.getStage()
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
    ;(this.stage as HTMLElement | null)?.focus?.()
    return true
  }

  stop(): void {
    this.keyTarget().removeEventListener("keydown", this.onKeyDown)
    this.active = false
    this.slides?.forEach((slide) => {
      ;(slide as HTMLElement).hidden = false
      slide.classList.remove("is-active-presentation-slide")
      slide.removeAttribute("aria-hidden")
      videosOf(slide).forEach((video) => video.pause())
    })
    this.navigation = null
    this.slides = []
  }

  next(): void {
    if (!this.navigation) return
    this.index = this.navigation.next()
    this.showCurrentSlide()
  }

  previous(): void {
    if (!this.navigation) return
    this.index = this.navigation.previous()
    this.showCurrentSlide()
  }

  first(): void {
    if (!this.navigation) return
    this.index = this.navigation.first()
    this.showCurrentSlide()
  }

  last(): void {
    if (!this.navigation) return
    this.index = this.navigation.last()
    this.showCurrentSlide()
  }

  refreshSlides(): void {
    if (!this.active) return
    this.stage = this.getStage()
    if (!this.stage) return
    const slides = [...this.stage.querySelectorAll(".slide-frame")]
    if (!slides.length) return

    this.slides = slides
    this.navigation = createPresentationNavigation(slides.length, this.index)
    if (!this.navigation) return
    this.index = this.navigation.currentIndex
    this.showCurrentSlide()
  }

  fullscreen(): void {
    const request = this.stage?.requestFullscreen?.()
    request?.catch(() => {})
  }

  handleKey(event: KeyboardEvent): void {
    if (!this.active) return
    if ((event.target as Element | null)?.closest?.("a, button, input, select, textarea, summary, [contenteditable='true']")) return
    const action = presentationActionForKey(event.key)
    if (!action) return
    event.preventDefault()
    if (action === "next") this.next()
    else if (action === "previous") this.previous()
    else if (action === "first") this.first()
    else if (action === "last") this.last()
  }

  showCurrentSlide(): void {
    this.slides.forEach((slide, slideIndex) => {
      const active = slideIndex === this.index
      ;(slide as HTMLElement).hidden = !active
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

  keyTarget(): Document {
    return this.document ?? globalThis.document
  }
}

export interface MountPresentationOptions {
  document?: Document
  stage?: Element | null
  getStage?: () => Element | null
  counter?: Element | null
  active?: boolean
}

// Mounts presentation behavior on a host scope: the navigation controller
// plus per-frame canvas scaling. Returns a destroy that tears both down.
// Hosts pass their own stage element; without one, slides are discovered
// as .slide-frame descendants of the scope.
export function mountPresentation(scope: Element, options: MountPresentationOptions = {}) {
  const controller = new PresentationController(scope, {
    document: options.document,
    stage: options.stage ?? null,
    getStage: options.getStage,
    counter: options.counter,
    slides: options.stage ?? options.getStage ? undefined : [...scope.querySelectorAll(".slide-frame")],
    active: options.active ?? false,
  })
  let scalings = attachScalings()
  function attachScalings(): Array<() => void> {
    return [...scope.querySelectorAll(".slide-frame")].map((frame) => attachCanvasScaling(frame))
  }
  return {
    controller,
    // Re-discovers slides after the host re-renders the projection (live
    // preview updates replace frames while a mount is active).
    resync() {
      scalings.forEach((detach) => detach())
      scalings = attachScalings()
      controller.refreshSlides()
    },
    destroy() {
      controller.destroy()
      scalings.forEach((detach) => detach())
    },
  }
}

export interface CanvasScalingOptions {
  designWidth?: number
  designHeight?: number | null
  ResizeObserver?: typeof ResizeObserver | undefined
}

// Canvas scaling for slide frames: keeps the --slide-scale custom property
// in sync with the element width (port of presentation_canvas_controller.js).
export function attachCanvasScaling(element: Element, options: CanvasScalingOptions = {}) {
  const designWidth = options.designWidth || 1280
  const designHeight = options.designHeight ?? null
  const resize = () => {
    const scale = designHeight == null
      ? element.clientWidth / designWidth
      : Math.min(element.clientWidth / designWidth, element.clientHeight / designHeight)
    ;(element as HTMLElement).style.setProperty("--slide-scale", String(scale))
  }
  const Observer = options.ResizeObserver ?? globalThis.ResizeObserver
  const observer = typeof Observer === "function" ? new Observer(resize) : null
  observer?.observe(element)
  resize()
  return () => observer?.disconnect()
}

import { Controller } from "@hotwired/stimulus"
import { createPresentationNavigation, presentationActionForKey } from "lib/presentation_navigation"

export default class extends Controller {
  static targets = ["slide", "counter", "stage"]
  static values = { active: Boolean, index: Number }

  connect() {
    this.keyHandler = (event) => this.handleKey(event)
    this.previewUpdatedHandler = () => this.refreshSlides()
    this.slides = []
    this.element.addEventListener("elef:preview-updated", this.previewUpdatedHandler)
    if (this.activeValue) this.start()
  }

  disconnect() {
    this.stop()
    this.element.removeEventListener("elef:preview-updated", this.previewUpdatedHandler)
  }

  start() {
    this.slides = this.hasStageTarget
      ? [...this.stageTarget.querySelectorAll(".slide-frame")]
      : this.slideTargets
    this.navigation = createPresentationNavigation(this.slides.length, 0, this.eventCountsFor(this.slides))
    if (!this.navigation) return false

    this.indexValue = this.navigation.currentIndex
    this.activeValue = true
    document.addEventListener("keydown", this.keyHandler)
    this.showCurrentSlide()
    this.stageTarget?.focus()
    return true
  }

  stop() {
    document.removeEventListener("keydown", this.keyHandler)
    this.activeValue = false
    this.slides?.forEach((slide) => {
      slide.hidden = false
      slide.classList.remove("is-active-presentation-slide")
      slide.removeAttribute("aria-hidden")
      this.clearRevealState(slide)
      slide.querySelectorAll("video").forEach((video) => video.pause())
    })
    this.navigation = null
    this.slides = []
  }

  next() {
    if (!this.navigation) return
    this.navigation.next()
    this.indexValue = this.navigation.currentIndex
    this.showCurrentSlide()
  }

  refreshSlides() {
    if (!this.activeValue || !this.hasStageTarget) return
    const slides = [...this.stageTarget.querySelectorAll(".slide-frame")]
    if (!slides.length) {
      this.slides = []
      this.navigation = null
      this.indexValue = 0
      return
    }

    const priorProgress = this.navigation?.revealedEventCount ?? 0
    this.slides = slides
    this.navigation = createPresentationNavigation(
      slides.length,
      this.indexValue,
      this.eventCountsFor(slides),
      priorProgress
    )
    this.indexValue = this.navigation.currentIndex
    this.showCurrentSlide()
  }

  previous() {
    if (!this.navigation) return
    this.navigation.previous()
    this.indexValue = this.navigation.currentIndex
    this.showCurrentSlide()
  }

  fullscreen() {
    const request = this.stageTarget?.requestFullscreen?.()
    request?.catch(() => {})
  }

  handleKey(event) {
    if (!this.activeValue) return
    if (event.target.closest?.("a, button, input, select, textarea, summary, [contenteditable='true']")) return
    const action = presentationActionForKey(event.key)
    if (!action) return
    event.preventDefault()
    if (action === "next") this.next()
    else if (action === "previous") this.previous()
    else if (action === "first") {
      if (!this.navigation) return
      this.navigation.first()
      this.indexValue = this.navigation.currentIndex
      this.showCurrentSlide()
    } else if (action === "last") {
      if (!this.navigation) return
      this.navigation.last()
      this.indexValue = this.navigation.currentIndex
      this.showCurrentSlide()
    }
  }

  eventCountsFor(slides) {
    return slides.map((slide) => {
      const count = Number(slide.querySelector(".slide")?.getAttribute("data-elef-reveal-event-count") || 0)
      return Number.isSafeInteger(count) && count >= 0 ? count : 0
    })
  }

  clearRevealState(slide) {
    slide.querySelectorAll("[data-elef-reveal-event]").forEach((block) => {
      block.classList.remove("is-presentation-reveal-hidden")
      block.removeAttribute("aria-hidden")
      block.removeAttribute("inert")
      const controls = block.nextElementSibling
      if (controls?.classList.contains("presentation-editor-block-controls")) controls.hidden = false
    })
  }

  setRevealState(block, hidden) {
    block.classList.toggle("is-presentation-reveal-hidden", hidden)
    if (hidden) {
      block.setAttribute("aria-hidden", "true")
      block.setAttribute("inert", "")
      if (block.contains(document.activeElement)) this.stageTarget?.focus?.({ preventScroll: true })
    } else {
      block.removeAttribute("aria-hidden")
      block.removeAttribute("inert")
    }
    const controls = block.nextElementSibling
    if (controls?.classList.contains("presentation-editor-block-controls")) controls.hidden = hidden
  }

  showCurrentSlide() {
    if (!this.navigation) return
    const revealedEventCount = this.navigation.revealedEventCount
    this.slides.forEach((slide, index) => {
      const active = index === this.indexValue
      slide.hidden = !active
      slide.classList.toggle("is-active-presentation-slide", active)
      slide.setAttribute("aria-hidden", active ? "false" : "true")
      if (!active) this.clearRevealState(slide)
      else {
        slide.querySelectorAll("[data-elef-reveal-event]").forEach((block) => {
          const revealEvent = Number(block.getAttribute("data-elef-reveal-event"))
          const hasRevealEvent = Number.isSafeInteger(revealEvent) && revealEvent >= 0
          this.setRevealState(block, hasRevealEvent && revealEvent >= revealedEventCount)
        })
      }
      slide.querySelectorAll("video").forEach((video) => {
        const revealBlock = video.closest("[data-elef-reveal-event]")
        const revealEvent = revealBlock ? Number(revealBlock.getAttribute("data-elef-reveal-event")) : -1
        const revealIsHidden = revealBlock && Number.isSafeInteger(revealEvent) && revealEvent >= revealedEventCount
        if (active && !revealIsHidden) {
          try {
            video.play()?.catch?.(() => {})
          } catch (_error) {}
        } else video.pause()
      })
    })
    if (this.hasCounterTarget) {
      this.counterTarget.textContent = `${this.indexValue + 1} / ${this.slides.length}`
    }
  }
}

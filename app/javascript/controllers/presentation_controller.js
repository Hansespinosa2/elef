import { Controller } from "@hotwired/stimulus"
import { createPresentationNavigation, presentationActionForKey } from "lib/presentation_navigation"

export default class extends Controller {
  static targets = ["slide", "counter", "stage"]
  static values = { active: Boolean, index: Number }

  connect() {
    this.keyHandler = (event) => this.handleKey(event)
    this.slides = []
    if (this.activeValue) this.start()
  }

  disconnect() {
    this.stop()
  }

  start() {
    this.slides = this.hasStageTarget
      ? [...this.stageTarget.querySelectorAll(".slide-frame")]
      : this.slideTargets
    this.navigation = createPresentationNavigation(this.slides.length)
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
      slide.querySelectorAll("video").forEach((video) => video.pause())
    })
    this.navigation = null
    this.slides = []
  }

  next() {
    if (!this.navigation) return
    this.indexValue = this.navigation.next()
    this.showCurrentSlide()
  }

  previous() {
    if (!this.navigation) return
    this.indexValue = this.navigation.previous()
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
      this.indexValue = this.navigation.first()
      this.showCurrentSlide()
    } else if (action === "last") {
      if (!this.navigation) return
      this.indexValue = this.navigation.last()
      this.showCurrentSlide()
    }
  }

  showCurrentSlide() {
    this.slides.forEach((slide, index) => {
      const active = index === this.indexValue
      slide.hidden = !active
      slide.classList.toggle("is-active-presentation-slide", active)
      slide.setAttribute("aria-hidden", active ? "false" : "true")
      slide.querySelectorAll("video").forEach((video) => {
        if (active) video.play().catch(() => {})
        else video.pause()
      })
    })
    if (this.hasCounterTarget) {
      this.counterTarget.textContent = `${this.indexValue + 1} / ${this.slides.length}`
    }
  }
}

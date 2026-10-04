import { Controller } from "@hotwired/stimulus"
import { createPresentationNavigation, presentationActionForKey } from "lib/presentation_navigation"

export default class extends Controller {
  static targets = ["slide", "counter", "stage"]
  static values = { index: Number }

  connect() {
    this.navigation = createPresentationNavigation(this.slideTargets.length)
    this.indexValue = this.navigation?.currentIndex ?? 0
    this.keyHandler = (event) => this.handleKey(event)
    document.addEventListener("keydown", this.keyHandler)
    this.showCurrentSlide()
    this.stageTarget?.focus()
  }

  disconnect() {
    document.removeEventListener("keydown", this.keyHandler)
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
    this.slideTargets.forEach((slide, index) => {
      const active = index === this.indexValue
      slide.hidden = !active
      slide.setAttribute("aria-hidden", active ? "false" : "true")
      slide.querySelectorAll("video").forEach((video) => {
        if (active) video.play().catch(() => {})
        else video.pause()
      })
    })
    if (this.hasCounterTarget) {
      this.counterTarget.textContent = `${this.indexValue + 1} / ${this.slideTargets.length}`
    }
  }
}

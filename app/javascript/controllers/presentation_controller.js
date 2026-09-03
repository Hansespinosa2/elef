import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["slide", "counter", "stage"]
  static values = { index: Number }

  connect() {
    this.keyHandler = (event) => this.handleKey(event)
    document.addEventListener("keydown", this.keyHandler)
    this.showCurrentSlide()
    this.stageTarget?.focus()
  }

  disconnect() {
    document.removeEventListener("keydown", this.keyHandler)
  }

  next() {
    this.indexValue = Math.min(this.indexValue + 1, this.slideTargets.length - 1)
    this.showCurrentSlide()
  }

  previous() {
    this.indexValue = Math.max(this.indexValue - 1, 0)
    this.showCurrentSlide()
  }

  fullscreen() {
    if (this.stageTarget?.requestFullscreen) this.stageTarget.requestFullscreen()
  }

  handleKey(event) {
    if (["ArrowRight", " ", "PageDown", "Enter"].includes(event.key)) {
      event.preventDefault()
      this.next()
    } else if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) {
      event.preventDefault()
      this.previous()
    } else if (event.key === "Home") {
      event.preventDefault()
      this.indexValue = 0
      this.showCurrentSlide()
    } else if (event.key === "End") {
      event.preventDefault()
      this.indexValue = this.slideTargets.length - 1
      this.showCurrentSlide()
    }
  }

  showCurrentSlide() {
    this.slideTargets.forEach((slide, index) => {
      const active = index === this.indexValue
      slide.hidden = !active
      slide.setAttribute("aria-hidden", active ? "false" : "true")
    })
    if (this.hasCounterTarget) {
      this.counterTarget.textContent = `${this.indexValue + 1} / ${this.slideTargets.length}`
    }
  }
}

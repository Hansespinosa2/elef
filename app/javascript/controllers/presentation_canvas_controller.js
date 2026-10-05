import { Controller } from "@hotwired/stimulus"

const DESIGN_WIDTH = 1280

export default class extends Controller {
  static targets = ["canvas"]
  static values = { designWidth: Number, designHeight: Number }

  connect() {
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas())
    this.resizeObserver.observe(this.element)
    this.resizeCanvas()
  }

  disconnect() {
    this.resizeObserver?.disconnect()
  }

  resizeCanvas() {
    this.canvasTarget.style.setProperty("--slide-scale", this.canvasScale())
  }

  canvasScale() {
    const designWidth = this.designWidthValue || DESIGN_WIDTH
    if (!this.hasDesignHeightValue) return this.element.clientWidth / designWidth

    return Math.min(
      this.element.clientWidth / designWidth,
      this.element.clientHeight / this.designHeightValue
    )
  }
}

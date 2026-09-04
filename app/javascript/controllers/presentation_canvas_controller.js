import { Controller } from "@hotwired/stimulus"

const DESIGN_WIDTH = 1280

export default class extends Controller {
  static targets = ["canvas"]

  connect() {
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas())
    this.resizeObserver.observe(this.element)
    this.resizeCanvas()
  }

  disconnect() {
    this.resizeObserver?.disconnect()
  }

  resizeCanvas() {
    const scale = this.element.clientWidth / DESIGN_WIDTH
    this.canvasTarget.style.setProperty("--slide-scale", scale)
  }
}

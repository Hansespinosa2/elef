import { Controller } from "@hotwired/stimulus"

// The split is transient editor chrome, shared by both hosts and both work kinds.
export default class extends Controller<HTMLElement> {
  private pointer: number | null = null

  start(event: PointerEvent): void {
    if (event.button !== 0 || this.pointer !== null) return
    this.pointer = event.pointerId
    this.element.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return
    const layout = this.element.parentElement
    if (!layout) return
    const bounds = layout.getBoundingClientRect()
    const available = bounds.width - this.element.offsetWidth
    if (available <= 0) return
    this.setSplit((event.clientX - bounds.left - this.element.offsetWidth / 2) / available * 100)
  }

  end(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return
    this.pointer = null
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId)
  }

  keydown(event: KeyboardEvent): void {
    const current = Number(this.element.getAttribute("aria-valuenow"))
    let next: number
    switch (event.key) {
      case "ArrowLeft": next = current - (event.shiftKey ? 10 : 2); break
      case "ArrowRight": next = current + (event.shiftKey ? 10 : 2); break
      case "Home": next = 20; break
      case "End": next = 80; break
      default: return
    }
    event.preventDefault()
    this.setSplit(next)
  }

  private setSplit(value: number): void {
    const split = Math.round(Math.max(20, Math.min(80, value)))
    this.element.parentElement?.style.setProperty("--source-split", String(split / 100))
    this.element.setAttribute("aria-valuenow", String(split))
  }
}

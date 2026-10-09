import { Controller } from "@hotwired/stimulus"
import { attachCanvasScaling } from "@elef/client"

export default class extends Controller {
  connect() {
    // Slide frames carry no Stimulus hooks since the presentation canvas
    // controller retired; the shared client scaling helper keeps
    // --slide-scale in sync per rendered frame instead.
    this.canvasDetachers = [...this.element.querySelectorAll(".slide-frame")]
      .map((frame) => attachCanvasScaling(frame))
  }

  disconnect() {
    this.canvasDetachers?.splice(0).forEach((detach) => detach())
    this.canvasDetachers = null
  }

  print() {
    this.element.querySelectorAll("video").forEach((video) => {
      video.pause()
      try { video.currentTime = 0 } catch (_error) {}
    })
    window.print()
  }
}

import { Controller } from "@hotwired/stimulus"
import { attachCanvasScaling } from "@elef/client"

export default class extends Controller {
  connect() {
    // Static slide pages (no preview installs, no present mount) still need
    // per-frame --slide-scale: the retired per-frame presentation canvas
    // controller used to connect here automatically. Same shape as the print
    // view's scaling hook.
    this.canvasDetachers = [...this.element.querySelectorAll(".slide-frame")]
      .map((frame) => attachCanvasScaling(frame))
  }

  disconnect() {
    this.canvasDetachers?.splice(0).forEach((detach) => detach())
    this.canvasDetachers = null
  }
}

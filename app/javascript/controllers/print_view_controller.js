import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  print() {
    this.element.querySelectorAll("video").forEach((video) => {
      video.pause()
      try { video.currentTime = 0 } catch (_error) {}
    })
    window.print()
  }
}

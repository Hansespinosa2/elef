import { Controller } from "@hotwired/stimulus"
import { mountPresentation } from "@elef/client"

// Rails host mount for the shared client presentation feature. All slide
// behavior (navigation, keyboard, fullscreen, canvas scaling) lives in
// @elef/client features/presentation; this adapter only binds the mount to
// the Turbo/Stimulus element lifecycle and delegates toolbar actions.
// (Precedent: client_shell_controller mounts the shared library the same
// way. The retired presentation/presentation-canvas/presentation-editor
// Stimulus feature controllers are gone; see phase 7 plan DO-3.)
export default class extends Controller {
  static targets = ["slide", "counter", "stage"]
  static values = { active: Boolean, index: Number }

  connect() {
    this.mount = mountPresentation(this.element, {
      stage: this.hasStageTarget ? this.stageTarget : undefined,
      counter: this.hasCounterTarget ? this.counterTarget : undefined,
      document,
      active: this.activeValue,
    })
    this.previewUpdatedHandler = () => this.mount?.controller.refresh()
    this.element.addEventListener("elef:preview-updated", this.previewUpdatedHandler)
  }

  disconnect() {
    this.element.removeEventListener("elef:preview-updated", this.previewUpdatedHandler)
    this.mount?.destroy()
    this.mount = null
  }

  start() {
    return this.mount?.controller.start() ?? false
  }

  stop() {
    this.mount?.controller.stop()
  }

  next() {
    this.mount?.controller.next()
  }

  previous() {
    this.mount?.controller.previous()
  }

  fullscreen() {
    this.mount?.controller.fullscreen()
  }
}

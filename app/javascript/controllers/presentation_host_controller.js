import { Controller } from "@hotwired/stimulus"
import { mountPresentation } from "@elef/client"
import { mountHostPresentationEditor } from "lib/presentation_editor_host"

// Rails host mount for the shared client presentation features. All slide
// behavior (present-mode navigation/keyboard/fullscreen/scaling, visual slide
// editing) lives in @elef/client features/presentation; this adapter only
// binds mounts to the Turbo/Stimulus element lifecycle and delegates toolbar
// actions. (Precedent: client_shell_controller mounts the shared library the
// same way. The retired presentation/presentation-canvas/presentation-editor
// Stimulus feature controllers are gone; see phase 7 plan DO-3.)
//
// Two host pages share this mount: the dedicated present page (a div with a
// stage target) and the editor form (a form whose projection canvas renders
// asynchronously, so the editor mount resolves it lazily like the retired
// controller did).
export default class extends Controller {
  static targets = ["slide", "counter", "stage"]
  static values = { active: Boolean }

  connect() {
    if (this.element.tagName === "FORM") {
      this.editorMount = mountHostPresentationEditor(this.element)
      return
    }
    this.mount = mountPresentation(this.element, {
      getStage: () => (this.hasStageTarget ? this.stageTarget : undefined),
      counter: this.hasCounterTarget ? this.counterTarget : undefined,
      document,
    })
    if (this.activeValue) this.mount.controller.start()
    this.previewUpdatedHandler = () => this.mount?.resync()
    this.element.addEventListener("elef:preview-updated", this.previewUpdatedHandler)
  }

  disconnect() {
    if (this.editorMount) {
      this.editorMount.destroy()
      this.editorMount = null
      return
    }
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

import { Application } from "@hotwired/stimulus"
import { mountEditorHosts } from "lib/editor_view"

mountEditorHosts()
document.addEventListener("turbo:load", () => {
  mountEditorHosts()
})

const application = Application.start()

// Configure Stimulus development experience
application.debug = false
window.Stimulus   = application

export { application }

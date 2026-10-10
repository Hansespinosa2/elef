import { Application } from "@hotwired/stimulus"
import { startClientMounts } from "../lib/client_mounts.js"
import { mountEditorHosts } from "../lib/editor_view.js"

mountEditorHosts()
startClientMounts()
document.addEventListener("turbo:load", () => {
  mountEditorHosts()
})

const application = Application.start()

// Configure Stimulus development experience
application.debug = false
window.Stimulus   = application

export { application }

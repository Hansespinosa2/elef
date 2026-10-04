import { Application } from "@hotwired/stimulus"
import { mountEditorHosts } from "lib/editor_view"
import { mountLibraryHosts } from "lib/library_view"

mountEditorHosts()
mountLibraryHosts()
document.addEventListener("turbo:load", () => {
  mountEditorHosts()
  mountLibraryHosts()
})

const application = Application.start()

// Configure Stimulus development experience
application.debug = false
window.Stimulus   = application

export { application }

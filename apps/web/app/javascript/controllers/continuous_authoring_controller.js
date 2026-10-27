import { Controller } from "@hotwired/stimulus"
import { editorFor, waitForEditorController } from "@elef/editor-runtime"

// Explicit web feasibility entry. The shared client owns the surface; this
// adapter starts it after the ordinary editor engine is ready.
export default class extends Controller {
  async connect() {
    this.active = true
    const field = this.element.querySelector(".source-field")
    try {
      const [editor, { mountContinuousAuthoring }] = await Promise.all([
        waitForEditorController(field, editorFor), import("@elef/client/continuous-editor")
      ])
      if (!this.active) return
      const handle = await mountContinuousAuthoring(editor)
      if (this.active) this.handle = handle
      else handle.dispose()
    } catch (error) {
      if (!this.active) return
      delete this.element.dataset.editorSurface
      const editor = editorFor(field)
      editor?.setEditingMode("source")
      const message = document.createElement("p")
      message.className = "error-panel"
      message.setAttribute("role", "alert")
      message.textContent = `The visual editor could not open: ${error.message || error}. Your source remains available. `
      const link = document.createElement("a")
      const fallback = new URL(window.location.href)
      fallback.searchParams.delete("editor_surface")
      link.href = fallback.href
      link.textContent = "Open the standard editor"
      message.append(link)
      this.element.prepend(message)
    }
  }

  disconnect() {
    this.active = false
    this.handle?.dispose()
    this.handle = null
  }
}

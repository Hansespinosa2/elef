import { Controller } from "@hotwired/stimulus"
import { downloadBlob, exportPptxModel } from "@elef/client"

// Rails host mount for the shared client PPTX export feature. The engine
// (model to PptxGenJS blob) lives in @elef/client features/export; this
// adapter only owns the Rails edges — fetching the JSON model (draft form
// post with CSRF, or published release GET), the download button/status,
// and error reporting. (The retired pptx_export_controller.js is gone;
// see phase 7 plan DO-3.)
export default class extends Controller {
  static targets = ["status"]
  static values = { url: String, libraryUrl: String, currentDraft: Boolean }

  async download(event) {
    event.preventDefault()
    const button = this.element.querySelector("button")
    button.disabled = true

    try {
      this.setStatus("Preparing PowerPoint…")
      const model = await this.fetchModel()
      const blob = await exportPptxModel(model, { libraryUrl: this.libraryUrlValue })
      downloadBlob(blob, model.filename)
      this.setStatus("PowerPoint downloaded.")
    } catch (error) {
      console.error("PPTX export failed", error)
      this.setStatus(error.message || "The PowerPoint export failed.")
    } finally {
      button.disabled = false
    }
  }

  async fetchModel() {
    const request = { headers: { Accept: "application/json" }, credentials: "same-origin" }
    if (this.currentDraftValue) {
      const form = document.querySelector('form[data-controller~="autosave"]')
      if (!form) throw new Error("The current draft form is unavailable for export.")

      request.method = "POST"
      request.headers["X-CSRF-Token"] = document.querySelector('meta[name="csrf-token"]')?.content || ""
      request.body = new FormData(form)
      request.body.delete("_method")
    }
    const response = await fetch(this.urlValue, request)
    const model = await response.json()
    if (!response.ok) throw new Error(model.error || "The PowerPoint export could not be prepared.")
    return model
  }

  setStatus(message) {
    if (this.hasStatusTarget) this.statusTarget.textContent = message
  }
}

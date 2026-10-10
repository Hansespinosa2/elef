import { Controller } from "@hotwired/stimulus"
import {
  createPresentation,
  createRenderStage,
  downloadBlob,
  loadPptxLibrary,
  prepareMedia,
  renderSlides
} from "lib/pptx_export"

export default class extends Controller {
  static targets = ["status"]
  static values = { url: String, libraryUrl: String, currentDraft: Boolean }

  async download(event) {
    event.preventDefault()
    const button = this.element.querySelector("button")
    button.disabled = true

    try {
      this.setStatus("Preparing PowerPoint…")
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

      await loadPptxLibrary(this.libraryUrlValue)
      const pptx = createPresentation(model)
      const stage = createRenderStage(model)
      document.body.append(stage)
      let assets
      try {
        assets = await prepareMedia(stage)
        await renderSlides(pptx, stage, model, assets)
      } finally {
        stage.remove()
        assets?.objectUrls.forEach((url) => URL.revokeObjectURL(url))
      }

      const blob = await pptx.write({ outputType: "blob" })
      downloadBlob(blob, model.filename)
      this.setStatus("PowerPoint downloaded.")
    } catch (error) {
      console.error("PPTX export failed", error)
      this.setStatus(error.message || "The PowerPoint export failed.")
    } finally {
      button.disabled = false
    }
  }

  setStatus(message) {
    if (this.hasStatusTarget) this.statusTarget.textContent = message
  }
}

import { Controller } from "@hotwired/stimulus"
import { downloadBlob, exportMenuOptionsFor, exportPptxModel, mountExportMenu } from "@elef/client"

// Rails host mount for the shared client Export menu on the work edit page.
// Labels, option visibility, and dismissal live in @elef/client
// features/export; this adapter only owns the Rails edges — the PDF
// (print-route) hrefs per edition, the draft-form PPTX model fetch, and
// status reporting. (Show pages keep their standalone pptx-export-host
// buttons.)

export default class extends Controller {
  static values = { kind: String, editions: Array, pdfUrls: Object, pptxUrls: Object, libraryUrl: String }

  connect() {
    const editions = (this.editionsValue ?? ["draft"]).map((edition) => ({
      edition,
      pdfHref: this.pdfUrlsValue?.[edition] ?? null,
      onPdf: null,
      onExportPptx: this.pptxUrlsValue?.[edition] ? () => this.downloadPptx(edition) : null,
      pdfOptionId: `work-export-${edition}-print`,
      pptxOptionId: `work-export-${edition}-pptx`,
    }))
    this.exportMenu = mountExportMenu(this.element, {
      menuId: "work-export-menu",
      buttonId: "work-export-menu-button",
      menuLabel: "Export",
      statusId: "work-export-status",
      options: exportMenuOptionsFor({ kind: this.kindValue, editions }),
    })
  }

  disconnect() {
    this.exportMenu?.unmount()
    this.exportMenu = null
  }

  statusTarget() {
    return this.element.querySelector("#work-export-status")
  }

  setStatus(message) {
    const target = this.statusTarget()
    if (target) target.textContent = message
  }

  async downloadPptx(edition) {
    const url = this.pptxUrlsValue?.[edition]
    if (!url) return
    const currentDraft = edition === "draft"
    try {
      this.setStatus("Preparing PowerPoint…")
      const model = await this.fetchModel(url, currentDraft)
      const blob = await exportPptxModel(model, { libraryUrl: this.libraryUrlValue })
      downloadBlob(blob, model.filename)
      this.setStatus("PowerPoint downloaded.")
    } catch (error) {
      console.error("PPTX export failed", error)
      this.setStatus(error.message || "The PowerPoint export failed.")
    }
  }

  async fetchModel(url, currentDraft) {
    const request = { headers: { Accept: "application/json" }, credentials: "same-origin" }
    if (currentDraft) {
      const form = document.querySelector('form[data-controller~="autosave"]')
      if (!form) throw new Error("The current draft form is unavailable for export.")

      request.method = "POST"
      request.headers["X-CSRF-Token"] = document.querySelector('meta[name="csrf-token"]')?.content || ""
      request.body = new FormData(form)
      request.body.delete("_method")
    }
    const response = await fetch(url, request)
    const model = await response.json()
    if (!response.ok) throw new Error(model.error || "The PowerPoint export could not be prepared.")
    return model
  }
}

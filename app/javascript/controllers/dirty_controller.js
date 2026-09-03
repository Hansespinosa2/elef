import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["field", "saveButton", "status"]
  static values = { unsavedMessage: String }

  connect() {
    this.baseline = this.snapshot()
    this.dirty = false
    this.submitting = false
    this.beforeUnload = (event) => {
      if (!this.dirty || this.submitting) return
      event.preventDefault()
      event.returnValue = this.unsavedMessageValue
    }
    this.clickGuard = (event) => this.guardNavigation(event)
    window.addEventListener("beforeunload", this.beforeUnload)
    document.addEventListener("click", this.clickGuard, true)
    this.updateState()
  }

  disconnect() {
    window.removeEventListener("beforeunload", this.beforeUnload)
    document.removeEventListener("click", this.clickGuard, true)
  }

  markDirty() {
    this.dirty = this.snapshot() !== this.baseline
    this.updateState()
  }

  allowSubmit() {
    this.submitting = true
  }

  guardNavigation(event) {
    if (!this.dirty || this.submitting) return
    const link = event.target.closest?.("a[href]")
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return
    if (window.confirm(this.unsavedMessageValue)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  snapshot() {
    return this.fieldTargets.map((field) => field.value).join("\u001f")
  }

  updateState() {
    if (this.hasStatusTarget) this.statusTarget.textContent = this.dirty ? "Unsaved changes" : "Saved"
    if (this.hasSaveButtonTarget) this.saveButtonTarget.disabled = false
  }
}

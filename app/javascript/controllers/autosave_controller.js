import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["field", "status", "retry"]
  static values = { delay: { type: Number, default: 900 } }

  connect() {
    this.timer = null
    this.saving = false
  }

  disconnect() {
    clearTimeout(this.timer)
  }

  schedule() {
    clearTimeout(this.timer)
    this.setStatus("Unsaved changes")
    this.timer = setTimeout(() => this.save(), this.delayValue)
  }

  retry() {
    this.save()
  }

  async save() {
    if (this.saving) return
    this.saving = true
    this.setStatus("Saving…")

    try {
      const response = await fetch(this.element.action, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content
        },
        body: new FormData(this.element)
      })
      if (!response.ok) throw new Error("Save failed")

      this.element.dispatchEvent(new CustomEvent("autosave:saved"))
      this.setStatus("Saved")
    } catch (_error) {
      this.setStatus("Save failed — Retry")
      if (this.hasRetryTarget) this.retryTarget.hidden = false
    } finally {
      this.saving = false
    }
  }

  setStatus(text) {
    if (this.hasStatusTarget) {
      this.statusTarget.textContent = text
      this.statusTarget.setAttribute("data-autosave-state", text.startsWith("Save failed") ? "error" : "")
    }
    if (this.hasRetryTarget) this.retryTarget.hidden = !text.startsWith("Save failed")
  }
}

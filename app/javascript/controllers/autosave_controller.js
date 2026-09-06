import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["field", "status", "retry"]
  static values = { delay: { type: Number, default: 900 } }

  connect() {
    this.timer = null
    this.saving = false
    this.active = true
    this.pendingSubmit = null
  }

  disconnect() {
    this.active = false
    clearTimeout(this.timer)
  }

  // Let an outstanding PATCH finish before the explicit form submission so
  // an older autosave cannot overwrite the manually saved version.
  submit(event) {
    clearTimeout(this.timer)
    if (!this.saving) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.pendingSubmit = event.submitter
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
    clearTimeout(this.timer)
    if (this.saving || !this.active) return
    const snapshot = this.snapshot()
    this.saving = true
    this.setStatus("Saving…")

    try {
      const response = await fetch(this.element.action, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
        },
        body: new FormData(this.element)
      })
      if (!response.ok) throw new Error("Save failed")

      if (!this.active) return
      this.element.dispatchEvent(new CustomEvent("autosave:saved", { detail: { snapshot } }))
      this.setStatus(this.snapshot() === snapshot ? "Saved" : "Unsaved changes")
      // schedule() may have fired while this request was in flight.
      // Persist the newer fields even if that debounce timer already elapsed.
      if (this.snapshot() !== snapshot) this.timer = setTimeout(() => this.save(), 0)
    } catch (_error) {
      if (this.active) this.setStatus("Save failed")
    } finally {
      this.saving = false
      if (this.active && this.pendingSubmit) {
        const submitter = this.pendingSubmit
        this.pendingSubmit = null
        clearTimeout(this.timer)
        this.element.requestSubmit(submitter)
      }
    }
  }

  snapshot() {
    return this.fieldTargets.map(field => field.value).join("\u001f")
  }

  setStatus(text) {
    if (this.hasStatusTarget) {
      this.statusTarget.textContent = text
      this.statusTarget.setAttribute("data-autosave-state", text.startsWith("Save failed") ? "error" : "")
    }
    if (this.hasRetryTarget) this.retryTarget.hidden = !text.startsWith("Save failed")
  }
}

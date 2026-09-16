import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["container", "warnings", "status"]
  static values = { url: String, delay: { type: Number, default: 300 } }

  connect() {
    this.timer = null
    this.requestId = 0
    this.active = true
  }

  disconnect() {
    this.active = false
    clearTimeout(this.timer)
  }

  schedule() {
    clearTimeout(this.timer)
    const revision = ++this.requestId
    this.setStatus("Updating preview…")
    this.timer = setTimeout(() => this.refresh(revision), this.delayValue)
  }

  async refresh(requestId = this.requestId) {
    const body = new FormData(this.element)
    // Persisted Rails forms include _method=patch. Preview is deliberately a
    // POST to a non-mutating endpoint, so do not let Rack method override it.
    body.delete("_method")
    body.delete("commit")
    body.set("revision", requestId)

    try {
      const response = await fetch(this.urlValue, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
        },
        body
      })
      const payload = await response.json()
      if (!this.active || requestId !== this.requestId) return

      this.renderWarnings(payload.warnings || [])
      if (!response.ok || payload.html === null || payload.html === undefined) {
        this.setStatus("Preview unavailable")
        return
      }

      this.containerTarget.innerHTML = payload.html
      this.setStatus("Preview updated")
    } catch (_error) {
      if (!this.active || requestId !== this.requestId) return
      this.renderWarnings(["Preview could not be reached. Your source is still safe; try again shortly."])
      this.setStatus("Preview unavailable")
    }
  }

  renderWarnings(warnings) {
    const list = this.warningsTarget.querySelector("ul")
    list.replaceChildren()
    warnings.forEach((warning) => {
      const item = document.createElement("li")
      item.textContent = warning
      list.append(item)
    })
    this.warningsTarget.hidden = warnings.length === 0
  }

  setStatus(text) {
    if (this.hasStatusTarget) this.statusTarget.textContent = text
  }
}

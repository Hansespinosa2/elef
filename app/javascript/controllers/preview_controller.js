import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["container", "warnings", "status", "retry"]
  static values = { url: String, delay: { type: Number, default: 300 } }

  connect() {
    this.timer = null
    this.requestId = 0
    this.active = true
  }

  disconnect() {
    this.active = false
    clearTimeout(this.timer)
    this.abortActiveRequest()
  }

  schedule() {
    clearTimeout(this.timer)
    this.abortActiveRequest()
    const revision = ++this.requestId
    this.hideRetry()
    this.setStatus("Updating preview…")
    this.timer = setTimeout(() => this.refresh(revision), this.delayValue)
  }

  retry(event) {
    event?.preventDefault()
    clearTimeout(this.timer)
    const revision = ++this.requestId
    this.hideRetry()
    this.setStatus("Updating preview…")
    this.refresh(revision)
  }

  async refresh(requestId = this.requestId) {
    this.abortActiveRequest()
    const requestController = new AbortController()
    this.requestController = requestController
    const body = new FormData(this.element)
    // Persisted Rails forms include _method=patch. Preview is deliberately a
    // POST to a non-mutating endpoint, so do not let Rack method override it.
    body.delete("_method")
    body.delete("commit")
    body.set("revision", requestId)
    body.set("projection", "editor")

    try {
      const response = await fetch(this.urlValue, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
        },
        signal: requestController.signal,
        body
      })
      const payload = await response.json()
      if (!this.active || requestId !== this.requestId) return

      this.renderWarnings(payload.warnings || [])
      if (!response.ok || payload.html === null || payload.html === undefined) {
        this.element.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true, detail: { payload, response } }))
        this.showRetry()
        this.setStatus("Preview unavailable")
        return
      }

      const activeEditable = document.activeElement?.closest?.("[contenteditable='true']")
      const editingProjection = activeEditable && this.containerTarget.contains(activeEditable)
      if (!editingProjection) {
        const scrollLeft = this.containerTarget.scrollLeft
        const scrollTop = this.containerTarget.scrollTop
        this.containerTarget.innerHTML = payload.html
        this.containerTarget.scrollLeft = scrollLeft
        this.containerTarget.scrollTop = scrollTop
      }
      this.element.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true, detail: { payload, response } }))
      this.hideRetry()
      this.setStatus("")
    } catch (error) {
      if (error.name === "AbortError") return
      if (!this.active || requestId !== this.requestId) return
      this.renderWarnings(["Preview could not be reached. Your source is still safe; try again shortly."])
      this.element.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true, detail: { payload: null, response: null, error } }))
      this.showRetry()
      this.setStatus("Preview unavailable")
    } finally {
      if (this.requestController === requestController) this.requestController = null
    }
  }

  abortActiveRequest() {
    this.requestController?.abort()
    this.requestController = null
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

  showRetry() {
    if (this.hasRetryTarget) this.retryTarget.hidden = false
  }

  hideRetry() {
    if (this.hasRetryTarget) this.retryTarget.hidden = true
  }
}

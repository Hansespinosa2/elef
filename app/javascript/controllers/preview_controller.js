import { Controller } from "@hotwired/stimulus"
import { installPreviewHtml } from "lib/editor_view"

export default class extends Controller {
  static targets = ["container", "warnings", "status", "retry"]
  static values = { url: String, delay: { type: Number, default: 300 }, timeout: { type: Number, default: 8000 } }

  connect() {
    this.element.previewController = this
    this.timer = null
    this.requestId = 0
    this.active = true
    this.pendingProjection = null
    this.projectionFresh = true
    this.serverWarnings = [...this.warningsTarget.querySelectorAll("li")].map((item) => item.textContent)
    this.localWarnings = []
    this.focusoutHandler = (event) => {
      // A block's blur handler may mark it read-only before this bubbling
      // listener runs, so identify the editor block independently of its
      // current contenteditable value.
      if (!event.target.closest?.("[data-editor-block-id]") || !this.containerTarget.contains(event.target)) return

      queueMicrotask(() => {
        if (this.isEditingProjection()) return

        if (this.pendingProjection) this.applyPendingProjection()
        else if (!this.projectionFresh) this.markProjectionStale(false)
      })
    }
    this.localPreviewError = (event) => this.handleLocalPreviewError(event)
    this.localPreviewRecovered = () => this.handleLocalPreviewRecovered()
    this.element.addEventListener("focusout", this.focusoutHandler)
    this.element.addEventListener("elef:live-preview-error", this.localPreviewError)
    this.element.addEventListener("elef:live-preview-recovered", this.localPreviewRecovered)
  }

  disconnect() {
    this.active = false
    clearTimeout(this.timer)
    this.abortActiveRequest()
    this.element.removeEventListener("focusout", this.focusoutHandler)
    this.element.removeEventListener("elef:live-preview-error", this.localPreviewError)
    this.element.removeEventListener("elef:live-preview-recovered", this.localPreviewRecovered)
    if (this.element.previewController === this) delete this.element.previewController
  }

  schedule() {
    clearTimeout(this.timer)
    this.abortActiveRequest()
    this.pendingProjection = null
    const revision = ++this.requestId
    this.markProjectionStale(this.isEditingProjection())
    this.hideRetry()
    this.setStatus("Updating preview…")
    this.timer = setTimeout(() => this.refresh(revision), this.delayValue)
  }

  retry(event) {
    event?.preventDefault()
    clearTimeout(this.timer)
    this.pendingProjection = null
    const revision = ++this.requestId
    this.markProjectionStale(this.isEditingProjection())
    this.hideRetry()
    this.setStatus("Updating preview…")
    this.refresh(revision)
  }

  async refresh(requestId = this.requestId) {
    this.abortActiveRequest()
    const requestController = new AbortController()
    this.requestController = requestController
    let timedOut = false
    let timeout
    const body = new FormData(this.element)
    // Persisted Rails forms include _method=patch. Preview is deliberately a
    // POST to a non-mutating endpoint, so do not let Rack method override it.
    body.delete("_method")
    body.delete("commit")
    body.set("revision", requestId)
    body.set("projection", "editor")
    const sourceFieldName = [...body.keys()].find((name) => name.endsWith("[source]"))
    const requestedSource = sourceFieldName ? body.get(sourceFieldName).toString() : ""

    try {
      const request = fetch(this.urlValue, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || ""
        },
        signal: requestController.signal,
        body
      })
      const timeoutFailure = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true
          requestController.abort()
          const error = new Error("Preview timed out")
          error.name = "PreviewTimeout"
          reject(error)
        }, this.timeoutValue)
      })
      const response = await Promise.race([request, timeoutFailure])
      const payload = await response.json()
      if (!this.active || requestId !== this.requestId) return false

      this.renderWarnings(payload.warnings || [])
      if (!response.ok || payload.html === null || payload.html === undefined) {
        // A source map only describes a projection when that projection was
        // installed. Keep the previous map paired with the last-good HTML.
        const unavailablePayload = { ...payload, editor_map: null }
        this.containerTarget.setAttribute("aria-busy", "false")
        this.element.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true, detail: { payload: unavailablePayload, response } }))
        this.showRetry()
        this.setStatus("Preview unavailable")
        return false
      }

      if (!this.sameSource(this.currentSource(), requestedSource)) {
        this.schedule()
        return
      }

      if (this.isEditingProjection()) {
        this.pendingProjection = { payload, response, source: requestedSource }
        this.hideRetry()
        this.setStatus("Preview ready — finish editing to update the visual structure.")
        return
      }

      this.installProjection(payload, response, requestedSource)
      return response.ok && payload.html !== null && payload.html !== undefined
    } catch (error) {
      if (error.name === "AbortError" && !timedOut) return
      if (!this.active || requestId !== this.requestId) return
      const warning = timedOut
        ? "Preview timed out. Your source is still safe; try again when the server responds."
        : "Preview could not be reached. Your source is still safe; try again shortly."
      this.renderWarnings([warning])
      this.containerTarget.setAttribute("aria-busy", "false")
      this.element.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true, detail: { payload: null, response: null, error } }))
      this.showRetry()
      this.setStatus("Preview unavailable")
      return false
    } finally {
      clearTimeout(timeout)
      if (this.requestController === requestController) this.requestController = null
    }
  }

  abortActiveRequest() {
    this.requestController?.abort()
    this.requestController = null
  }

  isEditingProjection() {
    const activeEditable = document.activeElement?.closest?.("[contenteditable='true']")
    return Boolean(activeEditable && this.containerTarget.contains(activeEditable))
  }

  applyPendingProjection() {
    if (!this.pendingProjection || this.isEditingProjection()) return

    const projection = this.pendingProjection
    this.pendingProjection = null
    this.installProjection(projection.payload, projection.response, projection.source)
  }

  installProjection(payload, response, source) {
    if (!this.sameSource(this.currentSource(), source)) {
      this.schedule()
      return
    }

    const scrollLeft = this.containerTarget.scrollLeft
    const scrollTop = this.containerTarget.scrollTop
    recordPreviewTrace("preview-install-start")
    installPreviewHtml(this.containerTarget, payload.html)
    recordPreviewTrace("preview-install-ready")
    this.containerTarget.scrollLeft = scrollLeft
    this.containerTarget.scrollTop = scrollTop
    this.projectionFresh = true
    delete this.element.dataset.previewProjectionStale
    this.containerTarget.removeAttribute("aria-busy")
    this.element.dispatchEvent(new CustomEvent("elef:preview-updated", { bubbles: true, detail: { payload, response, source } }))
    recordPreviewTrace("preview-events-ready")
    this.containerTarget.dispatchEvent(new CustomEvent("preview:updated", { bubbles: true }))
    this.hideRetry()
    this.setStatus("")
  }

  markProjectionStale(preserveActive) {
    this.projectionFresh = false
    this.element.dataset.previewProjectionStale = "true"
    this.containerTarget.setAttribute("aria-busy", "true")
    this.element.dispatchEvent(new CustomEvent("elef:preview-stale", {
      bubbles: true,
      detail: { preserveActive: Boolean(preserveActive) }
    }))
  }

  currentSource() {
    const field = this.element.querySelector(".source-field")
    return field?.editorController?.sourceValue ?? field?.querySelector("textarea")?.value ?? ""
  }

  sameSource(left, right) {
    const normalize = (source) => String(source ?? "").replace(/\r\n?/g, "\n")
    return normalize(left) === normalize(right)
  }

  renderWarnings(warnings) {
    this.serverWarnings = Array.isArray(warnings) ? warnings : []
    const visibleWarnings = [...this.localWarnings, ...this.serverWarnings]
    const list = this.warningsTarget.querySelector("ul")
    list.replaceChildren()
    visibleWarnings.forEach((warning) => {
      const item = document.createElement("li")
      item.textContent = warning
      list.append(item)
    })
    this.warningsTarget.hidden = visibleWarnings.length === 0
  }

  handleLocalPreviewError(event) {
    this.localWarnings = [event.detail?.message || "Live Markdown projection is unavailable. Your source remains editable."]
    this.renderWarnings(this.serverWarnings)
    this.setStatus("Visual preview degraded")
  }

  handleLocalPreviewRecovered() {
    this.localWarnings = []
    this.renderWarnings(this.serverWarnings)
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

function recordPreviewTrace(stage) {
  const trace = globalThis.__elefPreviewTrace
  if (!Array.isArray(trace)) return
  trace.push({ time: performance.now(), stage })
  if (trace.length > 40) trace.shift()
}

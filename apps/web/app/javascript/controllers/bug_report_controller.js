import { Controller } from "@hotwired/stimulus"
import { formatReproductionSteps, sharedBugReportRecorder } from "bug_report_events"

export default class extends Controller {
  static targets = ["dialog", "form", "expected", "actual", "steps", "error", "submit", "success", "issueLink"]
  static values = { endpoint: String }

  connect() {
    this.recorder = sharedBugReportRecorder()
    this.submitting = false
  }

  open(event) {
    if (this.dialogTarget.open) return

    const snapshot = this.recorder.snapshot()
    this.recorder.pause()
    event?.preventDefault()
    this.errorTarget.hidden = true
    this.errorTarget.textContent = ""
    this.successTarget.hidden = true
    this.formTarget.hidden = false
    this.formTarget.reset()
    this.stepsTarget.value = formatReproductionSteps(snapshot)
    this.dialogTarget.showModal()
  }

  close(event) {
    event?.preventDefault()
    if (this.submitting || !this.dialogTarget.open) return
    this.dialogTarget.close()
  }

  cancel(event) {
    if (this.submitting) event.preventDefault()
  }

  closed() {
    this.recorder.resume()
  }

  async submit(event) {
    event.preventDefault()
    if (this.submitting) return

    this.submitting = true
    this.submitTarget.disabled = true
    this.submitTarget.textContent = "Creating issue…"
    this.errorTarget.hidden = true
    this.errorTarget.textContent = ""

    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content
    const body = {
      bug_report: {
        expected: this.expectedTarget.value,
        actual: this.actualTarget.value,
        steps: this.stepsTarget.value
      }
    }

    try {
      const response = await fetch(this.endpointValue, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken || ""
        },
        body: JSON.stringify(body)
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || "The issue could not be created. Your report is still here; please try again.")

      this.formTarget.hidden = true
      this.successTarget.hidden = false
      if (result.url) {
        this.issueLinkTarget.href = result.url
        this.issueLinkTarget.hidden = false
      } else {
        this.issueLinkTarget.hidden = true
      }
    } catch (error) {
      this.errorTarget.textContent = error.message || "The issue could not be created. Your report is still here; please try again."
      this.errorTarget.hidden = false
    } finally {
      this.submitting = false
      this.submitTarget.disabled = false
      this.submitTarget.textContent = "Create GitHub issue"
    }
  }
}

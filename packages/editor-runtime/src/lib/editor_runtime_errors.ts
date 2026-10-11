// Shared E2E diagnostic: both profile registrations install the Stimulus
// controller-error recorder so the native harnesses can read failures back.
// Kept in its own module (free of controller imports) so the Stable bundle
// can include it without dragging the excluded controllers along.
import type { Application } from "@hotwired/stimulus"

export function installEditorRuntimeErrorHook(application: Application): void {
  if (!(typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) return
  const handleError = application.handleError.bind(application)
  application.handleError = (error: any, message: any, detail: any) => {
    globalThis.__elefE2EControllerErrors ||= []
    globalThis.__elefE2EControllerErrors.push({
      message: String(message),
      identifier: detail?.identifier || "",
      elementId: detail?.element?.id || "",
      errorName: error?.name || "",
      errorMessage: error?.message || String(error),
      causeName: error?.cause?.name || "",
      causeMessage: error?.cause?.message || "",
      errorStack: error?.stack || "",
      causeStack: error?.cause?.stack || ""
    })
    handleError(error, message, detail)
  }
}

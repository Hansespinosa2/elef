const FAILURE_COMMANDS = Object.freeze({
  preview: "record_preview_failure",
  bootstrap: "record_bootstrap_failure"
})

export function createDiagnosticFailures(invoke) {
  const record = command => {
    try {
      const result = invoke(command)
      if (result && typeof result.catch === "function") void result.catch(() => {})
    } catch (_error) {
      // Diagnostics must never change startup or preview behavior.
    }
  }

  return Object.freeze({
    recordPreviewFailure: () => record(FAILURE_COMMANDS.preview),
    recordBootstrapFailure: () => record(FAILURE_COMMANDS.bootstrap)
  })
}

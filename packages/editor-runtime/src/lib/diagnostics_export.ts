// Reportable diagnostics export: map the native save-panel outcome onto the
// shell's status/error seams. `true` means the archive was written, `false`
// means the user cancelled the panel (stays silent, like Work export), and a
// rejection carries the native user-safe error to the error notice. Kept free
// of DOM and status copy so the committed node:test suite can prove the
// mapping without booting the shell; the user-visible copy lives with the
// caller in file_library_application.ts.
export async function reportDiagnosticsExport(
  exportDiagnostics: () => Promise<boolean>,
  report: { exported: () => void; failed: (error: unknown) => void },
): Promise<void> {
  try {
    if (await exportDiagnostics()) report.exported()
  } catch (error) {
    report.failed(error)
  }
}

// Supported export behavior, shared definition (P10-01).
//
// The host executes the branch its capability declares (P10-02): the web app
// runs the shared client features/export flow against Rails; the desktop has
// no export surface (HD-06 in tests/host-differences.md) and asserts the
// explicit disabled path. Byte-level PPTX contracts stay in the Rails export
// tests (service + system); this scenario proves the shared flow completes —
// or is explicitly absent — on each real host.
export async function exportWorkflow(ui) {
  if (ui.capabilities.export) {
    await ui.downloadPptx()
    await ui.assertPptxDownloaded()
  } else {
    await ui.assertExportUnavailable()
  }
}

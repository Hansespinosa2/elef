export async function sourcePreviewResizeWorkflow(ui) {
  for (const title of ["E2E document", "E2E seed"]) {
    await ui.openWork(title)
    await ui.showSourceMode()
    await ui.assertSourcePreviewResize()
  }
}

export async function documentPageAspectRatioWorkflow(ui) {
  await ui.openWork("E2E document")
  await ui.assertDocumentPageAspectRatio()
}

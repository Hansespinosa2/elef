export async function documentPageAspectRatioWorkflow(ui) {
  await ui.openDeck("E2E document")
  await ui.assertDocumentPageAspectRatio()
}
